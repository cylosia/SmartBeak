/**
 * Test Factories: Job
 * 
 * Provides factory functions for creating test job data.
 */

import crypto from 'crypto';

export interface JobFactoryOptions {
  id?: string;
  name?: string;
  queue?: string;
  data?: Record<string, any>;
  priority?: number;
  delay?: number;
  attempts?: number;
  maxRetries?: number;
  createdAt?: Date;
}

export function createJob(options: JobFactoryOptions = {}) {
  const timestamp = Date.now();
  const randomSuffix = crypto.randomBytes(4).toString('hex');

  return {
    id: options.id || `job-${timestamp}-${randomSuffix}`,
    name: options.name || 'test-job',
    queue: options.queue || 'default',
    data: options.data || {},
    opts: {
      priority: options.priority || 50,
      delay: options.delay || 0,
      attempts: options.attempts || 1,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
    },
    attemptsMade: 0,
    created_at: options.createdAt || new Date(),
    processed_at: null,
    completed_at: null,
    failed_at: null,
    returnvalue: null,
    failedReason: null,
    stacktrace: null,
  };
}

export function createHighPriorityJob(
  options: Omit<JobFactoryOptions, 'priority'> = {}
) {
  return createJob({ ...options, priority: 10 });
}

export function createLowPriorityJob(
  options: Omit<JobFactoryOptions, 'priority'> = {}
) {
  return createJob({ ...options, priority: 90 });
}

export function createDelayedJob(
  delayMs: number,
  options: Omit<JobFactoryOptions, 'delay'> = {}
) {
  return createJob({ ...options, delay: delayMs });
}

export interface JobBatchOptions {
  count: number;
  jobOptions?: JobFactoryOptions;
}

export function createJobBatch({ count, jobOptions = {} }: JobBatchOptions) {
  return Array.from({ length: count }, (_, index) =>
    createJob({
      ...jobOptions,
      data: {
        ...jobOptions.data,
        batchIndex: index,
      },
    })
  );
}

export interface FailedJobOptions extends JobFactoryOptions {
  error?: Error;
  stacktrace?: string[];
  attemptsMade?: number;
}

export function createFailedJob(options: FailedJobOptions = {}) {
  const job = createJob(options);
  
  return {
    ...job,
    failed_at: new Date(),
    failedReason: options.error?.message || 'Unknown error',
    stacktrace: options.stacktrace || [options.error?.stack || ''],
    attemptsMade: options.attemptsMade || options.attempts || 1,
  };
}

export interface CompletedJobOptions extends JobFactoryOptions {
  result?: any;
  processingTimeMs?: number;
}

export function createCompletedJob(options: CompletedJobOptions = {}) {
  const job = createJob(options);
  const completedAt = new Date();
  const processedAt = new Date(completedAt.getTime() - (options.processingTimeMs || 100));

  return {
    ...job,
    processed_at: processedAt,
    completed_at: completedAt,
    returnvalue: options.result || { success: true },
  };
}
