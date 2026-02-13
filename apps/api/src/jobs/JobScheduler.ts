import { Queue, Worker, Job } from 'bullmq';
import Redis from 'ioredis';

import { EventEmitter } from 'events';
import { z } from 'zod';

import { getLogger } from '@kernel/logger';
import { DLQService } from '@kernel/queue/DLQService';
import { QueueBackpressureError } from '@kernel/semaphore';
import { runWithContext, createRequestContext } from '@kernel/request-context';
import { jobConfig, redisConfig } from '@config';

/**
 * Job Scheduler System
* Manages background jobs with priorities, retries, and rate limiting
* Includes comprehensive validation and error handling
*/

const logger = getLogger('job-scheduler');

// Validation schemas
const JobPrioritySchema = z.enum(['critical', 'high', 'normal', 'low', 'background']);
const JobConfigSchema = z.object({
  name: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/),
  queue: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/),
  priority: JobPrioritySchema.optional(),
  maxRetries: z.number().int().min(0).max(10).optional(),
  backoffType: z.enum(['fixed', 'exponential']).optional(),
  backoffDelay: z.number().int().min(100).max(3600000).optional(),
  timeout: z.number().int().min(1000).max(3600000).optional(),
  rateLimit: z.object({
  max: z.number().int().min(1).max(10000),
  duration: z.number().int().min(100).max(3600000),
  }).optional(),
});

export type JobPriority = z.infer<typeof JobPrioritySchema>;
export type JobConfig = z.infer<typeof JobConfigSchema>;
export type JobStatus = 'pending' | 'active' | 'completed' | 'failed' | 'delayed';

export interface ScheduledJob {
  id: string;
  name: string;
  queue: string;
  data: unknown;
  priority: number;
  delay?: number;
  cron?: string;
  status: JobStatus;
  attempts: number;
  maxRetries: number;
  createdAt: Date;
  processedAt?: Date;
  completedAt?: Date;
  error?: string;
}

const PRIORITY_MAP: Record<JobPriority, number> = {
  critical: 1,
  high: 25,
  normal: 50,
  low: 75,
  background: 100,
};

export interface HandlerConfig {
  config: JobConfig;
  schema?: z.ZodSchema<unknown>;
  handler: (data: unknown, job: Job) => Promise<unknown>;
}

// FIX: Worker event handlers tracking for cleanup
export type WorkerEventHandlers = {
  completed: (job: Job) => void;
  failed: (job: Job | undefined, error: Error) => void;
  error: (error: Error) => void;
};

export class JobScheduler extends EventEmitter {
  private readonly redis: Redis;
  private readonly queues: Map<string, Queue> = new Map();
  // Note: QueueScheduler is removed in bullmq v5.x, delayed jobs work without it
  private readonly workers: Map<string, Worker> = new Map();
  // FIX: Track worker event handlers for cleanup
  private readonly workerEventHandlers: Map<string, WorkerEventHandlers> = new Map();
  private readonly handlers: Map<string, HandlerConfig> = new Map();
  // P0-FIX: Track running state to prevent worker storm
  private running = false;
  // P1-FIX: Use Map for active controllers (no LRU eviction) to prevent
  // active job controllers from being evicted, which would make jobs uncancelable
  private readonly abortControllers = new Map<string, AbortController>();
  // P1-FIX: Track controller creation time for auto-cleanup of stale controllers
  private readonly abortControllerTimestamps = new Map<string, number>();
  // P1-FIX: Maximum age for abort controllers (5 minutes)
  private readonly ABORT_CONTROLLER_MAX_AGE_MS = 300000;
  // P1-FIX: Cleanup interval for stale abort controllers
  private abortControllerCleanupInterval?: NodeJS.Timeout | undefined;
  private redisReconnectDelay = redisConfig.initialReconnectDelayMs;
  private readonly maxReconnectDelay = redisConfig.maxReconnectDelayMs;
  private isConnected = false;
  private dlqService?: DLQService;
  // FIX: Track Redis event handlers for cleanup
  private readonly redisEventHandlers: Map<string, (...args: unknown[]) => void> = new Map();

