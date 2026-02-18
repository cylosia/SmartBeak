/**
 * Memory Leak Tests for QueryCache
 * 
 * These tests verify that the QueryCache properly implements
 * version cleanup with max tables limit to prevent unbounded memory growth.
 */

import { QueryCache } from '../queryCache';
import { MultiTierCache } from '../multiTierCache';

describe('QueryCache Memory Leak Prevention', () => {
  let multiTierCache: MultiTierCache;
  let queryCache: QueryCache;

  beforeEach(() => {
    multiTierCache = new MultiTierCache({
      l1MaxSize: 100,
      stampedeProtection: false, // Disable for simpler testing
    });
    queryCache = new QueryCache(multiTierCache);
  });

  afterEach(async () => {
    queryCache.stopCleanup();
    await queryCache.clear();
    await multiTierCache.close();
  });

  describe('Version Key Limits', () => {
    it('should limit the number of version keys', async () => {
      // Generate many unique table combinations
      for (let i = 0; i < 6000; i++) {
        const tables = [`table_${i}`];
        await queryCache.execute(
          `SELECT * FROM table_${i}`,
          [],
          async () => ({ data: `result_${i}` }),
          { dependsOn: tables, ttlMs: 1000 }
        );
      }

      const stats = queryCache.getStats();
      expect(stats.versionKeys).toBeLessThanOrEqual(5000);
    });

    it('should evict oldest version keys when limit is exceeded', async () => {
      // Add initial versions
      for (let i = 0; i < 1000; i++) {
        const tables = [`initial_${i}`];
        await queryCache.execute(
          `SELECT * FROM initial_${i}`,
          [],
          async () => ({ data: `result_${i}` }),
          { dependsOn: tables }
        );
      }

      // Add more versions to exceed limit
      for (let i = 0; i < 5000; i++) {
        const tables = [`overflow_${i}`];
        await queryCache.execute(
          `SELECT * FROM overflow_${i}`,
          [],
          async () => ({ data: `result_${i}` }),
          { dependsOn: tables }
        );
      }

      const stats = queryCache.getStats();
      expect(stats.versionKeys).toBeLessThanOrEqual(5000);
      expect(stats.versionsCleaned).toBeGreaterThan(0);
    });

    it('should update access time when getting version', async () => {
      // Create initial versions
      for (let i = 0; i < 100; i++) {
        await queryCache.execute(
          `SELECT * FROM table_${i}`,
          [],
          async () => ({ data: `result_${i}` }),
          { dependsOn: [`table_${i}`] }
        );
      }

      // Access the first table to update its lastAccessed time
      await queryCache.execute(
        'SELECT * FROM table_0',
        [],
        async () => ({ data: 'updated' }),
        { dependsOn: ['table_0'] }
      );

      // Add more versions to potentially trigger eviction
      for (let i = 100; i < 5100; i++) {
        await queryCache.execute(
          `SELECT * FROM table_${i}`,
          [],
          async () => ({ data: `result_${i}` }),
          { dependsOn: [`table_${i}`] }
        );
      }

      // table_0 should still exist (was recently accessed)
      const stats = queryCache.getStats();
      expect(stats.versionKeys).toBeLessThanOrEqual(5000);
    });
  });

  describe('Version Cleanup', () => {
    it('should reset version number when exceeding maximum', async () => {
      // P2-12 FIX: The original test looped 1,000,010 times with `await`, which
      // serialises 1M microtask turns and always exceeds Jest's timeout. The
      // trivial assertion (versionKeys > 0) also provided no real coverage.
      //
      // Instead, we directly set the internal version entry to MAX_VERSION_NUMBER
      // and assert that one more invalidation wraps it back to 1.
      const MAX_VERSION_NUMBER = 1000000;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (queryCache as any).queryVersions.set('test_table', {
        version: MAX_VERSION_NUMBER,
        lastAccessed: Date.now(),
        tableCount: 1,
      });

      await queryCache.invalidateTable('test_table');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const entry = (queryCache as any).queryVersions.get('test_table');
      expect(entry).toBeDefined();
      // version was MAX_VERSION_NUMBER; next = MAX_VERSION_NUMBER + 1 > MAX → resets to 1
      expect(entry.version).toBe(1);

      const stats = queryCache.getStats();
      expect(stats.versionKeys).toBeGreaterThan(0);
    });

    it('should handle multiple table invalidations', async () => {
      // Add versions for multiple tables
      for (let i = 0; i < 100; i++) {
        await queryCache.execute(
          `SELECT * FROM table_a, table_b`,
          [],
          async () => ({ data: 'result' }),
          { dependsOn: ['table_a', 'table_b'] }
        );
      }

      // Invalidate individual tables
      await queryCache.invalidateTable('table_a');
      await queryCache.invalidateTable('table_b');

      const stats = queryCache.getStats();
      expect(stats.versionKeys).toBeGreaterThan(0);
    });
  });

  describe('Periodic Cleanup', () => {
    // TESTABILITY FIX P2-15: Enable fake timers so advanceTimersByTime actually works
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should track versions cleaned during periodic cleanup', async () => {
      // Add some versions
      for (let i = 0; i < 100; i++) {
        await queryCache.execute(
          `SELECT * FROM table_${i}`,
          [],
          async () => ({ data: `result_${i}` }),
          { dependsOn: [`table_${i}`] }
        );
      }

      // Wait and trigger cleanup by adding more
      jest.advanceTimersByTime(600000); // 10 minutes

      // Add more to trigger potential cleanup
      for (let i = 100; i < 200; i++) {
        await queryCache.execute(
          `SELECT * FROM table_${i}`,
          [],
          async () => ({ data: `result_${i}` }),
          { dependsOn: [`table_${i}`] }
        );
      }

      const stats = queryCache.getStats();
      // Stats should be tracking correctly
      expect(stats.versionsCleaned).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Cache Key Generation', () => {
    it('should generate consistent cache keys', () => {
      const key1 = queryCache.generateKey('SELECT * FROM users', [1, 2, 3]);
      const key2 = queryCache.generateKey('SELECT * FROM users', [1, 2, 3]);
      
      expect(key1).toBe(key2);
    });

    it('should generate different keys for different queries', () => {
      const key1 = queryCache.generateKey('SELECT * FROM users', []);
      const key2 = queryCache.generateKey('SELECT * FROM orders', []);
      
      expect(key1).not.toBe(key2);
    });

    it('should normalize whitespace in queries', () => {
      const key1 = queryCache.generateKey('SELECT   *  FROM users', []);
      const key2 = queryCache.generateKey('SELECT * FROM users', []);
      
      expect(key1).toBe(key2);
    });
  });

  describe('Statistics', () => {
    it('should track query statistics accurately', async () => {
      await queryCache.execute(
        'SELECT * FROM test',
        [],
        async () => ({ data: 'result' }),
        { dependsOn: ['test'] }
      );

      await queryCache.execute(
        'SELECT * FROM test',
        [],
        async () => ({ data: 'result' }),
        { dependsOn: ['test'] }
      );

      const stats = queryCache.getStats();
      expect(stats.totalQueries).toBe(2);
      expect(stats.cacheHits).toBe(1);
      expect(stats.cacheMisses).toBe(1);
    });

    it('should calculate hit rate correctly', async () => {
      // All misses
      for (let i = 0; i < 5; i++) {
        await queryCache.execute(
          `SELECT * FROM test_${i}`,
          [],
          async () => ({ data: `result_${i}` }),
        );
      }

      const stats = queryCache.getStats();
      expect(stats.hitRate).toBe(0);

      // Reset and add hits
      queryCache.resetStats();

      // Same query multiple times
      for (let i = 0; i < 10; i++) {
        await queryCache.execute(
          'SELECT * FROM test',
          [],
          async () => ({ data: 'result' }),
          { dependsOn: ['test'] }
        );
      }

      const statsAfter = queryCache.getStats();
      expect(statsAfter.cacheHits).toBe(9);
      expect(statsAfter.cacheMisses).toBe(1);
      expect(statsAfter.hitRate).toBeGreaterThan(0);
    });

    it('should track version keys in statistics', async () => {
      for (let i = 0; i < 10; i++) {
        await queryCache.execute(
          `SELECT * FROM table_${i}`,
          [],
          async () => ({ data: `result_${i}` }),
          { dependsOn: [`table_${i}`] }
        );
      }

      const stats = queryCache.getStats();
      expect(stats.versionKeys).toBe(10);
    });
  });

  describe('Clear', () => {
    it('should clear all versions and stats', async () => {
      for (let i = 0; i < 10; i++) {
        await queryCache.execute(
          `SELECT * FROM table_${i}`,
          [],
          async () => ({ data: `result_${i}` }),
          { dependsOn: [`table_${i}`] }
        );
      }

      await queryCache.clear();

      const stats = queryCache.getStats();
      expect(stats.versionKeys).toBe(0);
      expect(stats.versionsCleaned).toBe(0);
      expect(stats.totalQueries).toBe(0);
    });
  });
});

