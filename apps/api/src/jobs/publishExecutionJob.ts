
import { LRUCache } from 'lru-cache';
import { z } from 'zod';

import { getLogger } from '@kernel/logger';
import { withRetry, CircuitBreaker } from '@kernel/retry';
import { acquireLock, releaseLock } from '@kernel/redlock';  // P0-FIX: Distributed locking

import { publishingConfig, cacheConfig } from '@config';
import { getDb } from '../db';
import { deterministicKey } from '../utils/idempotency';
import { JobScheduler } from './JobScheduler';
const logger = getLogger('publish-execution');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const PublishAdapterSchema: z.ZodType<{ publish: () => Promise<{ externalId: string; url?: string; metadata?: Record<string, unknown> }>; name: string }> = z.any();

// Zod validation schema for payload
const PublishExecutionPayloadSchema = z.object({
  intentId: z.string().uuid(),
  adapter: PublishAdapterSchema,
  orgId: z.string().uuid().optional(),
  retryOptions: z.object({
  maxRetries: z.number().int().min(0).max(5).optional(),
  backoffMs: z.number().int().min(100).optional(),
  }).optional(),
});

export type PublishExecutionPayload = z.infer<typeof PublishExecutionPayloadSchema>;
export type PublishAdapter = z.infer<typeof PublishAdapterSchema>;

export interface PublishResult {
  externalId: string;
  url?: string;
  metadata?: Record<string, unknown>;
}

const circuitBreakers = new LRUCache<string, CircuitBreaker>({
  max: cacheConfig.circuitBreakerCacheMax,
  // No TTL: circuit breaker state must persist for the process lifetime
  // to accurately track failures across requests
});

function getCircuitBreaker(adapterName: string): CircuitBreaker {
  if (!circuitBreakers.has(adapterName)) {
  circuitBreakers.set(adapterName, new CircuitBreaker(adapterName, {
    failureThreshold: publishingConfig.circuitBreakerFailureThreshold,
    resetTimeoutMs: publishingConfig.circuitBreakerResetTimeoutMs,
    halfOpenMaxCalls: publishingConfig.circuitBreakerHalfOpenMaxCalls,
  }));
  }
  return circuitBreakers.get(adapterName)!;
}

export async function publishExecutionJob(payload: unknown): Promise<void> {

  let validatedPayload: PublishExecutionPayload;
  try {
  validatedPayload = PublishExecutionPayloadSchema.parse(payload);
  } catch (error) {
  if (error instanceof Error) {
    logger.error('Invalid publish execution payload', error instanceof Error ? error : new Error(String(error)));
    throw new Error(`Validation failed: ${(error as Error)["message"]}`);
  }
  throw error;
  }

  const { intentId, adapter, orgId, retryOptions: _retryOptions } = validatedPayload;
  const key = deterministicKey(['publish', intentId]);

  logger.info('Starting publish execution', { intentId, adapter: adapter.name, orgId });

  // P0-FIX: Distributed lock to prevent concurrent execution across workers
  // Without this, job retry could cause duplicate publishing
  const lockResource = `publish:${intentId}`;
  const lock = await acquireLock(lockResource, { ttl: 30000 }); // 30s lock
  
  if (!lock) {
    logger.warn('Could not acquire lock - publish job already running', { intentId });
    throw new Error('Publish job already in progress for this intent');
  }

  logger.info('Acquired distributed lock', { intentId, lockValue: lock.value });

  try {
    await executePublishJob(validatedPayload, key);
  } finally {
    // Always release lock
    const released = await releaseLock(lock);
    logger.info('Released distributed lock', { intentId, released });
  }
}

