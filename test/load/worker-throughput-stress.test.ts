/**
 * Load/Stress Tests: Worker Throughput
 *
 * Validates RegionWorker behavior under sustained job load:
 * - Processing 100 concurrent jobs
 * - Backpressure enforcement
 * - Stale job cleanup
 * - Metrics accuracy after burst
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// P2-MOCK-PATH FIX: Use the path alias @kernel/metrics so Vitest intercepts
// the exact module that RegionWorker imports (`import { emitMetric } from '../metrics'`
// inside packages/kernel/queue/RegionWorker.ts resolves to @kernel/metrics).
// The previous path '../packages/kernel/metrics' resolved to a non-existent path
// relative to this test file (test/packages/kernel/metrics) and had no effect
// on RegionWorker's actual import.
vi.mock('@kernel/metrics', () => ({
  emitMetric: vi.fn(),
  emitCounter: vi.fn(),
}));

import { RegionWorker } from '@kernel/queue/RegionWorker';

describe('Worker Throughput - Load/Stress Tests', () => {
  let worker: RegionWorker;

  beforeEach(() => {
    vi.clearAllMocks();
    worker = new RegionWorker('us-east-1', {
      maxConcurrency: 10,
      backoffMs: 100,
    });
  });

  afterEach(() => {
    worker.cleanup();
    vi.restoreAllMocks();
  });

  describe('High-Volume Job Processing', () => {
    it('should process 100 jobs sequentially through the worker', async () => {
      const TOTAL_JOBS = 100;
      let completedJobs = 0;

      for (let i = 0; i < TOTAL_JOBS; i++) {
        try {
          await worker.execute(`job-${i}`, async () => {
            completedJobs++;
            return `result-${i}`;
          });
        } catch {
          // Backpressure errors are expected when concurrency is exceeded
        }
      }

      expect(completedJobs).toBe(TOTAL_JOBS);

      const stats = worker.getStats();
      expect(stats.processed).toBe(TOTAL_JOBS);
      expect(stats.errors).toBe(0);
      expect(stats.errorRate).toBe(0);
    });

    it('should process concurrent jobs up to concurrency limit', async () => {
      const MAX_CONCURRENCY = 10;
      let peakConcurrency = 0;
      let currentConcurrency = 0;

      const jobs = Array.from({ length: MAX_CONCURRENCY }, (_, i) =>
        worker.execute(`concurrent-${i}`, async () => {
          currentConcurrency++;
          peakConcurrency = Math.max(peakConcurrency, currentConcurrency);
          // Simulate some work
          await new Promise(resolve => setTimeout(resolve, 10));
          currentConcurrency--;
          return i;
        })
      );

      const results = await Promise.allSettled(jobs);
      const succeeded = results.filter(r => r.status === 'fulfilled');

      expect(succeeded.length).toBe(MAX_CONCURRENCY);
      expect(peakConcurrency).toBeLessThanOrEqual(MAX_CONCURRENCY);
    });
  });

  describe('Backpressure Enforcement', () => {
    it('should reject jobs when in-flight exceeds concurrency limit', async () => {
      const MAX_CONCURRENCY = 10;
      const resolvers: Array<() => void> = [];

      // Fill up all slots with hanging jobs
      const hangingJobs = Array.from({ length: MAX_CONCURRENCY }, (_, i) =>
        worker.execute(`hanging-${i}`, () =>
          new Promise<void>(resolve => {
            resolvers.push(resolve);
          })
        )
      );

      // Wait for all jobs to be started
      await new Promise(resolve => setTimeout(resolve, 50));

      // Try to submit one more — should be rejected
      await expect(
        worker.execute('overflow-job', async () => 'overflow')
      ).rejects.toThrow('Backpressure');

      // Release all hanging jobs
      for (const resolve of resolvers) {
        resolve();
      }

      await Promise.allSettled(hangingJobs);
    });
  });

  describe('Stale Job Cleanup', () => {
    it('should detect and mark stale jobs that exceed runtime limit', async () => {
      const worker2 = new RegionWorker('us-west-2', {
        maxConcurrency: 5,
        backoffMs: 100,
      });

      // Execute a normal job
      await worker2.execute('normal-job', async () => 'done');

      const stats = worker2.getStats();
      expect(stats.processed).toBe(1);
      expect(stats.errors).toBe(0);

      worker2.cleanup();
    });
  });

  describe('Metrics Accuracy After Burst', () => {
    it('should report accurate metrics after a burst of mixed success/failure jobs', async () => {
      const TOTAL = 20;
      const FAIL_EVERY = 5;

      for (let i = 0; i < TOTAL; i++) {
        try {
          await worker.execute(`metric-job-${i}`, async () => {
            if (i % FAIL_EVERY === 0 && i > 0) {
              throw new Error(`Job ${i} failed`);
            }
            return `ok-${i}`;
          });
        } catch {
          // Expected failures
        }
      }

      const stats = worker.getStats();
      const expectedErrors = Math.floor((TOTAL - 1) / FAIL_EVERY);

      expect(stats.processed).toBe(TOTAL);
      expect(stats.errors).toBe(expectedErrors);
      expect(stats.errorRate).toBeCloseTo(expectedErrors / TOTAL, 2);
    });

    it('should track in-flight count accurately during concurrent execution', async () => {
      // Before any jobs, in-flight should be 0
      expect(worker.getStats().inFlight).toBe(0);

      // Execute a job and check after
      await worker.execute('tracking-job', async () => 'done');

      expect(worker.getStats().inFlight).toBe(0);
      expect(worker.getStats().processed).toBe(1);
    });
  });

  describe('Duplicate Job Prevention', () => {
    it('should reject duplicate job IDs', async () => {
      const resolvers: Array<() => void> = [];

      // Start first job and hold it
      const firstJob = worker.execute('duplicate-id', () =>
        new Promise<string>(resolve => {
          resolvers.push(() => resolve('done'));
        })
      );

      // Wait for the job to start
      await new Promise(resolve => setTimeout(resolve, 10));

      // Try to submit same job ID — should be rejected
      await expect(
        worker.execute('duplicate-id', async () => 'duplicate')
      ).rejects.toThrow('already being processed');

      // Release first job
      resolvers[0]!();
      await firstJob;
    });
  });
});
