/**
 * Performance Benchmark: Lock Acquisition
 *
 * Measures Redlock acquireLock/releaseLock cycle latency
 * and withLock() wrapper overhead.
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
      if (mockRedisStore.get(key) === value) {
        mockRedisStore.delete(key);
        return 1;
      }
      return 0;
    }),
    pttl: vi.fn().mockResolvedValue(5000),
    pexpire: vi.fn().mockResolvedValue(1),
  }),
}));

import { acquireLock, releaseLock, withLock } from '@kernel/redlock';

describe('Lock Acquisition Benchmarks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedisStore.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mockRedisStore.clear();
  });

  describe('acquireLock/releaseLock Cycle', () => {
    it('should complete 100 lock/unlock cycles with < 2ms avg latency', async () => {
      const ITERATIONS = 100;
      const MAX_AVG_MS = 2;

      const start = performance.now();

      for (let i = 0; i < ITERATIONS; i++) {
        const lock = await acquireLock(`bench-resource-${i}`, { ttl: 5000 });
        expect(lock).not.toBeNull();
        if (lock) {
          await releaseLock(lock);
        }
      }

      const elapsed = performance.now() - start;
      const avgMs = elapsed / ITERATIONS;

      expect(avgMs).toBeLessThan(MAX_AVG_MS);
    });

    it('should complete same-key acquire/release cycle repeatedly', async () => {
      const ITERATIONS = 50;

      for (let i = 0; i < ITERATIONS; i++) {
        const lock = await acquireLock('repeated-resource', { ttl: 5000 });
        expect(lock).not.toBeNull();
        if (lock) {
          const released = await releaseLock(lock);
          expect(released).toBe(true);
        }
      }
    });
  });

  describe('withLock() Wrapper Overhead', () => {
    it('should add < 1ms overhead over raw lock for 50 calls', async () => {
      const ITERATIONS = 50;

      // Measure raw lock cycle
      const rawStart = performance.now();
      for (let i = 0; i < ITERATIONS; i++) {
        const lock = await acquireLock(`raw-${i}`, { ttl: 5000 });
        if (lock) await releaseLock(lock);
      }
      const rawElapsed = performance.now() - rawStart;
      const rawAvg = rawElapsed / ITERATIONS;

      // Measure withLock wrapper
      const wrapperStart = performance.now();
      for (let i = 0; i < ITERATIONS; i++) {
        await withLock(`wrapper-${i}`, async () => i, {
          ttl: 5000,
          retryCount: 1,
          retryDelay: 0,
        });
      }
      const wrapperElapsed = performance.now() - wrapperStart;
      const wrapperAvg = wrapperElapsed / ITERATIONS;

      // withLock overhead should be minimal
      const overhead = wrapperAvg - rawAvg;
      expect(overhead).toBeLessThan(1);
    });
  });

  describe('Lock Generation Performance', () => {
    it('should generate 1000 unique lock values in < 50ms', async () => {
      const ITERATIONS = 1000;
      const MAX_TOTAL_MS = 50;
      const values = new Set<string>();

      const start = performance.now();

      for (let i = 0; i < ITERATIONS; i++) {
        const lock = await acquireLock(`gen-${i}`, { ttl: 5000 });
        if (lock) {
          values.add(lock.value);
          await releaseLock(lock);
        }
      }

      const elapsed = performance.now() - start;

      // All values should be unique
      expect(values.size).toBe(ITERATIONS);
      expect(elapsed).toBeLessThan(MAX_TOTAL_MS);
    });
  });
});