async function executePublishJob(
  validatedPayload: PublishExecutionPayload,
  key: string
): Promise<void> {
  const { intentId, adapter, orgId, retryOptions } = validatedPayload;

  // Phase 1: record attempt + lock intent
  const db = await getDb();
  const attempt = await db.transaction(async trx => {
  // Set transaction timeout to prevent long-running queries
  await trx.raw('SET LOCAL statement_timeout = ?', [30000]); // 30 seconds

  const intent = await trx('publish_intents')
    .where({ id: intentId })
    .forUpdate()
    .first();

  if (!intent) {
    throw new Error('Publish intent not found');
  }

  const existing = await trx('job_executions')
    .where({ job_type: 'publish', idempotency_key: key })
    .first();

  if (existing) {
    // P0-4 FIX: Handle incomplete saga - if status is 'started', Phase 3 may have
    // failed on a previous attempt. Check if external call already succeeded.
    if (existing.status === 'started') {
    const successRecord = await trx('publish_executions')
      .where({ intent_id: intentId, status: 'success' })
      .first();
    if (successRecord) {
      // External call succeeded but Phase 3 failed - skip to finalization
      logger.info('Recovering from incomplete saga: external call succeeded, finalizing', { intentId, key });
      return { attempt: -1, skipExternalCall: true, existingResult: successRecord };
    }
    // External call status unknown - allow retry
    logger.info('Recovering from incomplete saga: retrying external call', { intentId, key });
    const countResult = await trx('publish_executions')
      .where({ intent_id: intentId })
      .count<{ count: string | number }>('* as count');
    const count = Array.isArray(countResult) && countResult.length > 0 ? countResult[0].count : 0;
    return Number(count) + 1;
    }
    logger.info('Duplicate publish attempt detected, skipping', { intentId, key });
    return null;
  }

  await trx('job_executions').insert({
    job_type: 'publish',
    entity_id: intentId,
    idempotency_key: key,
    status: 'started',
    org_id: orgId,
    started_at: new Date(),
  });

  const countResult = await trx('publish_executions')
    .where({ intent_id: intentId })
    .count<{ count: string | number }>('* as count');
  const count = Array.isArray(countResult) && countResult.length > 0 ? countResult[0].count : 0;

  return Number(count) + 1;
  });

  if (!attempt) return;

  // P0-4 FIX: Handle saga recovery - skip external call if already succeeded
  let skipExternalCall = false;
  let recoveredResult: PublishResult | null = null;
  if (typeof attempt === 'object' && attempt.skipExternalCall) {
  skipExternalCall = true;
  recoveredResult = {
    externalId: attempt.existingResult.external_id,
    url: attempt.existingResult.external_url,
    metadata: attempt.existingResult.metadata ? JSON.parse(attempt.existingResult.metadata) : null,
  };
  }

  // Phase 2: External API call with circuit breaker and retry
  // NOTE: This phase operates outside the database transaction intentionally.
  // The transaction in Phase 1 only handles the initial attempt recording.
  // External API calls should not be within DB transactions to avoid holding
  // Locks during potentially long network operations.
  let result: PublishResult;
  if (skipExternalCall && recoveredResult) {
  result = recoveredResult;
  logger.info('Skipped external call - using recovered result from incomplete saga', { intentId });
  } else try {
  const circuitBreaker = getCircuitBreaker(adapter.name);

  result = await circuitBreaker.execute(async () => {
    return withRetry(
    () => adapter['publish'](),
    {
      maxRetries: retryOptions?.maxRetries ?? 3,
      initialDelayMs: retryOptions?.backoffMs ?? 1000,
      maxDelayMs: 30000,
      backoffMultiplier: 2,
      retryableErrors: [
      'ECONNREFUSED',
      'ETIMEDOUT',
      'ECONNRESET',
      'timeout',
      'rate limit',
      '429',
      '503',
      '502',
      ],
      onRetry: (error, retryCount) => {
      logger.warn(`Publish retry ${retryCount} for intent ${intentId}`, {
        error: (error as Error)["message"],
        adapter: adapter.name,
      });
      },
    }
    );
  });

  logger.info('Publish succeeded', { intentId, attempt, externalId: result.externalId });
  } catch (e: unknown) {
  const error = e instanceof Error ? e : new Error(String(e));

  logger.error('Publish failed after retries', error, {
    adapter: adapter.name,
  });

  // Record failed execution
  const dbForFail = await getDb();
  await withRetry(
    () => dbForFail('publish_executions').insert({
    intent_id: intentId,
    status: 'failed',
    error: error["message"],
    failed_at: new Date(),
    }),
    { maxRetries: 3, initialDelayMs: 500 }
  );

  // Update job execution status
  await withRetry(
    () => dbForFail('job_executions')
    .where({ job_type: 'publish', idempotency_key: key })
    .update({
      status: 'failed',
      error: error["message"],
      completed_at: new Date(),
    }),
    { maxRetries: 3, initialDelayMs: 500 }
  );

  throw error;
  }

  // Phase 3: Finalize - separate transaction for recording success
  // NOTE: This uses a separate transaction from Phase 1 because:
  // 1. Phase 1's transaction committed before external call (Phase 2)
  // 2. Holding a transaction open during external API calls would be an anti-pattern
  // 3. Idempotency key prevents duplicate processing on retry
  const dbForFinalize = await getDb();
  await dbForFinalize.transaction(async trx => {
  // Set transaction timeout to prevent long-running queries
  await trx.raw('SET LOCAL statement_timeout = ?', [30000]); // 30 seconds

  // P0-4 FIX: Use raw query with ON CONFLICT for idempotent finalization
  await trx.raw(
    `INSERT INTO publish_executions (intent_id, status, external_id, external_url, metadata, completed_at)
    VALUES (?, 'success', ?, ?, ?, ?)
    ON CONFLICT (intent_id, status) WHERE status = 'success' DO NOTHING`,
    [intentId, result.externalId, result['url'], result.metadata ? JSON.stringify(result.metadata) : null, new Date()]
  );

  await trx('job_executions')
    .where({ job_type: 'publish', idempotency_key: key })
    .update({
    status: 'success',
    completed_at: new Date(),
    });

  // Update intent status
  await trx('publish_intents')
    .where({ id: intentId })
    .update({
    status: 'published',
    published_at: new Date(),
    external_id: result.externalId,
    });
  });

  logger.info('Publish execution completed successfully', { intentId });
}


/**
* Register the publish execution job with the scheduler
*/
export function registerPublishExecutionJob(scheduler: JobScheduler): void {
  scheduler.register(
  {
    name: 'publish-execution',
    queue: 'publishing',
    priority: 'high',
    maxRetries: publishingConfig.defaultMaxRetries,
    timeout: publishingConfig.jobTimeoutMs,
  },
  async (_data: unknown, _job) => {
    // Job handler implemented separately
    throw new Error('Handler not implemented - use publishExecutionJob function');
  }
  );
}

// Export for testing
export { PublishExecutionPayloadSchema, getCircuitBreaker };