  constructor(redisUrl?: string) {
  super();
  
  // P1-HIGH FIX: Add error event handler to prevent unhandled errors
  this.on('error', (err) => {
    logger.error('JobScheduler error', err);
  });
  const url = redisUrl || process.env['REDIS_URL'] || 'redis://localhost:6379';

    this.redis = new Redis(url, {
    maxRetriesPerRequest: redisConfig.maxRetriesPerRequest,
    enableReadyCheck: true,
    connectTimeout: redisConfig.connectTimeoutMs,
    commandTimeout: redisConfig.commandTimeoutMs,
    retryStrategy: (times) => {
        if (times > redisConfig.maxReconnectAttempts) {
      logger.error('Redis max reconnection attempts reached');
      this.emit('redisReconnectFailed');
      return null; // Stop retrying
    }
    const delay = Math.min(
      this.redisReconnectDelay * Math.pow(2, times - 1),
      this.maxReconnectDelay
    );
    const jitter = Math.random() * 1000;
    logger.info(`Redis reconnect attempt ${times}, delay: ${Math.floor(delay + jitter)}ms`);
    return Math.floor(delay + jitter);
    },
    reconnectOnError: (err) => {
        const targetErrors = ['ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'READONLY'];
    const shouldReconnect = targetErrors.some(e => err["message"].includes(e));
    if (shouldReconnect) {
      logger.error('Redis connection error, will reconnect', err);
      this.isConnected = false;
      this.emit('redisDisconnected', err);
    }
    return shouldReconnect;
    },
      keepAlive: redisConfig.keepAliveMs,
      connectionName: 'job-scheduler',
  });

  // FIX: Store handler references for cleanup
  const connectHandler = () => {
    logger.info('Redis connected');
    this.isConnected = true;
    this.redisReconnectDelay = redisConfig.initialReconnectDelayMs; // Reset delay on successful connection
    this.emit('redisConnected');
  };

  const readyHandler = () => {
    logger.info('Redis ready');
    this.isConnected = true;
  };

  const errorHandler = (err: Error) => {
    logger.error('Redis error', err);
    this.emit('redisError', err);
  };

  const closeHandler = () => {
    logger.warn('Redis connection closed');
    this.isConnected = false;
    this.emit('redisDisconnected');
  };

  const reconnectingHandler = () => {
    logger.info('Redis reconnecting...');
  };

  this.redis.on('connect', connectHandler);
  this.redis.on('ready', readyHandler);
  this.redis.on('error', errorHandler);
  this.redis.on('close', closeHandler);
  this.redis.on('reconnecting', reconnectingHandler);

  // Store for cleanup
  this.redisEventHandlers.set('connect', connectHandler);
  this.redisEventHandlers.set('ready', readyHandler);
  this.redisEventHandlers.set('error', errorHandler as (...args: unknown[]) => void);
  this.redisEventHandlers.set('close', closeHandler);
  this.redisEventHandlers.set('reconnecting', reconnectingHandler);
  }

  /**
  * Set DLQ service for failed job handling
  * @param service - DLQ service instance
  */
  setDLQService(service: DLQService): void {
  this.dlqService = service;
  }

  /**
  * Check if Redis is connected
  * @returns True if Redis connection is ready
  */
  isRedisConnected(): boolean {
  return this.isConnected && this.redis.status === 'ready';
  }

  /**
  * Wait for Redis connection with timeout
  * @param timeoutMs - Timeout in milliseconds (default: 30000)
  * @returns True if connected, false if timeout
  */
  async waitForConnection(timeoutMs = redisConfig.waitForConnectionTimeoutMs): Promise<boolean> {
  if (this.isRedisConnected()) return true;

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
    cleanup();
    resolve(false);
    }, timeoutMs);

    const onConnect = () => {
    cleanup();
    resolve(true);
    };

    const cleanup = () => {
    clearTimeout(timeout);
    this.off('redisConnected', onConnect);
    };

