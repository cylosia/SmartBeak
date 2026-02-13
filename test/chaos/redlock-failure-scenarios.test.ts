/**
 * Chaos/Failure Tests: Redlock Failure Scenarios
 *
 * Tests distributed lock behavior under fault injection:
 * - Redis disconnect while lock is held
 * - releaseLock() failures
 * - Lock extension failures
 * - Two-process lock racing
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

const mockRedisStore = new Map<string, string>();
let shouldFailRelease = false;
let shouldFailEval = false;

vi.mock('@kernel/redis', () => ({
  getRedis: vi.fn().mockResolvedValue({
    set: vi.fn().mockImplementation(async (key: string, value: string, ..._args: unknown[]) => {
      if (mockRedisStore.has(key)) return null;
      mockRedisStore.set(key, value);
      return 'OK';
    }),
    get: vi.fn().mockImplementation(async (key: string) => mockRedisStore.get(key) ?? null),
    del: vi.fn().mockImplementation(async (key: string) => {
      return mockRedisStore.delete(key) ? 1 : 0;
    }),
    exists: vi.fn().mockImplementation(async (key: string) => mockRedisStore.has(key) ? 1 : 0),
    eval: vi.fn().mockImplementation(async (_script: string, _numKeys: number, key: string, value: string) => {
      if (shouldFailEval) throw new Error('ECONNRESET: Redis connection lost');
      if (shouldFailRelease) throw new Error('Redis EVAL failed');
      if (mockRedisStore.get(key) === value) {
        mockRedisStore.delete(key);
        return 1;
      }
      return 0;
    }),
    pttl: vi.fn().mockResolvedValue(5000),
    pexpire: vi.fn().mockImplementation(async () => {
      if (shouldFailEval) throw new Error('Redis PEXPIRE failed');
      return 1;
    }),
  }),
}));

import { acquireLock, releaseLock, extendLock, withLock, isLocked } from '@kernel/redlock';

describe('Redlock - Failure Scenarios', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedisStore.clear();
    shouldFailRelease = false;
    shouldFailEval = false;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mockRedisStore.clear();
    shouldFailRelease = false;
    shouldFailEval = false;
  });

  describe('Redis Disconnect While Lock is Held', () => {
    it('should handle Redis becoming unavailable after lock acquisition', async () => {
      // Acquire lock successfully
      const lock = await acquireLock('disconnect-resource', { ttl: 5000 });
      expect(lock).not.toBeNull();

      // Simulate Redis disconnect on release
      shouldFailEval = true;

      // Release should throw (Redis is unavailable)
      if (lock) {
        await expect(releaseLock(lock)).rejects.toThrow('Redis connection lost');
      }

      // Lock is still in store (would expire via TTL in real Redis)
      expect(mockRedisStore.has(`lock:disconnect-resource`)).toBe(true);
    });

    it('should rely on TTL for lock expiry when Redis connection is lost mid-hold', async () => {
      const lock = await acquireLock('ttl-expire-resource', { ttl: 100 });
      expect(lock).not.toBeNull();

      // Verify lock exists
      expect(await isLocked('ttl-expire-resource')).toBe(true);

      // In real Redis, the TTL would expire the lock automatically
      // We verify the lock was created with the correct expiration
      expect(lock!.expiration).toBeGreaterThan(Date.now());
      expect(lock!.expiration).toBeLessThanOrEqual(Date.now() + 100);
    });
  });

  describe('releaseLock() Failure Handling', () => {
    it('should handle Redis EVAL failure during release gracefully in withLock', async () => {
      shouldFailRelease = true;

      // withLock should not throw even when release fails — it catches and logs
      const result = await withLock(
        'release-fail-resource',
        async () => 'completed-work',
        { ttl: 5000, retryCount: 1, retryDelay: 0 }
      );

      expect(result).toBe('completed-work');
    });

    it('should return false when trying to release an already-expired lock', async () => {
      const lock = await acquireLock('expired-resource', { ttl: 5000 });
      expect(lock).not.toBeNull();

      // Simulate lock expiry by removing from store
      mockRedisStore.delete(`lock:expired-resource`);

      if (lock) {
        const released = await releaseLock(lock);
        expect(released).toBe(false);
      }
    });

    it('should return false when trying to release another process lock', async () => {
      // Simulate another process holding the lock with a different value
      mockRedisStore.set('lock:other-process-resource', 'other-process-lock-value');

      const fakeLock = {
        resource: 'other-process-resource',
        value: 'my-lock-value', // Different from what's stored
        expiration: Date.now() + 5000,
      };

      const released = await releaseLock(fakeLock);
      expect(released).toBe(false);

      // Original lock should still be in store
      expect(mockRedisStore.has('lock:other-process-resource')).toBe(true);
    });
  });

  describe('Lock Extension Failures', () => {
    it('should detect extension failure when lock expired during operation', async () => {
      const lock = await acquireLock('extend-expired', { ttl: 5000 });
      expect(lock).not.toBeNull();

      // Simulate lock expiry
      mockRedisStore.delete(`lock:extend-expired`);

      if (lock) {
        const extended = await extendLock(lock, 5000);
        expect(extended).toBe(false);
      }
    });

    it('should detect extension failure when lock was taken by another process', async () => {
      const lock = await acquireLock('extend-stolen', { ttl: 5000 });
      expect(lock).not.toBeNull();

      // Simulate another process stealing the lock
      mockRedisStore.set('lock:extend-stolen', 'stolen-value');

      if (lock) {
        const extended = await extendLock(lock, 5000);
        expect(extended).toBe(false);
      }
    });
  });

  describe('Lock Racing', () => {
    it('should ensure exactly one winner when two callers race for same lock', async () => {
      const [lock1, lock2] = await Promise.all([
        acquireLock('race-resource', { ttl: 5000 }),
        acquireLock('race-resource', { ttl: 5000 }),
      ]);

      const winners = [lock1, lock2].filter(l => l !== null);
      const losers = [lock1, lock2].filter(l => l === null);

      expect(winners.length).toBe(1);
      expect(losers.length).toBe(1);

      // Clean up
      if (lock1) await releaseLock(lock1);
      if (lock2) await releaseLock(lock2);
    });

    it('should allow loser to acquire after winner releases', async () => {
      const lock1 = await acquireLock('serial-race', { ttl: 5000 });
      expect(lock1).not.toBeNull();

      // Second attempt fails
      const lock2 = await acquireLock('serial-race', { ttl: 5000 });
      expect(lock2).toBeNull();

      // Release first lock
      if (lock1) await releaseLock(lock1);

      // Now second attempt succeeds
      const lock3 = await acquireLock('serial-race', { ttl: 5000 });
      expect(lock3).not.toBeNull();

      if (lock3) await releaseLock(lock3);
    });
  });
});
