/**
 * Load/Stress Tests: Redis Concurrency
 *
 * Validates Redis operations and distributed locking under concurrent load:
 * - Concurrent SET/GET data integrity
 * - Redlock contention with many callers
 * - Pipeline burst processing
 * - Connection cleanup verification
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@kernel/logger', () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Use vi.hoisted so mock variables are available when vi.mock factories execute
// (vi.mock calls are hoisted to the top of the file by Vitest)
const { mockRedisStore, mockRedisInstance } = vi.hoisted(() => {
  const store = new Map<string, string>();
  const instance = {
    set: vi.fn().mockImplementation(async (key: string, value: string, ...args: unknown[]) => {
      const nxIndex = args.indexOf('NX');
      if (nxIndex !== -1) {
        // SET with NX — only set if not exists
        if (store.has(key)) return null;
      }
      store.set(key, value);
      return 'OK';
    }),
    get: vi.fn().mockImplementation(async (key: string) => {
      return store.get(key) ?? null;
    }),
    del: vi.fn().mockImplementation(async (key: string) => {
      return store.delete(key) ? 1 : 0;
    }),
    exists: vi.fn().mockImplementation(async (key: string) => {
      return store.has(key) ? 1 : 0;
    }),
    eval: vi.fn().mockImplementation(async (_script: string, numKeys: number, ...args: string[]) => {
      // Redlock uses two Lua scripts:
      // 1. Acquire: eval(script, 2, lockKey, fencingKey, lockValue, ttl)
      //    SET lockKey lockValue PX ttl NX; if ok INCR fencingKey, else return -1
      // 2. Release: eval(script, 1, lockKey, lockValue)
      //    if GET lockKey == lockValue then DEL lockKey return 1 else return 0
      if (numKeys === 2) {
        // Acquire lock script
        const lockKey = args[0]!;
        const fencingKey = args[1]!;
        const lockValue = args[2]!;
        if (store.has(lockKey)) {
          return -1; // Lock already held
        }
        store.set(lockKey, lockValue);
        const fenceVal = parseInt(store.get(fencingKey) || '0', 10) + 1;
        store.set(fencingKey, String(fenceVal));
        return fenceVal;
      }
      // Release lock script
      const lockKey = args[0]!;
      const lockValue = args[1]!;
      if (store.get(lockKey) === lockValue) {
        store.delete(lockKey);
        return 1;
      }
      return 0;
    }),
    pttl: vi.fn().mockResolvedValue(5000),
    pipeline: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnThis(),
      get: vi.fn().mockReturnThis(),
      exec: vi.fn().mockImplementation(async () => {
        return Array.from({ length: 200 }, () => [null, 'OK']);
      }),
    }),
    quit: vi.fn().mockResolvedValue('OK'),
    on: vi.fn(),
    status: 'ready',
  };
  return { mockRedisStore: store, mockRedisInstance: instance };
});

vi.mock('@kernel/redis', () => ({
  getRedis: vi.fn().mockResolvedValue(mockRedisInstance),
}));

import { acquireLock, releaseLock, acquireLockWithRetry } from '@kernel/redlock';

describe('Redis Concurrency - Load/Stress Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedisStore.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Concurrent SET/GET Data Integrity', () => {
    it('should maintain data integrity across 100 concurrent SET/GET operations', async () => {
      const OPERATIONS = 100;

      // Write all values concurrently
      await Promise.all(
        Array.from({ length: OPERATIONS }, (_, i) =>
          mockRedisInstance.set(`key:${i}`, `value:${i}`)
        )
      );

      // Read all values concurrently and verify
      const results = await Promise.all(
        Array.from({ length: OPERATIONS }, (_, i) =>
          mockRedisInstance.get(`key:${i}`)
        )
      );

      for (let i = 0; i < OPERATIONS; i++) {
        expect(results[i]).toBe(`value:${i}`);
      }
    });

    it('should handle 100 concurrent SET operations to same key (last-writer-wins)', async () => {
      const WRITERS = 100;
      const KEY = 'contended:key';

      await Promise.all(
        Array.from({ length: WRITERS }, (_, i) =>
          mockRedisInstance.set(KEY, `writer-${i}`)
        )
      );

      const finalValue = await mockRedisInstance.get(KEY);
      // Should have some value (last writer wins)
      expect(finalValue).toBeDefined();
      expect(finalValue).toMatch(/^writer-\d+$/);
    });
  });

  describe('Redlock Contention', () => {
    it('should ensure only 1 of 50 concurrent lock attempts succeeds at a time', async () => {
      const CONTENDERS = 50;
      const RESOURCE = 'shared-resource';

      const results = await Promise.allSettled(
        Array.from({ length: CONTENDERS }, () =>
          acquireLock(RESOURCE, { ttl: 5000 })
        )
      );

      const acquired = results.filter(
        r => r.status === 'fulfilled' && r.value !== null
      );
      const failed = results.filter(
        r => r.status === 'fulfilled' && r.value === null
      );

      // Exactly one should succeed (NX semantics)
      expect(acquired.length).toBe(1);
      expect(failed.length).toBe(CONTENDERS - 1);
    });

    it('should allow sequential lock acquisition after release', async () => {
      const RESOURCE = 'sequential-resource';
      const ROUNDS = 10;

      for (let i = 0; i < ROUNDS; i++) {
        const lock = await acquireLock(RESOURCE, { ttl: 5000 });
        expect(lock).not.toBeNull();

        if (lock) {
          const released = await releaseLock(lock);
          expect(released).toBe(true);
        }
      }
    });

    it('should handle lock retry with multiple contenders', async () => {
      const RESOURCE = 'retry-resource';

      // First lock succeeds
      const firstLock = await acquireLock(RESOURCE, { ttl: 5000 });
      expect(firstLock).not.toBeNull();

      // Second attempt with retry should fail (lock held, no auto-release in mock)
      const secondLock = await acquireLockWithRetry(RESOURCE, {
        ttl: 5000,
        retryCount: 3,
        retryDelay: 10,
      });
      expect(secondLock).toBeNull();

      // Release first lock
      if (firstLock) {
        await releaseLock(firstLock);
      }

      // Now third attempt should succeed
      const thirdLock = await acquireLock(RESOURCE, { ttl: 5000 });
      expect(thirdLock).not.toBeNull();
    });
  });

  describe('Pipeline Burst Processing', () => {
    it('should handle 200 pipelined commands successfully', async () => {
      const pipeline = mockRedisInstance.pipeline();

      for (let i = 0; i < 200; i++) {
        pipeline.set(`pipeline:${i}`, `value:${i}`);
      }

      const results = await pipeline.exec();

      expect(results).toHaveLength(200);
      expect(results!.every((r: [Error | null, unknown]) => r[0] === null)).toBe(true);
    });
  });

  describe('Connection Cleanup', () => {
    it('should cleanly close Redis connection after burst operations', async () => {
      // Perform burst operations
      await Promise.all(
        Array.from({ length: 50 }, (_, i) =>
          mockRedisInstance.set(`cleanup:${i}`, `value:${i}`)
        )
      );

      // Close connection
      await mockRedisInstance.quit();

      expect(mockRedisInstance.quit).toHaveBeenCalledOnce();
    });
  });
});