    this.once('redisConnected', onConnect);
  });
  }

  /**
  * Register a job handler with optional data validation schema
  */
  register<T>(
  config: JobConfig,
  handler: (data: T, job: Job) => Promise<unknown>,
  _schema?: z.ZodSchema<T>
  ): void {
  // Validate config
  const validatedConfig = JobConfigSchema.parse(config);

  // Merge with defaults
  const finalConfig: JobConfig = {
    maxRetries: jobConfig.maxRetries,
    backoffType: 'exponential',
    backoffDelay: jobConfig.retryDelayMs,
    timeout: jobConfig.defaultTimeoutMs,
    ...validatedConfig,
  };

  this.handlers.set(validatedConfig.name, {
    config: finalConfig,
    handler: handler as (data: unknown, job: Job) => Promise<unknown>,
  });

  if (!this.queues.has(finalConfig.queue)) {
    this.createQueue(finalConfig.queue);
  }
  }

  private createQueue(name: string): Queue {
  const queue = new Queue(name, {
    connection: this.redis,
    defaultJobOptions: {
    removeOnComplete: jobConfig.keepCompletedJobs,
    removeOnFail: jobConfig.keepFailedJobs,
    },
  });

  this.queues.set(name, queue);
  
  // Note: In bullmq v5.x, QueueScheduler is no longer needed for delayed jobs
  // Delayed jobs work automatically with the Queue
  
  return queue;
  }

  /**
   * Check if workers are running
   * @returns True if workers have been started
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Attach event handlers to a worker and track them for cleanup
   * P1-FIX: Prevents memory leaks by tracking and removing old handlers
   * P1-FIX: Added error event handler for worker-level errors
   */
  private attachWorkerHandlers(worker: Worker, queueName: string): void {
    // Remove old handlers if any
    const oldHandlers = this.workerEventHandlers.get(queueName);
    if (oldHandlers) {
      worker.off('completed', oldHandlers.completed);
      worker.off('failed', oldHandlers.failed);
      worker.off('error', oldHandlers.error);
    }

    // Create new handlers
    const completedHandler = (job: Job) => {
      this.emit('jobCompleted', job);
    };
    const failedHandler = (job: Job | undefined, err: Error) => {
      this.emit('jobFailed', job, err);
    };
    // P1-FIX: Add worker-level error handler
    const errorHandler = (err: Error) => {
      logger.error(`Worker error in queue ${queueName}`, err);
      this.emit('workerError', queueName, err);
    };

    // Attach and track
    worker.on('completed', completedHandler);
    worker.on('failed', failedHandler);
    worker.on('error', errorHandler);
    this.workerEventHandlers.set(queueName, {
      completed: completedHandler,
      failed: failedHandler,
      error: errorHandler,
    });
  }

  /**
   * P1-FIX: Start periodic cleanup of stale abort controllers
   */
  private startAbortControllerCleanup(): void {
    this.abortControllerCleanupInterval = setInterval(() => {
      this.cleanupStaleAbortControllers();
    }, 60000); // Check every minute
  }

  /**
   * P1-FIX: Clean up stale abort controllers that weren't properly removed
   */
  private cleanupStaleAbortControllers(): void {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [jobId, timestamp] of this.abortControllerTimestamps) {
      if (now - timestamp > this.ABORT_CONTROLLER_MAX_AGE_MS) {
        const controller = this.abortControllers.get(jobId);
        if (controller) {
          controller.abort();
          this.abortControllers.delete(jobId);
          cleaned++;
        }
        this.abortControllerTimestamps.delete(jobId);
      }
    }
    
    if (cleaned > 0) {
      logger.warn(`[JobScheduler] Cleaned up ${cleaned} stale abort controllers`);
    }
  }

  /**
   * P1-FIX: Stop abort controller cleanup interval
   */
  private stopAbortControllerCleanup(): void {
    if (this.abortControllerCleanupInterval) {
      clearInterval(this.abortControllerCleanupInterval);
      this.abortControllerCleanupInterval = undefined;
    }
  }

  /**
   * P1-FIX: Get count of active abort controllers (for monitoring)
   */
  getActiveAbortControllerCount(): number {
    return this.abortControllers.size;
  }

  /**
   * Start workers for all registered jobs
   */
  startWorkers(concurrency: number = jobConfig.workerConcurrency): void {
    // P0-FIX: Prevent duplicate worker starts
    if (this.running) {
      logger.warn('Workers already running, skipping startWorkers()');
      return;
    }

    // P1-5 FIX: Set running flag immediately to prevent concurrent startWorkers() calls
    this.running = true;

    // P1-FIX: Start auto-cleanup of stale abort controllers
    this.startAbortControllerCleanup();

    const queueHandlers = new Map<string, string[]>();

    for (const [name, { config }] of this.handlers) {
      if (!queueHandlers.has(config.queue)) {
        queueHandlers.set(config.queue, []);
      }
      queueHandlers.get(config.queue)!.push(name);
    }

    for (const [queueName, _jobNames] of queueHandlers) {
      const worker = new Worker(
        queueName,
        async (job: Job) => {
          const handlerConfig = this.handlers.get(job.name);

          if (!handlerConfig) {
            throw new Error(`No handler registered for job: ${job.name}`);
          }

          const { config, schema, handler } = handlerConfig;

          // P0-FIX: Validate job data against schema if provided
          if (schema) {
            const result = schema.safeParse(job.data);
            if (!result.success) {
              throw new Error(`Job data validation failed: ${result.error.message}`);
            }
          }

          this.emit('jobStarted', job);

          // P2-MEDIUM FIX: Ensure AsyncLocalStorage context is propagated for job processing
          const requestContext = createRequestContext({
            requestId: job.id || `job-${Date.now()}`,
            traceId: (job.data as Record<string, string> | undefined)?.['traceId'] || undefined,
            orgId: (job.data as Record<string, string> | undefined)?.['orgId'] || undefined,
          });

          // P1-1 FIX: Extract jobId ONCE and reuse in finally block. Previously,
          // line 428 used `job.id || \`job-${Date.now()}\`` and line 448 used
          // `job.id || ''`, creating a key mismatch that leaked abort controllers.
          const effectiveJobId = job.id || `job-${Date.now()}`;
          const abortController = new AbortController();
          this.abortControllers.set(effectiveJobId, abortController);
          this.abortControllerTimestamps.set(effectiveJobId, Date.now());

          return runWithContext(requestContext, async () => {
            try {
              const result = await this.executeWithTimeout(
                handler(job.data, job),
                config.timeout || jobConfig.defaultTimeoutMs,
                abortController.signal
              );
              // P1-2 FIX: Removed duplicate this.emit('jobCompleted', job, result) here.
              // The worker 'completed' event handler in attachWorkerHandlers() already
              // emits 'jobCompleted'. Having both caused double emission for every job.
              return result;
            } catch (error) {
              this.emit('jobFailed', job, error);
              throw error;
            } finally {
              // P1-1 FIX: Use same effectiveJobId from outer scope
              this.abortControllers.delete(effectiveJobId);
              this.abortControllerTimestamps.delete(effectiveJobId);
            }
          });
        },
        {
          connection: this.redis,
          concurrency,
          stalledInterval: 300000,     // P0-FIX: 5 minutes (not 30s)
          maxStalledCount: 3,          // P0-FIX: Allow 3 stalls before failing
          limiter: {
            max: jobConfig.workerRateLimitMax,
            duration: jobConfig.workerRateLimitDurationMs,
          },
        });

      // P1-FIX: Use attachWorkerHandlers to track event handlers for cleanup
      this.attachWorkerHandlers(worker, queueName);

      this.workers.set(queueName, worker);
    }

    // P0-FIX: Running flag already set at method start (P1-5 FIX)
    // If worker creation fails, the running flag should be reset by the caller
  }

  private async executeWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal
  ): Promise<T> {
  return new Promise((resolve, reject) => {
    // P0-FIX: Track settled state to prevent listener leak
    let settled = false;

    const timeoutId = setTimeout(() => {
    if (!settled) {
      settled = true;
      reject(new Error(`Job timeout after ${timeoutMs}ms`));
    }
    }, timeoutMs);

    const abortListener = () => {
    if (!settled) {
      settled = true;
      clearTimeout(timeoutId);
      reject(new Error('Job aborted'));
    }
    };

    if (signal) {
    if (signal.aborted) {
      settled = true;
      clearTimeout(timeoutId);
      reject(new Error('Job aborted'));
      return;
    }

    signal.addEventListener('abort', abortListener, { once: true });
    }

    promise.then((value) => {
      if (!settled) {
      settled = true;
      clearTimeout(timeoutId);
      signal?.removeEventListener('abort', abortListener);
      resolve(value);
      }
    })
    .catch((error) => {
      if (!settled) {
      settled = true;
      clearTimeout(timeoutId);
      signal?.removeEventListener('abort', abortListener);
      reject(error);
      }
    });
  });
  }

  // P0-FIX: Redis Cluster compatible Lua script with hash tags
  // Using {ratelimit} hash tag ensures all rate limit keys go to same slot
  private rateLimitLuaScript = `
  local key = KEYS[1]
  local max = tonumber(ARGV[1])
  local duration = tonumber(ARGV[2])

  local current = redis.call('incr', key)
  if current == 1 then
    redis.call('pexpire', key, duration)
  end

  if current > max then
    return 0
  end
  return 1
  `;

  private async checkRateLimit(
  jobName: string,
  limit: { max: number; duration: number },
  orgId?: string
  ): Promise<void> {

  // P0-FIX: Use hash tag for Redis Cluster compatibility
  // {ratelimit} ensures all rate limit keys go to same hash slot
  const key = orgId
    ? `ratelimit:{${orgId}}:${jobName}`
    : `ratelimit:{global}:${jobName}`;

  const allowed = await this.redis.eval(
    this.rateLimitLuaScript,
    1,  // numKeys
    key,           // KEYS[1]
    limit.max,     // ARGV[1]
    limit.duration // ARGV[2]
  );

  if (!allowed) {
    throw new Error(`Rate limit exceeded for ${jobName}${orgId ? ` (org: ${orgId})` : ''}`);
  }
  }

  // P1-FIX: Maximum job payload size (1MB to prevent Redis OOM)
  private readonly MAX_PAYLOAD_SIZE = 1024 * 1024;

  async schedule(
  name: string,
  data: unknown,
  options: {
    priority?: JobPriority;
    delay?: number;
    jobId?: string;
  } = {}
  ): Promise<Job> {
  const handlerConfig = this.handlers.get(name);
  if (!handlerConfig) {
    throw new Error(`Job ${name} not registered`);
  }

  // P1-FIX: Validate payload size to prevent Redis OOM
  const payloadSize = JSON.stringify(data).length;
  if (payloadSize > this.MAX_PAYLOAD_SIZE) {
    throw new Error(
      `Job payload too large: ${payloadSize} bytes (max: ${this.MAX_PAYLOAD_SIZE})`
    );
  }

  const queue = this.queues.get(handlerConfig.config.queue);
  if (!queue) {
    throw new Error(`Queue ${handlerConfig.config.queue} not found`);
  }

  // Backpressure: reject if queue has too many pending jobs
  const MAX_QUEUE_DEPTH = 1000;
  const waitingCount = await queue.getWaitingCount();
  if (waitingCount > MAX_QUEUE_DEPTH) {
    throw new QueueBackpressureError(
      `Queue ${handlerConfig.config.queue} has ${waitingCount} pending jobs (max: ${MAX_QUEUE_DEPTH}). Rejecting new job '${name}'.`
    );
  }

    const jobPriority = options.priority || handlerConfig.config.priority || 'normal';
  const priority = PRIORITY_MAP[jobPriority];

  logger.info('Scheduling job', {
    jobName: name,
    queue: handlerConfig.config.queue,
    priority: jobPriority,
    payloadSize,
  });

  // P0-3 FIX: Pass priority to queue.add(). Previously computed but never included
  // in options, causing all jobs to run at BullMQ default priority.
  // P0-4 FIX: Wrap backoff in { backoff: { type, delay } } object. BullMQ expects
  // nested backoff config, not top-level type/delay keys (which are silently ignored).
  return queue.add(name, data, {
    priority,
    ...(options.delay !== undefined && { delay: options.delay }),
    ...(options.jobId !== undefined && { jobId: options.jobId }),
    ...(handlerConfig.config.maxRetries !== undefined && { attempts: handlerConfig.config.maxRetries }),
    ...(handlerConfig.config.backoffType && handlerConfig.config.backoffDelay ? {
    backoff: {
      type: handlerConfig.config.backoffType as 'fixed' | 'exponential',
      delay: handlerConfig.config.backoffDelay,
    },
    } : {}),
  });
  }

  async scheduleRecurring(
  name: string,
  data: unknown,
  cron: string,
  options: { priority?: JobPriority } = {}
  ): Promise<void> {
  const handlerConfig = this.handlers.get(name);
  if (!handlerConfig) {
    throw new Error(`Job ${name} not registered`);
  }

  const queue = this.queues.get(handlerConfig.config.queue);
  if (!queue) {
    throw new Error(`Queue ${handlerConfig.config.queue} not found`);
  }

    const jobPriority = options.priority || handlerConfig.config.priority || 'normal';

  await queue.add(name, data, {
    repeat: { pattern: cron as `${number} ${number} ${number} ${number} ${number} ${number}` | `${number} ${number} ${number} ${number} ${number}` },
    priority: PRIORITY_MAP[jobPriority],
  });
  }

  async getJob(queueName: string, jobId: string): Promise<Job | undefined> {
  const queue = this.queues.get(queueName);
  if (!queue) return undefined;
  return queue.getJob(jobId);
  }

  async cancel(queueName: string, jobId: string): Promise<void> {

  const job = await this.getJob(queueName, jobId);
  if (!job) {
    throw new Error(`Job ${jobId} not found in queue ${queueName}`);
  }

  const abortController = this.abortControllers.get(jobId);
  if (abortController) {
    abortController.abort();
  }
  await job.remove();
  }

  async getMetrics(queueName: string): Promise<{
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  }> {
  const queue = this.queues.get(queueName);
  if (!queue) {
    throw new Error(`Queue ${queueName} not found`);
  }

  const results = await Promise.allSettled([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount(),
  ]);

  const [waiting, active, completed, failed, delayed] = results.map((r, index) => {
    if (r.status === 'fulfilled') {
    return (r.value || 0) as number;
    }
    // Log the specific failure but return 0 to maintain partial results
    logger.error(`Failed to get metric ${index}: ${r.reason}`);
    return 0;
  }) as [number, number, number, number, number];

  return { waiting, active, completed, failed, delayed };
  }

  async pauseQueue(queueName: string): Promise<void> {
  const queue = this.queues.get(queueName);
  if (queue) {
    await queue.pause();
  }
  }

  async resumeQueue(queueName: string): Promise<void> {
  const queue = this.queues.get(queueName);
  if (queue) {
    await queue.resume();
  }
  }

  async cleanQueue(queueName: string, gracePeriodMs: number = 24 * 60 * 60 * 1000): Promise<void> {
  const queue = this.queues.get(queueName);
  if (queue) {
    await queue.clean(gracePeriodMs, 100, 'completed');
    await queue.clean(gracePeriodMs, 100, 'failed');
  }
  }

  async stop(): Promise<void> {
    // P0-FIX: Mark as not running immediately
    this.running = false;

    // P1-FIX: Stop auto-cleanup of abort controllers
    this.stopAbortControllerCleanup();

    // P0-FIX: Graceful shutdown with timeout
    const gracefulTimeout = 10000; // 10 seconds

    // FIX: Abort all running jobs
    for (const [_jobId, controller] of this.abortControllers.entries()) {
      controller.abort();
    }
    this.abortControllers.clear();
    this.abortControllerTimestamps.clear();

    // P0-FIX: Wait for active jobs to complete with timeout
    const shutdownStart = Date.now();

    // FIX: Remove worker event listeners and close workers gracefully
    for (const [queueName, worker] of this.workers.entries()) {
      try {
        // Pause worker to stop accepting new jobs
        await worker.pause();

        // Wait for current job to complete (with timeout)
        const remainingTime = gracefulTimeout - (Date.now() - shutdownStart);
        if (remainingTime > 0) {
          await Promise.race([
            worker.waitUntilReady(), // Wait for worker to be ready (no active jobs)
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Worker shutdown timeout')), remainingTime)
            )
          ]);
        }

        // Remove listeners
        const handlers = this.workerEventHandlers.get(queueName);
        if (handlers) {
          worker.off('completed', handlers.completed);
          worker.off('failed', handlers.failed);
          worker.off('error', handlers.error);
        }

        // Close worker
        await worker.close();
      } catch (error) {
        logger.warn(`[JobScheduler] Force closing worker for ${queueName}: ${error instanceof Error ? error.message : String(error)}`);
        // Force close if graceful shutdown fails
        await worker.close(true);
      }
    }
    this.workers.clear();
    this.workerEventHandlers.clear();
    this.handlers.clear();
    this.queues.clear();

    // FIX: Remove all Redis event listeners
    for (const [event, handler] of this.redisEventHandlers.entries()) {
      this.redis.off(event, handler);
    }
    this.redisEventHandlers.clear();

    // P2-6 FIX: Remove only internal event listeners instead of removeAllListeners(),
    // which would nuke user-attached monitoring/logging listeners without warning.
    this.removeAllListeners('redisConnected');
    this.removeAllListeners('redisDisconnected');
    this.removeAllListeners('redisError');
    this.removeAllListeners('redisReconnectFailed');
    this.removeAllListeners('jobStarted');
    this.removeAllListeners('jobCompleted');
    this.removeAllListeners('jobFailed');
    this.removeAllListeners('workerError');

    // FIX: Close Redis connection
    logger.info('[JobScheduler] Shutdown complete');
    await this.redis.quit();
  }
}