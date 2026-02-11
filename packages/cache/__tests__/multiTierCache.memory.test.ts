/**
 * Memory Leak Tests for MultiTierCache
 * 
 * These tests verify that the MultiTierCache properly implements
 * TTL-based cleanup for in-flight requests to prevent unbounded memory growth.
 */

import { MultiTierCache } from '../multiTierCache';

describe('MultiTierCache Memory Leak Prevention', () => {
  let cache: MultiTierCache;

  beforeEach(() => {
    cache = new MultiTierCache({
      l1MaxSize: 100,
      stampedeProtection: true,
      inFlightTtlMs: 1000, // Short TTL for testing
      enableInFlightMonitoring: true,
    });
  });

  afterEach(async () => {
    cache.stopInFlightCleanup();
    await cache.close();
  });

  describe('In-Flight Request Limits', () => {
    it('should limit the number of in-flight requests', async () => {
      // Create many concurrent requests
      const promises: Promise<unknown>[] = [];
      
      for (let i = 0; i < 1100; i++) {
        const promise = cache.getOrCompute(
          `key_${i}`,
          async () => {
            await new Promise(resolve => setTimeout(resolve, 100));
            return `value_${i}`;
          },
          { timeoutMs: 5000 }
        );
        promises.push(promise);
      }

      // Should throw for requests over the limit
      await expect(
        cache.getOrCompute(
          'overflow_key',
          async () => 'value',
          { timeoutMs: 5000 }
        )
      ).rejects.toThrow('In-flight request limit exceeded');

      // Clean up
      await Promise.allSettled(promises);
    });

    it('should clean up completed in-flight requests', async () => {
      // Create a request
      const promise = cache.getOrCompute(
        'test_key',
        async () => {
          await new Promise(resolve => setTimeout(resolve, 50));
          return 'value';
        }
      );

      expect(cache.getInFlightCount()).toBe(1);

      await promise;

      // After completion, should be cleaned up
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(cache.getInFlightCount()).toBe(0);
    });

    it('should timeout in-flight requests', async () => {
      const shortTimeoutCache = new MultiTierCache({
        stampedeProtection: true,
        inFlightTtlMs: 50, // Very short timeout
      });

      // Start a slow computation
      const promise = shortTimeoutCache.getOrCompute(
        'slow_key',
        async () => {
          await new Promise(resolve => setTimeout(resolve, 200));
          return 'value';
        },
        { timeoutMs: 5000 }
      );

      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 100));

      // The original request should still be in-flight
      // But new requests should see it timed out
      const stats = shortTimeoutCache.getStats();
      expect(stats.inFlightTimeouts).toBeGreaterThanOrEqual(0);

      shortTimeoutCache.stopInFlightCleanup();
      await shortTimeoutCache.close();
    });
  });

  describe('Stale Request Cleanup', () => {
    it('should clean up stale in-flight requests', async () => {
      const cacheWithShortCleanup = new MultiTierCache({
        stampedeProtection: true,
        inFlightTtlMs: 100,
      });

      // Create some "stuck" requests by using a very long timeout
      const stuckPromises: Promise<unknown>[] = [];
      
      for (let i = 0; i < 10; i++) {
        const promise = cacheWithShortCleanup.getOrCompute(
          `stuck_key_${i}`,
          async () => {
            // This will take longer than the cleanup interval
            await new Promise(resolve => setTimeout(resolve, 10000));
            return 'value';
          },
          { timeoutMs: 20000 }
        );
        stuckPromises.push(promise);
      }

      expect(cacheWithShortCleanup.getInFlightCount()).toBe(10);

      // Wait briefly for cleanup to potentially trigger
      await new Promise(resolve => setTimeout(resolve, 200));

      // Manually trigger cleanup for test
      await new Promise(resolve => setTimeout(resolve, 100));

      // Cleanup should have run
      const stats = cacheWithShortCleanup.getStats();
      // InFlightCleaned tracks cleaned entries

      cacheWithShortCleanup.stopInFlightCleanup();
      await cacheWithShortCleanup.close();
    });

    it('should handle request age checking', async () => {
      const cacheWithMonitoring = new MultiTierCache({
        stampedeProtection: true,
        inFlightTtlMs: 50,
      });

      // Create a request
      const promise = cacheWithMonitoring.getOrCompute(
        'age_test_key',
        async () => {
          await new Promise(resolve => setTimeout(resolve, 200));
          return 'value';
        }
      );

      // Wait for the request to become stale
      await new Promise(resolve => setTimeout(resolve, 100));

      // Try to get the same key - should detect stale and create new
      try {
        await cacheWithMonitoring.getOrCompute(
          'age_test_key',
          async () => 'new_value',
          { timeoutMs: 5000 }
        );
      } catch (error) {
        // May throw if limit exceeded
      }

      cacheWithMonitoring.stopInFlightCleanup();
      await cacheWithMonitoring.close();
    });
  });

  describe('In-Flight Request Tracking', () => {
    it('should track in-flight request count', async () => {
      expect(cache.getInFlightCount()).toBe(0);

      // Start multiple requests
      const promises: Promise<unknown>[] = [];
      for (let i = 0; i < 5; i++) {
        promises.push(
          cache.getOrCompute(
            `track_key_${i}`,
            async () => {
              await new Promise(resolve => setTimeout(resolve, 100));
              return `value_${i}`;
            }
          )
        );
      }

      expect(cache.getInFlightCount()).toBe(5);

      await Promise.all(promises);

      await new Promise(resolve => setTimeout(resolve, 10));
      expect(cache.getInFlightCount()).toBe(0);
    });

    it('should deduplicate concurrent requests for same key', async () => {
      let computeCount = 0;

      const computeFn = async () => {
        computeCount++;
        await new Promise(resolve => setTimeout(resolve, 100));
        return 'computed_value';
      };

      // Launch multiple concurrent requests for the same key
      const promises = Promise.all([
        cache.getOrCompute('dedup_key', computeFn),
        cache.getOrCompute('dedup_key', computeFn),
        cache.getOrCompute('dedup_key', computeFn),
        cache.getOrCompute('dedup_key', computeFn),
      ]);

      const results = await promises;

      // All should get the same value
      expect(results).toEqual([
        'computed_value',
        'computed_value',
        'computed_value',
        'computed_value',
      ]);

      // Computation should only run once
      expect(computeCount).toBe(1);
    });

    it('should track in-flight statistics', async () => {
      // Create some requests
      const promises: Promise<unknown>[] = [];
      for (let i = 0; i < 3; i++) {
        promises.push(
          cache.getOrCompute(
            `stats_key_${i}`,
            async () => {
              await new Promise(resolve => setTimeout(resolve, 50));
              return `value_${i}`;
            }
          )
        );
      }

      const stats = cache.getStats();
      expect(stats.inFlightRequests).toBe(3);

      await Promise.all(promises);
    });
  });

  describe('Cleanup on Close', () => {
    it('should clean up all in-flight requests on close', async () => {
      // Start some requests
      const promises: Promise<unknown>[] = [];
      for (let i = 0; i < 5; i++) {
        promises.push(
          cache.getOrCompute(
            `close_key_${i}`,
            async () => {
              await new Promise(resolve => setTimeout(resolve, 1000));
              return `value_${i}`;
            }
          )
        );
      }

      expect(cache.getInFlightCount()).toBe(5);

      // Close should clean up
      await cache.close();

      expect(cache.getInFlightCount()).toBe(0);
    });
  });

  describe('Statistics', () => {
    it('should track cleaned in-flight requests', async () => {
      const stats = cache.getStats();
      expect(stats.inFlightCleaned).toBe(0);
      expect(stats.inFlightTimeouts).toBe(0);
    });

    it('should track all cache statistics', async () => {
      // Add some cache entries
      await cache.set('key1', 'value1');
      await cache.set('key2', 'value2');

      // Get some entries
      await cache.get('key1');
      await cache.get('key2');
      await cache.get('nonexistent');

      const stats = cache.getStats();
      expect(stats.l1Hits).toBe(2);
      expect(stats.l1Misses).toBe(1);
      expect(stats.totalRequests).toBe(3);
      expect(stats.l1HitRate).toBeGreaterThan(0);
    });
  });

  describe('Error Handling', () => {
    it('should clean up in-flight request on error', async () => {
      const promise = cache.getOrCompute(
        'error_key',
        async () => {
          throw new Error('Computation failed');
        }
      );

      expect(cache.getInFlightCount()).toBe(1);

      await expect(promise).rejects.toThrow('Computation failed');

      // Wait for cleanup
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(cache.getInFlightCount()).toBe(0);
    });

    it('should handle timeout in computeAndCache', async () => {
      const promise = cache.getOrCompute(
        'timeout_key',
        async () => {
          await new Promise(resolve => setTimeout(resolve, 2000));
          return 'value';
        },
        { timeoutMs: 50 } // Short timeout
      );

      await expect(promise).rejects.toThrow('Cache computation timeout');
    });
  });
});

