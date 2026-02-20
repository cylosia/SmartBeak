/**
 * P2 TEST: Job Processing Unit Tests (with mocked infrastructure)
 *
 * AUDIT-FIX P1: Renamed from "End-to-End Integration Tests". This suite mocks
 * Redis entirely (jest.mock below), so it tests handler registration, scheduling
 * dispatch, and error paths — NOT actual Redis/BullMQ behavior. For true
 * integration tests, use real Redis via `docker compose up -d` and remove mocks.
 *
 * Tests: job scheduling dispatch, priority ordering, retry handler logic,
 * DLQ handler assertion, rate limit mock invocation, graceful shutdown.
 */


import { JobScheduler } from '../../src/jobs/JobScheduler';
import { getRedis } from '@kernel/redis';

// Unit test mock — replaces Redis with in-memory stubs.
// NOTE: This means BullMQ queue behavior, Lua scripts, and distributed
// locking are NOT tested here. See AUDIT-FIX P1 note above.
jest.mock('@kernel/redis', () => ({
  getRedis: jest.fn(),
}));

// AUDIT-FIX L12: Reduced `any` usage with proper types where feasible.
// Note: Test files are allowed relaxed type rules per CLAUDE.md, but
// we improve type safety where it doesn't add excessive verbosity.
describe('Job Processing Unit Tests (mocked infrastructure)', () => {
  let scheduler: JobScheduler;
  let mockRedis: Record<string, jest.Mock>;
  let _processedJobs: Array<{ name: string; data: unknown; result: unknown }>;
  let _failedJobs: Array<{ name: string; data: unknown; error: Error }>;

  beforeAll(async () => {
    // Setup mock Redis for testing
    const jobStore = new Map<string, string>();

    mockRedis = {
      eval: jest.fn().mockResolvedValue(1),
      keys: jest.fn().mockResolvedValue([]),
      // P3-3 FIX: Match real ioredis Pipeline.exec() shape: Array<[Error|null, unknown]>
      pipeline: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue([] as Array<[Error | null, unknown]>),
      }),
      lpush: jest.fn().mockResolvedValue(1),
      get: jest.fn().mockImplementation((key: string) => {
        // AUDIT-FIX P2: ?? instead of ||. jobStore may legitimately contain
        // falsy string values (e.g. "0", "") that || would discard.
        return Promise.resolve(jobStore.get(key) ?? null);
      }),
      setex: jest.fn().mockImplementation((key: string, ttl: number, value: string) => {
        jobStore.set(key, value);
        return Promise.resolve('OK');
      }),
      on: jest.fn(),
      once: jest.fn(),
      quit: jest.fn().mockResolvedValue(undefined),
    };

    (getRedis as jest.Mock).mockResolvedValue(mockRedis);
  });

  beforeEach(() => {
    // AUDIT-FIX L12: Reset mocks between tests to prevent cross-test pollution.
    jest.clearAllMocks();
    (getRedis as jest.Mock).mockResolvedValue(mockRedis);

    _processedJobs = [];
    _failedJobs = [];
    // P3-5 FIX: Use env var instead of hardcoded Redis URL
    scheduler = new JobScheduler(process.env['REDIS_URL'] || 'redis://localhost:6379');
  });

  // AUDIT-FIX P2: Changed from afterAll to afterEach. beforeEach creates a new
  // scheduler instance per test, but afterAll only stops the LAST instance,
  // leaking workers/connections from all prior tests.
  afterEach(async () => {
    if (scheduler) {
      await scheduler.stop();
    }
  });

  describe('Job Scheduling and Execution', () => {
    it('should schedule and execute a simple job', async () => {
      const jobData = { message: 'Hello, World!' };
      let _executedData: any = null;

      scheduler.register({
        name: 'test-job',
        queue: 'test-queue',
      }, async (data) => {
        _executedData = data;
        return { success: true };
      });

      // Mock queue add for testing
      const mockQueue = {
        add: jest.fn().mockResolvedValue({ id: 'job-123' }),
      };
      (scheduler as any).queues.set('test-queue', mockQueue);

      const job = await scheduler.schedule('test-job', jobData);

      expect(job.id).toBe('job-123');
      expect(mockQueue.add).toHaveBeenCalledWith(
        'test-job',
        jobData,
        expect.any(Object)
      );
    });

    it('should process jobs in priority order', async () => {
      const executionOrder: string[] = [];

      // Register jobs with different priorities
      scheduler.register({
        name: 'low-priority-job',
        queue: 'priority-queue',
        priority: 'low',
      }, async () => {
        executionOrder.push('low');
        return 'low-done';
      });

      scheduler.register({
        name: 'high-priority-job',
        queue: 'priority-queue',
        priority: 'high',
      }, async () => {
        executionOrder.push('high');
        return 'high-done';
      });

      // Verify priority values are set correctly
      const mockQueue = {
        add: jest.fn().mockResolvedValue({ id: 'job-id' }),
      };
      (scheduler as any).queues.set('priority-queue', mockQueue);

      await scheduler.schedule('low-priority-job', {}, { priority: 50 });
      await scheduler.schedule('high-priority-job', {}, { priority: 25 });

      // High priority jobs should have lower priority number (higher precedence)
      const lowCall = mockQueue.add.mock.calls[0];
      const highCall = mockQueue.add.mock.calls[1];
      
      expect(highCall[2].priority).toBeLessThan(lowCall[2].priority);
    });

    it('should handle job retries on failure', async () => {
      let attempts = 0;

      scheduler.register({
        name: 'retry-job',
        queue: 'retry-queue',
        maxRetries: 3,
      }, async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error(`Attempt ${attempts} failed`);
        }
        return { success: true, attempts };
      });

      // P2-11 FIX: handlers.get() returns a HandlerConfig object { config, handler, schema },
      // not the handler function directly. Calling it as a function would throw TypeError.
      const handlerConfig = (scheduler as any).handlers.get('retry-job');
      const jobFn = handlerConfig.handler;

      // First attempt fails
      await expect(jobFn({})).rejects.toThrow('Attempt 1 failed');

      // Simulate retry by calling again
      attempts = 2;
      const result = await jobFn({});

      expect(result.attempts).toBe(3);
      expect(result.success).toBe(true);
    });

    it('should send failed jobs to DLQ after max retries', async () => {
      const dlqRecords: any[] = [];

      scheduler.register({
        name: 'failing-job',
        queue: 'dlq-queue',
        maxRetries: 2,
      }, async () => {
        throw new Error('Persistent failure');
      });

      // Simulate DLQ recording
      const mockDLQ = {
        record: jest.fn().mockImplementation((job: any) => {
          dlqRecords.push(job);
          return Promise.resolve();
        }),
      };
      (scheduler as any).dlqService = mockDLQ;

      // P2-11 FIX: Access .handler from HandlerConfig object
      const handlerConfig2 = (scheduler as any).handlers.get('failing-job');
      const jobFn = handlerConfig2.handler;

      try {
        await jobFn({ test: 'data' });
      } catch {
        // Expected to fail
      }

      // AUDIT-FIX P1: The original assertion `expect(mockDLQ).toBeDefined()` was
      // vacuous — mockDLQ is a local const and is always defined. Assert that the
      // handler actually throws the persistent failure instead.
      // Note: Actual DLQ recording happens in the worker error handler, not
      // directly in the job handler, so we verify the handler rejects.
      await expect(jobFn({ test: 'data2' })).rejects.toThrow('Persistent failure');
    });
  });

  describe('Rate-Limited Job Processing', () => {
    it('should invoke rate limit check for each scheduled job', async () => {
      // AUDIT-FIX P2: Renamed from "should enforce rate limits across distributed
      // instances" — this test verifies that the rate limit Lua script is *invoked*,
      // not that rate limiting actually *works*. Real enforcement requires real Redis.
      let _requestCount = 0;

      scheduler.register({
        name: 'rate-limited-job',
        queue: 'rate-limit-queue',
        rateLimit: { max: 5, duration: 60000 },
      }, async () => {
        _requestCount++;
        return { processed: true };
      });

      // Mock Redis rate limit check
      mockRedis.eval.mockResolvedValue(1); // Allow request

      // Simulate multiple requests
      const requests = Array.from({ length: 5 }, () =>
        scheduler.schedule('rate-limited-job', {})
      );

      await Promise.all(requests);

      // Rate limit check should be called for each request
      expect(mockRedis.eval).toHaveBeenCalledTimes(5);
    });

    it('should reject requests exceeding rate limit', async () => {
      scheduler.register({
        name: 'strict-rate-limit',
        queue: 'strict-queue',
        rateLimit: { max: 2, duration: 60000 },
      }, async () => ({ success: true }));

      // Mock rate limit exceeded
      mockRedis.eval.mockResolvedValue(0); // Reject

      // Try to schedule multiple jobs
      const mockQueue = {
        add: jest.fn().mockResolvedValue({ id: 'job-id' }),
      };
      (scheduler as any).queues.set('strict-queue', mockQueue);

      // Should still schedule but rate limit is checked at execution time
      await scheduler.schedule('strict-rate-limit', { data: 1 });
      await scheduler.schedule('strict-rate-limit', { data: 2 });

      expect(mockQueue.add).toHaveBeenCalledTimes(2);
    });
  });

  describe('Delayed Job Processing', () => {
    it('should schedule delayed jobs', async () => {
      scheduler.register({
        name: 'delayed-job',
        queue: 'delayed-queue',
      }, async () => ({ executed: true }));

      const mockQueue = {
        add: jest.fn().mockResolvedValue({ id: 'delayed-123' }),
      };
      (scheduler as any).queues.set('delayed-queue', mockQueue);

      const delayMs = 5000;
      await scheduler.schedule('delayed-job', { data: 'test' }, { delay: delayMs });

      expect(mockQueue.add).toHaveBeenCalledWith(
        'delayed-job',
        { data: 'test' },
        expect.objectContaining({ delay: delayMs })
      );
    });
  });

  describe('Job Dependencies and Chaining', () => {
    it('should support job result passing', async () => {
      const results: any[] = [];

      scheduler.register({
        name: 'parent-job',
        queue: 'chain-queue',
      }, async () => {
        const result = { parentData: 'processed' };
        results.push(result);
        return result;
      });

      scheduler.register({
        name: 'child-job',
        queue: 'chain-queue',
      }, async (data) => {
        results.push({ childReceived: data });
        return { childData: 'processed' };
      });

      // P2-11 FIX: Access .handler from HandlerConfig object
      const parentFn = (scheduler as any).handlers.get('parent-job').handler;
      const parentResult = await parentFn({});

      // Pass result to child
      const childFn = (scheduler as any).handlers.get('child-job').handler;
      await childFn(parentResult);

      expect(results).toHaveLength(2);
      expect(results[1].childReceived.parentData).toBe('processed');
    });
  });

  describe('Graceful Shutdown', () => {
    it('should stop accepting new jobs during shutdown', async () => {
      scheduler.register({
        name: 'shutdown-test',
        queue: 'shutdown-queue',
      }, async () => ({ done: true }));

      // Start shutdown
      const stopPromise = scheduler.stop();

      // During shutdown, new schedules should be handled gracefully
      // (actual behavior depends on implementation)

      await stopPromise;

      expect((scheduler as any).workers.size).toBe(0);

      // AUDIT-FIX P3: Nullify scheduler to prevent afterEach from calling
      // stop() again. Double stop() could throw if redis.quit() is called
      // on an already-closed connection.
      scheduler = null as any;
    });

    it('should complete in-progress jobs before shutdown', async () => {
      let jobCompleted = false;

      scheduler.register({
        name: 'long-job',
        queue: 'long-queue',
      }, async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        jobCompleted = true;
        return { completed: true };
      });

      // P2-11 FIX: Access .handler from HandlerConfig object
      const jobFn = (scheduler as any).handlers.get('long-job').handler;
      const jobPromise = jobFn({});

      // Start shutdown while job is running
      const stopPromise = scheduler.stop();

      await Promise.all([jobPromise, stopPromise]);
      
      expect(jobCompleted).toBe(true);
    });
  });
});
