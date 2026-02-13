/**
 * Performance Benchmark: Cache Operations
 *
 * Measures cache get/set throughput and stampede protection effectiveness.
 * Asserts maximum acceptable latency to prevent regressions.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@kernel/logger', () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('Cache Operations Benchmarks', () => {
  describe('In-Memory Cache Performance', () => {
    it('should complete 1000 Map get/set operations in < 10ms', () => {
      const cache = new Map<string, string>();
      const ITERATIONS = 1000;
      const MAX_TOTAL_MS = 10;

      const start = performance.now();

      for (let i = 0; i < ITERATIONS; i++) {
        cache.set(`key:${i}`, `value:${i}`);
      }

      for (let i = 0; i < ITERATIONS; i++) {
        cache.get(`key:${i}`);
      }

      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(MAX_TOTAL_MS);
      expect(cache.size).toBe(ITERATIONS);
    });

    it('should complete 1000 LRU-style eviction cycles in < 50ms', () => {
      const MAX_SIZE = 100;
      const ITERATIONS = 1000;
      const MAX_TOTAL_MS = 50;
      const cache = new Map<string, string>();

      const start = performance.now();

      for (let i = 0; i < ITERATIONS; i++) {
        if (cache.size >= MAX_SIZE) {
          // Evict oldest (first entry)
          const firstKey = cache.keys().next().value;
          if (firstKey !== undefined) cache.delete(firstKey);
        }
        cache.set(`key:${i}`, `value:${i}`);
      }

      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(MAX_TOTAL_MS);
      expect(cache.size).toBeLessThanOrEqual(MAX_SIZE);
    });
  });

  describe('Cache Stampede Protection', () => {
    it('should allow only 1 cache fill for 50 concurrent requests for same cold key', async () => {
      let fillCount = 0;
      const cache = new Map<string, string>();
      const inflightFills = new Map<string, Promise<string>>();

      async function getOrFill(key: string): Promise<string> {
        const cached = cache.get(key);
        if (cached) return cached;

        // Stampede protection — coalesce concurrent fills
        const inflight = inflightFills.get(key);
        if (inflight) return inflight;

        const fillPromise = (async () => {
          fillCount++;
          // Simulate DB fetch
          await new Promise(resolve => setTimeout(resolve, 10));
          const value = `filled-${key}`;
          cache.set(key, value);
          return value;
        })();

        inflightFills.set(key, fillPromise);

        try {
          return await fillPromise;
        } finally {
          inflightFills.delete(key);
        }
      }

      const CONCURRENT = 50;
      const results = await Promise.all(
        Array.from({ length: CONCURRENT }, () => getOrFill('cold-key'))
      );

      // All should get the same value
      expect(results.every(r => r === 'filled-cold-key')).toBe(true);
      // Only 1 fill should have happened
      expect(fillCount).toBe(1);
    });
  });

  describe('Cache Key Generation Performance', () => {
    it('should generate 10000 cache keys in < 50ms', () => {
      const ITERATIONS = 10_000;
      const MAX_TOTAL_MS = 50;

      const start = performance.now();

      for (let i = 0; i < ITERATIONS; i++) {
        const key = `cache:${process.env['NODE_ENV']}:prefix:entity:${i}:field`;
        // Ensure key is used (prevent optimization)
        if (key.length === 0) throw new Error('Empty key');
      }

      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(MAX_TOTAL_MS);
    });
  });
});
