/**
 * Memory Leak Tests for Metrics Collector
 * 
 * These tests verify that the MetricsCollector properly implements
 * LRU eviction to prevent unbounded memory growth.
 */

import { vi } from 'vitest';
import { MetricsCollector, AggregationConfig } from '../metrics-collector';

describe('MetricsCollector Memory Leak Prevention', () => {
  let collector: MetricsCollector;

  beforeEach(() => {
    collector = new MetricsCollector({
      intervalMs: 60000,
      retentionMs: 3600000,
      maxKeys: 100, // Small limit for testing
      enableSizeMonitoring: true,
    });
  });

  afterEach(() => {
    collector.stop();
    collector.clear();
  });

  describe('LRU Eviction', () => {
    it('should limit the number of metric keys', () => {
      // Generate many unique metric keys
      for (let i = 0; i < 150; i++) {
        collector.counter('test_metric', 1, { id: `label_${i}` });
      }

      const stats = collector.getStats();
      expect(stats.totalKeys).toBeLessThanOrEqual(100);
    });

    it('should evict oldest keys when limit is exceeded', () => {
      // Add initial keys
      for (let i = 0; i < 50; i++) {
        collector.counter('first_batch', 1, { id: `label_${i}` });
      }

      // Add more keys to exceed limit
      for (let i = 0; i < 100; i++) {
        collector.counter('second_batch', 1, { id: `label_${i}` });
      }

      const stats = collector.getStats();
      expect(stats.totalKeys).toBeLessThanOrEqual(100);
      expect(stats.keysEvicted).toBeGreaterThan(0);
    });

    it('should update LRU order on access', () => {
      // Add initial keys
      for (let i = 0; i < 50; i++) {
        collector.counter('metric', 1, { id: `label_${i}` });
      }

      // Access the first key to make it recently used
      collector.counter('metric', 1, { id: `label_0` });

      // Add more keys to exceed limit
      for (let i = 50; i < 150; i++) {
        collector.counter('metric', 1, { id: `label_${i}` });
      }

      // Check that the accessed key still exists (has value 2 from two increments)
      const aggregation = collector.getAggregation('metric', { id: 'label_0' });
      expect(aggregation).toBeDefined();
      expect(aggregation?.count).toBe(2);
    });

    it('should emit keysEvicted event when evicting', async () => {
      const evictedPromise = new Promise<void>((resolve) => {
        collector.on('keysEvicted', (data) => {
          expect(data.evicted).toBeGreaterThan(0);
          expect(data.totalEvicted).toBeGreaterThan(0);
          resolve();
        });
      });

      // Add keys to trigger eviction
      for (let i = 0; i < 150; i++) {
        collector.counter('test_metric', 1, { id: `label_${i}` });
      }

      await evictedPromise;
    });

    it('should handle high key count alert', async () => {
      const highKeyCountPromise = new Promise<void>((resolve) => {
        collector.on('highKeyCount', (data) => {
          expect(data.keyCount).toBeGreaterThan(0);
          expect(data.maxKeys).toBe(100);
          expect(data.utilization).toBeGreaterThan(0);
          resolve();
        });
      });

      collector.start();

      // Add keys to approach limit (80% threshold = 80 keys)
      for (let i = 0; i < 85; i++) {
        collector.counter('test_metric', 1, { id: `label_${i}` });
      }

      // Wait for monitoring interval
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          collector.stop();
          resolve();
        }, 100);
      });

      await highKeyCountPromise;
    });
  });

  describe('Metric Recording', () => {
    it('should clean old metrics based on retention period', () => {
      const shortRetentionCollector = new MetricsCollector({
        retentionMs: 100, // 100ms retention for testing
        maxKeys: 1000,
      });

      // Add a metric
      shortRetentionCollector.counter('test_metric', 1);
      
      // Wait for retention period to pass
      vi.advanceTimersByTime(200);

      // Add another metric to trigger cleanup
      shortRetentionCollector.counter('test_metric', 1);

      const aggregation = shortRetentionCollector.getAggregation('test_metric');
      // Should only have the new metric
      expect(aggregation?.count).toBe(1);

      shortRetentionCollector.clear();
    });

    it('should track key count accurately', () => {
      collector.counter('metric_a', 1);
      collector.counter('metric_a', 1, { label: 'value' });
      collector.counter('metric_b', 1);

      const stats = collector.getStats();
      expect(stats.totalKeys).toBe(3);
    });

    it('should track total metrics count', () => {
      for (let i = 0; i < 10; i++) {
        collector.counter('metric_a', 1);
      }
      collector.counter('metric_b', 1);

      const stats = collector.getStats();
      expect(stats.totalMetrics).toBe(11);
    });
  });

  describe('Statistics', () => {
    it('should return accurate stats', () => {
      collector.counter('test', 1);
      collector.counter('test', 1, { label: 'a' });
      collector.gauge('gauge_test', 100);

      const stats = collector.getStats();
      expect(stats.totalKeys).toBe(3);
      expect(stats.aggregationsCount).toBe(0); // No aggregation run yet
      expect(stats.keysEvicted).toBe(0);
    });

    it('should track evicted keys across multiple evictions', () => {
      const smallCollector = new MetricsCollector({
        maxKeys: 10,
      });

      // First batch - fills to 10
      for (let i = 0; i < 10; i++) {
        smallCollector.counter('metric', 1, { id: `${i}` });
      }
      
      // Second batch - should evict
      for (let i = 10; i < 20; i++) {
        smallCollector.counter('metric', 1, { id: `${i}` });
      }

      // Third batch - more evictions
      for (let i = 20; i < 30; i++) {
        smallCollector.counter('metric', 1, { id: `${i}` });
      }

      const stats = smallCollector.getStats();
      expect(stats.keysEvicted).toBe(20);
      expect(stats.totalKeys).toBe(10);

      smallCollector.clear();
    });
  });

  describe('Clear', () => {
    it('should clear all data', () => {
      collector.counter('test', 1);
      collector.counter('test', 1, { label: 'value' });

      collector.clear();

      const stats = collector.getStats();
      expect(stats.totalKeys).toBe(0);
      expect(stats.totalMetrics).toBe(0);
      expect(stats.keysEvicted).toBe(0);
    });
  });

  describe('Default Configuration', () => {
    it('should use default max keys when not specified', () => {
      const defaultCollector = new MetricsCollector();
      
      // Add many keys
      for (let i = 0; i < 11000; i++) {
        defaultCollector.counter('metric', 1, { id: `${i}` });
      }

      const stats = defaultCollector.getStats();
      // Default max is 10000
      expect(stats.totalKeys).toBeLessThanOrEqual(10000);
      expect(stats.keysEvicted).toBeGreaterThan(0);

      defaultCollector.clear();
    });
  });
});

