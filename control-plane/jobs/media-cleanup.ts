


import pLimit from 'p-limit';
import { Pool } from 'pg';

import { getLogger } from '@kernel/logger';
import { TIME } from '@kernel/constants';
import { withRetry } from '@kernel/retry';

import { MediaLifecycleService } from '../services/media-lifecycle';

const logger = getLogger('media-cleanup');

// Constants for cleanup configuration
const COLD_MEDIA_DAYS = 30;
const ORPHAN_MEDIA_DAYS = 7;

// Job timeout
const JOB_TIMEOUT_MS = 5 * TIME.MINUTE; // 5 minutes

const BATCH_SIZE = 100;

const MAX_CONCURRENT_OPERATIONS = 10;

export interface CleanupResult {
  coldMoved: number;
  orphanedDeleted: number;
  errors: string[];
}

/**
* P0-FIX: Use p-limit for bounded concurrency instead of custom Semaphore
* Prevents connection pool exhaustion when processing large batches
*/

/**
* Run media cleanup job with timeout, retry logic, and concurrency limiting
*/
export async function runMediaCleanup(pool: Pool, signal?: AbortSignal): Promise<CleanupResult> {
  logger.info('Starting media cleanup job');

  // Check if already aborted
  if (signal?.aborted) {
  logger.warn('Media cleanup aborted before starting');
  return { coldMoved: 0, orphanedDeleted: 0, errors: [] };
  }

  const result: CleanupResult = {
  coldMoved: 0,
  orphanedDeleted: 0,
  errors: [],
  };

  // P1-5 FIX: Track timeout timer ID so it can be cleared when cleanup finishes
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
  timeoutId = setTimeout(() => {
    reject(new Error(`Media cleanup job timeout after ${JOB_TIMEOUT_MS}ms`));
  }, JOB_TIMEOUT_MS);
  });

  try {
  // Race between actual work and timeout
  const cleanupPromise = executeCleanup(pool, signal, result);
  await Promise.race([cleanupPromise, timeoutPromise]);
  } catch (error) {
  const err = error instanceof Error ? error : new Error(String(error));
  logger.error('Media cleanup failed or timed out', err);
  result.errors.push(err.message);
  throw error;
  } finally {
  // P1-5 FIX: Always clear the timeout to prevent resource leak
  clearTimeout(timeoutId!);
  }

  logger.info('Media cleanup completed', {
  coldMoved: result.coldMoved,
  orphanedDeleted: result.orphanedDeleted,
  });

  return result;

  async function executeCleanup(
  pool: Pool,
  signal: AbortSignal | undefined,
  result: CleanupResult
  ): Promise<void> {
  const svc = new MediaLifecycleService(pool);

  // P0-FIX: Use p-limit for bounded concurrency
  const limit = pLimit(MAX_CONCURRENT_OPERATIONS);

  // Move cold media with retry
  logger.debug('Finding cold media candidates', { days: COLD_MEDIA_DAYS });
  let cold: string[];
  try {
    cold = await withRetry(
    () => svc.findColdCandidates(COLD_MEDIA_DAYS),
    {
    maxRetries: 3,
    initialDelayMs: 1000,
    // P1-9 FIX: Added PostgreSQL deadlock/serialization error codes
    retryableErrors: ['ECONNREFUSED', 'ETIMEDOUT', 'timeout', '40P01', '40001'],
    }
    );
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to find cold media candidates', err);
    throw err;
  }

  logger.info('Found cold media candidates', { count: cold.length });

  // P0-FIX: Process cold media with bounded concurrency using p-limit
  for (let i = 0; i < cold.length; i += BATCH_SIZE) {
    // Check abort signal
    if (signal?.aborted) {
    logger.warn('Media cleanup aborted during cold media processing');
    break;
    }

    const batch = cold.slice(i, i + BATCH_SIZE);

    await Promise.all(
    batch.map((id) =>
    limit(async () => {
        try {
        await withRetry(
            () => svc.markCold(id),
            {
            maxRetries: 3,
            initialDelayMs: 500,
            // P1-9 FIX: Added PostgreSQL deadlock/serialization error codes
    retryableErrors: ['ECONNREFUSED', 'ETIMEDOUT', '40P01', '40001'],
            }
        );
        result.coldMoved++;
        logger.debug('Marked media as cold', { mediaId: id });
        } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.error('Failed to mark media as cold', err, { mediaId: id });
        result.errors.push(`Cold media ${id}: ${err.message}`);
        }
    })
    )
    );
  }

  // Delete orphaned media with retry
  logger.debug('Finding orphaned media', { days: ORPHAN_MEDIA_DAYS });
  let orphaned: string[];
  try {
    orphaned = await withRetry(
    () => svc.findOrphaned(ORPHAN_MEDIA_DAYS),
    {
    maxRetries: 3,
    initialDelayMs: 1000,
    // P1-9 FIX: Added PostgreSQL deadlock/serialization error codes
    retryableErrors: ['ECONNREFUSED', 'ETIMEDOUT', 'timeout', '40P01', '40001'],
    }
    );
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to find orphaned media', err);
    throw err;
  }

  logger.info('Found orphaned media', { count: orphaned.length });

  // P0-FIX: Process orphaned media with bounded concurrency using p-limit
  for (let i = 0; i < orphaned.length; i += BATCH_SIZE) {
    // Check abort signal
    if (signal?.aborted) {
    logger.warn('Media cleanup aborted during orphaned media processing');
    break;
    }

    const batch = orphaned.slice(i, i + BATCH_SIZE);

    await Promise.all(
    batch.map((id) =>
    limit(async () => {
        try {
        await withRetry(
            () => svc.delete(id),
            {
            maxRetries: 3,
            initialDelayMs: 500,
            // P1-9 FIX: Added PostgreSQL deadlock/serialization error codes
    retryableErrors: ['ECONNREFUSED', 'ETIMEDOUT', '40P01', '40001'],
            }
        );
        result.orphanedDeleted++;
        logger.debug('Deleted orphaned media', { mediaId: id });
        } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.error('Failed to delete orphaned media', err, { mediaId: id });
        result.errors.push(`Orphaned media ${id}: ${err.message}`);
        }
    })
    )
    );
  }
  }
}
