


import { Pool } from 'pg';

import { EventBus } from '@kernel/event-bus';
import { getLogger } from '@kernel/logger';

import { DLQService } from './dlq';
import { FacebookPublishAdapter } from '../../plugins/publishing-adapters/facebook';
import { PostgresPublishAttemptRepository } from '../../domains/publishing/infra/persistence/PostgresPublishAttemptRepository';
import { PostgresPublishingJobRepository } from '../../domains/publishing/infra/persistence/PostgresPublishingJobRepository';
import { PostgresPublishTargetRepository } from '../../domains/publishing/infra/persistence/PostgresPublishTargetRepository';
import { PublishingService } from '../../domains/publishing/application/PublishingService';
import { PublishingWorker } from '../../domains/publishing/application/PublishingWorker';
import { RegionWorker } from '@kernel/queue';
import { VercelPublishAdapter } from '../../plugins/publishing-adapters/vercel-adapter';

const logger = getLogger('publishing-hook');

/**
* Retry configuration
*/
export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  exponentialBase: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  exponentialBase: 2,
};

/**
* Sleep function for delay between retries
*/
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
* Calculate delay with exponential backoff and jitter
*/
function calculateDelay(attempt: number, config: RetryConfig): number {
  const exponentialDelay = config.baseDelayMs * Math.pow(config.exponentialBase, attempt - 1);
  const cappedDelay = Math.min(exponentialDelay, config.maxDelayMs);
  // Add jitter (±25%) to prevent thundering herd
  const jitter = cappedDelay * 0.25 * (Math.random() * 2 - 1);
  return Math.floor(cappedDelay + jitter);
}

/**
* Check if error is a client error (4xx) that should not be retried
*/
function isClientError(error: Error): boolean {
  // Check for HTTP 4xx status codes in error message
  const statusCodeMatch = error.message.match(/\b(4\d{2})\b/);
  if (statusCodeMatch) {
  const statusCode = parseInt(statusCodeMatch[1]!, 10);
  // Don't retry on client errors: 400, 401, 403, 404, 409, etc.
  // But DO retry on 429 (rate limit)
  if (statusCode !== 429 && statusCode >= 400 && statusCode < 500) {
    return true;
  }
  }

  // Check for specific error indicators
  const clientErrorIndicators = [
  'unauthorized',
  'invalid',
  'not found',
  'bad request',
  'forbidden',
  'conflict'
  ];

  const errorMessageLower = error.message.toLowerCase();
  return clientErrorIndicators.some(indicator => errorMessageLower.includes(indicator));
}

/**
* Execute function with retry logic
*/
async function withRetry<T>(
  operation: () => Promise<T>,
  operationName: string,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
  try {
    return await operation();
  } catch (error) {
    lastError = error instanceof Error ? error : new Error(String(error));

    // Don't retry on client errors (4xx)
    if (isClientError(lastError)) {
    throw lastError;
    }

    if (attempt === config.maxRetries) {
    logger.error(`${operationName} failed after max retries`, lastError, { operationName, maxRetries: config.maxRetries });
    throw lastError;
    }

    const delay = calculateDelay(attempt, config);
    logger.warn(`${operationName} attempt failed, retrying`, { operationName, attempt, delayMs: delay, errorMessage: lastError.message });
    await sleep(delay);
  }
  }

  throw lastError || new Error(`${operationName} failed`);
}

/**
* Register publishing domain event handlers
*/
// Publishing job type definition
export interface PublishingJob {
  id: string;
  targetType: string;
  region: string;
  targetConfig: Record<string, unknown>;
}

// Extended PublishingService interface
interface IPublishingService {
  createJobsForContent(domainId: string, contentId: string): Promise<PublishingJob[]>;
}

/**
* Process a single publishing job
*/
async function processPublishingJob(
  job: PublishingJob,
  jobs: PostgresPublishingJobRepository,
  attempts: PostgresPublishAttemptRepository,
  eventBus: EventBus,
  dlq: DLQService,
  pool: Pool
): Promise<void> {
  const adapter =
  job.targetType === 'facebook'
    ? new FacebookPublishAdapter()
    : new VercelPublishAdapter();

  const regionWorker = new RegionWorker(job.region);
  const worker = new PublishingWorker(
  jobs,
  attempts,
  adapter,
  eventBus,
  dlq,
  regionWorker,
  pool,
  );

  // Process with retry logic for external calls
  await withRetry(
  () => worker.process(job.id, job.targetConfig),
  `publishJob:${job.id}`,
  {
    maxRetries: 3,
    baseDelayMs: 2000,
    maxDelayMs: 30000,
    exponentialBase: 2,
  }
  );
}

/**
* Handle content.published event - shared logic
*/
async function handleContentPublished(
  event: { meta: { domainId: string }; payload: { contentId: string } },
  service: IPublishingService,
  jobs: PostgresPublishingJobRepository,
  attempts: PostgresPublishAttemptRepository,
  eventBus: EventBus,
  dlq: DLQService,
  pool: Pool,
  _retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<void> {
  // Retry the job creation if it fails (e.g., due to DB transient errors)
  const created = await withRetry(
  () => service.createJobsForContent(event.meta.domainId, event.payload.contentId),
  'createJobsForContent',
  );

  // P2-FIX: Process jobs with bounded concurrency instead of sequentially.
  // The previous `for...of await` ran jobs one-by-one, so a single slow job
  // (e.g. a remote API with a 30 s timeout) blocked all remaining jobs.
  // Using bounded concurrency (CONCURRENCY=4) allows multiple jobs to proceed
  // in parallel while capping the number of simultaneous DB connections taken
  // from the pool, preventing pool exhaustion when content has many targets.
  const CONCURRENCY = 4;
  const queue = (created as PublishingJob[]).slice();
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
  while (queue.length > 0) {
    const job = queue.shift();
    if (job) {
    await processPublishingJob(job, jobs, attempts, eventBus, dlq, pool);
    }
  }
  });
  await Promise.all(workers);
}

export function registerPublishingDomain(eventBus: EventBus, pool: Pool) {
  const jobs = new PostgresPublishingJobRepository(pool);
  const targets = new PostgresPublishTargetRepository(pool);
  const attempts = new PostgresPublishAttemptRepository(pool);
  const dlq = new DLQService(pool);
  const service = new PublishingService(jobs, targets, pool) as unknown as IPublishingService;

  eventBus.subscribe('content.published', 'publishing-domain', async (event: unknown) => {
  await handleContentPublished(event as { meta: { domainId: string }; payload: { contentId: string } }, service, jobs, attempts, eventBus, dlq, pool);
  });
}

/**
* Register publishing domain with custom retry configuration
*/
export function registerPublishingDomainWithConfig(
  eventBus: EventBus,
  pool: Pool,
  retryConfig: Partial<RetryConfig>
) {
  const config = { ...DEFAULT_RETRY_CONFIG, ...retryConfig };
  const jobs = new PostgresPublishingJobRepository(pool);
  const targets = new PostgresPublishTargetRepository(pool);
  const attempts = new PostgresPublishAttemptRepository(pool);
  const dlq = new DLQService(pool);
  const service = new PublishingService(jobs, targets, pool) as unknown as IPublishingService;

  eventBus.subscribe('content.published', 'publishing-domain', async (event: unknown) => {
  await handleContentPublished(event as { meta: { domainId: string }; payload: { contentId: string } }, service, jobs, attempts, eventBus, dlq, pool, config);
  });
}