describe('MetricsCollector Memory Leak Integration', () => {
  it('should handle rapid metric recording without unbounded growth', () => {
    const collector = new MetricsCollector({
      maxKeys: 50,
    });

    // Simulate high-frequency metric recording with dynamic labels
    const iterations = 1000;
    for (let i = 0; i < iterations; i++) {
      // Simulate request ID based metrics (common memory leak source)
      collector.counter('http_requests', 1, { 
        requestId: `req_${i}`,
        endpoint: '/api/test',
      });
      
      // Simulate user ID based metrics
      collector.counter('user_actions', 1, {
        userId: `user_${i % 200}`, // Some repetition
        action: 'click',
      });
    }

    const stats = collector.getStats();
    expect(stats.totalKeys).toBeLessThanOrEqual(50);
    expect(stats.keysEvicted).toBeGreaterThan(0);

    collector.clear();
  });

  it('should handle mixed metric types without memory leaks', () => {
    const collector = new MetricsCollector({
      maxKeys: 100,
    });

    for (let i = 0; i < 200; i++) {
      collector.counter('counter_metric', i);
      collector.gauge('gauge_metric', Math.random() * 100, { id: `${i}` });
      collector.histogram('histogram_metric', Math.random() * 1000, { id: `${i}` });
      collector.timing('timing_metric', Math.random() * 100, { id: `${i}` });
    }

    const stats = collector.getStats();
    expect(stats.totalKeys).toBeLessThanOrEqual(100);

    collector.clear();
  });
});
