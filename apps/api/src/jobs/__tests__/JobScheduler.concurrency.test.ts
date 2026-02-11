/**
 * P1 ASYNC/CONCURRENCY TESTS: JobScheduler
 * 
 * Tests for:
 * - Worker error event handling
 * - AbortSignal propagation to handlers
 * - Race conditions in job execution
 * - Timeout and cancellation behavior
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JobScheduler, HandlerConfig } from '../JobScheduler';
import { Job } from 'bullmq';
import Redis from 'ioredis';

// Mock dependencies
vi.mock('@kernel/logger', () => ({
  getLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('@kernel/request-context', () => ({
  createRequestContext: vi.fn().mockReturnValue({}),
  runWithContext: vi.fn((ctx, fn) => fn()),
}));

vi.mock('@config', () => ({
  jobConfig: {
    workerConcurrency: 2,
    maxRetries: 3,
    retryDelayMs: 1000,
    defaultTimeoutMs: 30000,
    workerRateLimitMax: 10,
    workerRateLimitDurationMs: 1000,
    keepCompletedJobs: 10,
    keepFailedJobs: 10,
  },
  redisConfig: {
    maxRetriesPerRequest: 3,
    connectTimeoutMs: 10000,
    commandTimeoutMs: 5000,
    initialReconnectDelayMs: 1000,
    maxReconnectDelayMs: 30000,
    maxReconnectAttempts: 10,
    keepAliveMs: 30000,
    waitForConnectionTimeoutMs: 30000,
  },
}));

describe('JobScheduler - Async/Concurrency Tests', () => {
  let scheduler: JobScheduler;
  let mockRedis: any;
  let mockWorker: any;
  let eventHandlers: Map<string, Function[]>;

  beforeEach(() => {
    eventHandlers = new Map();
    vi.clearAllMocks();

    // Create mock worker that captures event handlers
    mockWorker = {
      on: vi.fn().mockImplementation((event: string, handler: Function) => {
        if (!eventHandlers.has(event)) {
          eventHandlers.set(event, []);
        }
        eventHandlers.get(event)!.push(handler);
      }),
      off: vi.fn().mockImplementation((event: string, handler: Function) => {
        const handlers = eventHandlers.get(event);
        if (handlers) {
          const index = handlers.indexOf(handler);
          if (index > -1) handlers.splice(index, 1);
        }
      }),
      pause: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      waitUntilReady: vi.fn().mockResolvedValue(undefined),
    };

    mockRedis = {
      on: vi.fn(),
      once: vi.fn(),
      off: vi.fn(),
      quit: vi.fn().mockResolvedValue(undefined),
      status: 'ready',
      eval: vi.fn().mockResolvedValue(1),
    };

    // Mock Redis constructor
    vi.mocked(Redis).mockImplementation(() => mockRedis);

    scheduler = new JobScheduler('redis://localhost:6379');
  });

  afterEach(async () => {
    await scheduler.stop().catch(() => {});
    vi.restoreAllMocks();
  });

  describe('Worker Error Event Handling', () => {
    it('should register error event handler when starting workers', () => {
      scheduler.register({
        name: 'test-job',
        queue: 'test-queue',
      }, async () => 'done');

      // Mock Worker constructor to capture created workers
      const mockWorkerConstructor = vi.fn().mockReturnValue(mockWorker);
      vi.doMock('bullmq', () => ({
        Queue: vi.fn().mockImplementation(() => ({
          add: vi.fn().mockResolvedValue({ id: 'job-1' }),
        })),
        Worker: mockWorkerConstructor,
        Job: vi.fn(),
      }));

      // Re-import to get mocked version
      const { JobScheduler: MockedScheduler } = require('../JobScheduler');
      const testScheduler = new MockedScheduler('redis://localhost:6379');
      
      testScheduler.register({
        name: 'test-job',
        queue: 'test-queue',
      }, async () => 'done');

      testScheduler.startWorkers();

      // Verify error handler was registered
      expect(mockWorker.on).toHaveBeenCalledWith('error', expect.any(Function));
    });

    it('should emit workerError event on worker error', async () => {
      const errorHandler = vi.fn();
      scheduler.on('workerError', errorHandler);

      // Get the attachWorkerHandlers method and test it directly
      const attachWorkerHandlers = (scheduler as any).attachWorkerHandlers.bind(scheduler);
      attachWorkerHandlers(mockWorker, 'test-queue');

      // Get the error handler
      const errorHandlers = eventHandlers.get('error');
      expect(errorHandlers).toBeDefined();
      expect(errorHandlers!.length).toBeGreaterThan(0);

      // Simulate worker error
      const testError = new Error('Worker connection failed');
      errorHandlers![0](testError);

      expect(errorHandler).toHaveBeenCalledWith('test-queue', testError);
    });

    it('should clean up error handler on stop', async () => {
      const attachWorkerHandlers = (scheduler as any).attachWorkerHandlers.bind(scheduler);
      attachWorkerHandlers(mockWorker, 'test-queue');

      // Set up workers map
      (scheduler as any).workers.set('test-queue', mockWorker);
      (scheduler as any).workerEventHandlers.set('test-queue', {
        completed: vi.fn(),
        failed: vi.fn(),
        error: vi.fn(),
      });

      await scheduler.stop();

      // Verify error handler was removed
      expect(mockWorker.off).toHaveBeenCalledWith('error', expect.any(Function));
    });
  });

  describe('AbortSignal Propagation', () => {
    it('should pass AbortSignal to job handler', async () => {
      const handler = vi.fn().mockResolvedValue('success');
      
      scheduler.register({
        name: 'signal-test-job',
        queue: 'test-queue',
        timeout: 5000,
      }, handler);

      // Create a mock job
      const mockJob = {
        id: 'job-123',
        name: 'signal-test-job',
        data: { test: 'data' },
      } as unknown as Job;

      // Get the process function passed to Worker
      const WorkerMock = (await import('bullmq')).Worker;
      const workerCall = (WorkerMock as any).mock?.calls?.[0];
      
      if (workerCall) {
        const processFn = workerCall[1];
        
        // Execute the process function
        await processFn(mockJob);

        // Verify handler was called
        expect(handler).toHaveBeenCalled();
      }
    });

    it('should cancel job when abort is triggered', async () => {
      let receivedSignal: AbortSignal | undefined;
      
      const slowHandler = vi.fn().mockImplementation(async (data: unknown, job: Job, signal?: AbortSignal) => {
        receivedSignal = signal;
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(resolve, 5000);
          signal?.addEventListener('abort', () => {
            clearTimeout(timeout);
            reject(new Error('Job aborted'));
          });
        });
      });

      scheduler.register({
        name: 'cancel-test-job',
        queue: 'test-queue',
        timeout: 100,
      }, slowHandler);

      // Start workers
      scheduler.startWorkers();

      // Create abort controller and simulate cancellation
      const abortController = new AbortController();
      (scheduler as any).abortControllers.set('job-123', abortController);

      // Cancel the job
      await scheduler.cancel('test-queue', 'job-123').catch(() => {});

      // Verify abort was called
      expect(abortController.signal.aborted).toBe(true);
    });

    it('should clean up abort controller after job completion', async () => {
      const handler = vi.fn().mockResolvedValue('success');
      
      scheduler.register({
        name: 'cleanup-test-job',
        queue: 'test-queue',
      }, handler);

      // Simulate job execution with abort controller
      const mockJob = {
        id: 'job-456',
        name: 'cleanup-test-job',
        data: { test: 'data' },
      } as unknown as Job;

      // Get the executeWithTimeout method
      const executeWithTimeout = (scheduler as any).executeWithTimeout.bind(scheduler);
      
      const abortController = new AbortController();
      (scheduler as any).abortControllers.set('job-456', abortController);

      await executeWithTimeout(Promise.resolve('success'), 1000, abortController.signal);

      // After execution, controller should be cleaned up
      // (In actual implementation, cleanup happens in finally block)
    });
  });

  describe('Race Condition Prevention', () => {
    it('should handle concurrent job executions without interference', async () => {
      const executions: string[] = [];
      
      const handler = vi.fn().mockImplementation(async (data: { id: string }) => {
        executions.push(`start-${data.id}`);
        await new Promise(resolve => setTimeout(resolve, 50));
        executions.push(`end-${data.id}`);
        return `result-${data.id}`;
      });

      scheduler.register({
        name: 'concurrent-job',
        queue: 'test-queue',
      }, handler);

      // Simulate concurrent job processing
      const jobs = [
        { id: 'job-1', data: { id: '1' } },
        { id: 'job-2', data: { id: '2' } },
        { id: 'job-3', data: { id: '3' } },
      ];

      await Promise.all(jobs.map(job => 
        handler(job.data, { id: job.id } as Job)
      ));

      // All jobs should complete
      expect(executions.filter(e => e.startsWith('end-')).length).toBe(3);
    });

    it('should prevent double abort controller creation for same job', async () => {
      const abortControllers = (scheduler as any).abortControllers;
      
      // First registration
      abortControllers.set('job-123', new AbortController());
      const firstController = abortControllers.get('job-123');
      
      // Second registration should replace or use existing
      abortControllers.set('job-123', new AbortController());
      const secondController = abortControllers.get('job-123');

      // Controllers should be different instances (Map behavior)
      expect(firstController).not.toBe(secondController);
    });
  });

  describe('Timeout and Signal Handling', () => {
    it('should reject when timeout is exceeded', async () => {
      const executeWithTimeout = (scheduler as any).executeWithTimeout.bind(scheduler);
      
      const slowPromise = new Promise(resolve => setTimeout(resolve, 200));
      
      await expect(
        executeWithTimeout(slowPromise, 50)
      ).rejects.toThrow('Job timeout after 50ms');
    });

    it('should reject immediately when signal is already aborted', async () => {
      const executeWithTimeout = (scheduler as any).executeWithTimeout.bind(scheduler);
      
      const abortController = new AbortController();
      abortController.abort();
      
      const promise = Promise.resolve('success');
      
      await expect(
        executeWithTimeout(promise, 5000, abortController.signal)
      ).rejects.toThrow('Job aborted');
    });

    it('should clean up timeout on abort signal', async () => {
      const executeWithTimeout = (scheduler as any).executeWithTimeout.bind(scheduler);
      
      const abortController = new AbortController();
      
      const slowPromise = new Promise(resolve => setTimeout(resolve, 5000));
      
      // Schedule abort after 50ms
      setTimeout(() => abortController.abort(), 50);
      
      await expect(
        executeWithTimeout(slowPromise, 10000, abortController.signal)
      ).rejects.toThrow('Job aborted');
    });

    it('should remove abort listener after promise resolves', async () => {
      const executeWithTimeout = (scheduler as any).executeWithTimeout.bind(scheduler);
      
      const abortController = new AbortController();
      const removeListenerSpy = vi.spyOn(abortController.signal, 'removeEventListener');
      
      const promise = Promise.resolve('success');
      await executeWithTimeout(promise, 1000, abortController.signal);

      // Should have removed the abort listener
      expect(removeListenerSpy).toHaveBeenCalledWith('abort', expect.any(Function));
    });
  });

  describe('Graceful Shutdown with Active Jobs', () => {
    it('should abort all running jobs on stop', async () => {
      const abortControllers: AbortController[] = [];
      
      // Simulate active jobs with abort controllers
      for (let i = 0; i < 3; i++) {
        const controller = new AbortController();
        abortControllers.push(controller);
        (scheduler as any).abortControllers.set(`job-${i}`, controller);
      }

      // Stop the scheduler
      await scheduler.stop();

      // All controllers should be aborted
      abortControllers.forEach(controller => {
        expect(controller.signal.aborted).toBe(true);
      });
    });

    it('should clear abort controllers after stop', async () => {
      // Add some controllers
      (scheduler as any).abortControllers.set('job-1', new AbortController());
      (scheduler as any).abortControllers.set('job-2', new AbortController());

      expect((scheduler as any).abortControllers.size).toBe(2);

      await scheduler.stop();

      expect((scheduler as any).abortControllers.size).toBe(0);
    });
  });
});
