
import pLimit from 'p-limit';
import type { Pool } from 'pg';

import { getLogger } from '@kernel/logger';
import { withRetry } from '@kernel/retry';

import { PostgresContentRepository } from '../../domains/content/infra/persistence/PostgresContentRepository';
import { PublishContent } from '../../domains/content/application/handlers/PublishContent';
import { resolveDomainDb } from '../services/domain-registry';

const logger = getLogger('content-scheduler');

const MAX_CONCURRENT_PUBLISHES = 5;
const DEFAULT_TIMEOUT_MS = 30000;

// Import the domain ContentItem
import { ContentItem } from '../../domains/content/domain/entities/ContentItem';

/**
* Run content scheduler with graceful shutdown support
*/
export async function runContentScheduler(signal?: AbortSignal): Promise<{
  processed: number;
  failed: number;
  items: string[];
}> {
  logger.info('Starting content scheduler');

  // Check if already aborted
  if (signal?.aborted) {
  logger.warn('Content scheduler aborted before starting');
  return { processed: 0, failed: 0, items: [] };
  }

  const repo = new PostgresContentRepository(resolveDomainDb('content') as unknown as Pool);

  // Fetch ready content with retry
  let ready: ContentItem[];
  try {
  ready = await withRetry(
    () => repo.listReadyToPublish(new Date()),
    {
    maxRetries: 3,
    initialDelayMs: 1000,
    retryableErrors: ['ECONNREFUSED', 'ETIMEDOUT', 'timeout'],
    onRetry: (error: Error, attempt: number) => {
    logger.warn(`Retry ${attempt} fetching ready content`, { error: error['message'] });
    },
    }
  );
  } catch (error) {
  const errorToLog = error instanceof Error ? error : new Error(String(error));
  logger["error"]('Failed to fetch ready content after retries', errorToLog);
  throw error;
  }

  logger.info('Found content ready to publish', { count: ready.length });

  const results = {
  processed: 0,
  failed: 0,
  items: [] as string[],
  };

  // P0-FIX: Use p-limit for bounded concurrency instead of Promise.race pattern
  // This prevents unhandled rejection issues and memory leaks
  const limit = pLimit(MAX_CONCURRENT_PUBLISHES);

  // Check for abort before processing
  if (signal?.aborted) {
    logger.warn('Content scheduler aborted before processing');
    return results;
  }

  // P0-FIX: Process items in chunks to prevent memory exhaustion with large datasets
  const CHUNK_SIZE = 100;
  for (let i = 0; i < ready.length; i += CHUNK_SIZE) {
    const chunk = ready.slice(i, i + CHUNK_SIZE);
    
    const processPromises = chunk.map((item) =>
      limit(async () => {
        // Check abort signal before each item
        if (signal?.aborted) {
          logger.warn('Content scheduler aborted mid-processing', {
            processed: results.processed,
          });
          return;
        }

        try {
          await publishWithTimeout(item, repo, signal);
          results.processed++;
          results.items.push(item["id"]);
          logger.info('Content published', { contentId: item["id"], title: item.title });
        } catch (error) {
          results.failed++;
          const errorToLog = error instanceof Error ? error : new Error(String(error));
          logger["error"]('Failed to publish content', errorToLog, {
            contentId: item["id"],
            title: item.title,
          });
        }
      })
    );

    // Wait for chunk to complete before processing next chunk
    await Promise.all(processPromises);
  }

  logger.info('Content scheduler completed', {
  processed: results.processed,
  failed: results.failed,
  total: ready.length,
  });

  return results;
}

async function publishWithTimeout(
  item: ContentItem,
  repo: PostgresContentRepository,
  signal?: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
  const timeoutId = setTimeout(() => {
    reject(new Error(`Publish timeout after ${DEFAULT_TIMEOUT_MS}ms for content ${item["id"]}`));
  }, DEFAULT_TIMEOUT_MS);

  const abortHandler = () => {
    clearTimeout(timeoutId);
    reject(new Error(`Publish aborted for content ${item["id"]}`));
  };

  if (signal) {
    signal.addEventListener('abort', abortHandler);
  }

  const handler = new PublishContent(repo);
  handler.execute(item["id"])
    .then(() => {
    clearTimeout(timeoutId);
    if (signal) {
    signal.removeEventListener('abort', abortHandler);
    }
    resolve();
    })
    .catch((error) => {
    clearTimeout(timeoutId);
    if (signal) {
    signal.removeEventListener('abort', abortHandler);
    }
    reject(error);
    });
  });
}