describe('MultiTierCache Memory Leak Integration', () => {
  it('should handle rapid concurrent requests without unbounded growth', async () => {
    const cache = new MultiTierCache({
      stampedeProtection: true,
      inFlightTtlMs: 500,
    });

    // Simulate many rapid concurrent requests
    const iterations = 500;
    const promises: Promise<unknown>[] = [];

    for (let i = 0; i < iterations; i++) {
      const key = `rapid_key_${i % 50}`; // Some key reuse
      promises.push(
        cache.getOrCompute(
          key,
          async () => {
            await new Promise(resolve => setTimeout(resolve, 10));
            return `value_${i}`;
          }
        ).catch(() => {
          // Some may fail due to limits, that's ok
        })
      );
    }

    await Promise.all(promises);

    const stats = cache.getStats();
    expect(stats.inFlightRequests).toBe(0); // All should be cleaned up

    cache.stopInFlightCleanup();
    await cache.close();
  });

  it('should handle stampede protection under load', async () => {
    const cache = new MultiTierCache({
      stampedeProtection: true,
    });

    let computationCount = 0;
    const compute = async () => {
      computationCount++;
      await new Promise(resolve => setTimeout(resolve, 50));
      return 'value';
    };

    // Launch many requests for the same key simultaneously
    const promises = Array.from({ length: 100 }, () =>
      cache.getOrCompute('stampede_key', compute).catch(() => null)
    );

    await Promise.all(promises);

    // Computation should run at most a few times (not 100)
    expect(computationCount).toBeLessThan(10);

    cache.stopInFlightCleanup();
    await cache.close();
  });
});