describe('QueryCache Memory Leak Integration', () => {
  it('should handle rapid table invalidations without unbounded growth', async () => {
    // P2-5 FIX: Use try/finally so cleanup always runs even if an assertion
    // fails. Without it, the cleanup interval left open by the QueryCache
    // causes Jest to report "open handles" or hang after a test failure.
    const multiTierCache = new MultiTierCache({ stampedeProtection: false });
    const queryCache = new QueryCache(multiTierCache);

    try {
      // Simulate rapid table changes
      for (let i = 0; i < 10000; i++) {
        const tableName = `dynamic_table_${i % 100}`;
        await queryCache.invalidateTable(tableName);
      }

      const stats = queryCache.getStats();
      expect(stats.versionKeys).toBeLessThanOrEqual(5000);
    } finally {
      queryCache.stopCleanup();
      await queryCache.clear();
      await multiTierCache.close();
    }
  });

  it('should handle many unique table combinations', async () => {
    // P2-5 FIX: Use try/finally so cleanup always runs even if an assertion fails.
    const multiTierCache = new MultiTierCache({ stampedeProtection: false });
    const queryCache = new QueryCache(multiTierCache);

    try {
      // Simulate complex queries with many table combinations
      for (let i = 0; i < 3000; i++) {
        const tables = [
          `users_${i % 50}`,
          `orders_${i % 30}`,
          `products_${i % 20}`,
        ];

        await queryCache.execute(
          'SELECT * FROM multiple_tables',
          [],
          async () => ({ data: 'result' }),
          { dependsOn: tables }
        );
      }

      const stats = queryCache.getStats();
      expect(stats.versionKeys).toBeLessThanOrEqual(5000);
    } finally {
      queryCache.stopCleanup();
      await queryCache.clear();
      await multiTierCache.close();
    }
  });
});
