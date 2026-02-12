
import pLimit from 'p-limit';
import { z } from 'zod';

import { TIME } from '@kernel/constants';
import { getLogger } from '@kernel/logger';
import { withRetry } from '@kernel/retry';

import { getDb } from '../db';
import { JobScheduler } from './JobScheduler';
const logger = getLogger('feedback-ingest');

// Constants for window sizes
const WINDOWS = [7, 30, 90] as const;
export type WindowSize = typeof WINDOWS[number];

// Maximum entities to process per job
const MAX_ENTITIES = 100;

// Zod validation schema
const FeedbackIngestInputSchema = z.object({
  source: z.enum(['api', 'webhook', 'import', 'sync']),
  entities: z.array(z.object({
  id: z.string().min(1),
  type: z.enum(['content', 'user', 'system']),
  data: z.record(z.string(), z.unknown()).optional(),
  })).max(MAX_ENTITIES),
  orgId: z.string().uuid(),
  timestamp: z.string().datetime().optional(),
});

export type FeedbackIngestInput = z.infer<typeof FeedbackIngestInputSchema>;

export interface FeedbackWindow {
  window: WindowSize;
  entityId: string;
  metrics: {
  count: number;
  positive: number;
  negative: number;
  neutral: number;
  };
}

export interface IngestResult {
  processed: number;
  failed: number;
  windows: FeedbackWindow[];
  errors: string[];
}

/**
* Feedback Ingestion Job
* Processes feedback data across multiple time windows
*/
export async function feedbackIngestJob(payload: unknown): Promise<IngestResult> {
  // Validate input
  let validatedInput: FeedbackIngestInput;
  try {
  validatedInput = FeedbackIngestInputSchema.parse(payload);
  } catch (error) {
  if (error instanceof Error) {
    logger.error('Invalid feedback ingest payload: ' + (error instanceof Error ? error.message : String(error)));
    throw new Error(`Validation failed: ${error["message"]}`);
  }
  throw error;
  }

  const { source, entities, orgId } = validatedInput;

  // Validate orgId at job start
  if (!orgId) {
  throw new Error('orgId is required');
  }

  logger.info('Starting feedback ingestion', {
  entityCount: entities.length,
  });

  const result: IngestResult = {
  processed: 0,
  failed: 0,
  windows: [],
  errors: [],
  };

  // P0-FIX: Process entities with bounded concurrency to prevent resource exhaustion
  const limit = pLimit(10);
  const allItems = entities.map(entity => ({ entity, windows: WINDOWS }));

  const processResults = await Promise.all(
    allItems.map(({ entity, windows }) =>
      limit(async () => {
        try {
          // Process each window for this entity
          const windowResults: FeedbackWindow[] = [];
          for (const window of windows) {
            const windowResult = await processEntityWindow(entity, window, source, orgId);
            if (windowResult) {
              windowResults.push(windowResult);
            }
          }
          return {
            success: true,
            entityId: entity.id,
            windows: windowResults,
          };
        } catch (err) {
          const errorMessage = err instanceof Error ? `Entity ${entity.id}: ${err["message"]}` : `Entity ${entity.id}: Unknown error`;
          logger.error(`Failed to process entity ${entity.id}`, err instanceof Error ? err : new Error(String(err)));
          return {
            success: false,
            entityId: entity.id,
            error: errorMessage,
          };
        }
      })
    )
  );

  // Aggregate results
  for (const procResult of processResults) {
    if (procResult.success) {
      result.processed++;
      if (procResult.windows) {
        result.windows.push(...procResult.windows);
      }
    } else {
      result.failed++;
      if (procResult.error) result.errors.push(procResult.error);
    }
  }

  logger.debug('Batch processing completed', {
    totalItems: entities.length,
    successCount: result.processed,
    failedCount: result.failed,
  });

  // Call storeFeedbackMetrics to persist the data
  if (result.windows.length > 0) {
  try {
    await storeFeedbackMetrics(result.windows, orgId);
    logger.info('Feedback metrics stored successfully', {
    windowCount: result.windows.length,
    });
  } catch (error) {
    if (error instanceof Error) {
    logger.error('Failed to store feedback metrics', error);
    throw new Error(`Failed to store feedback metrics: ${error["message"]}`);
    }
    throw error;
  }
  }

  // FIX #3: Check if all entities failed (processed === 0 and there were entities)
  if (result.processed === 0 && entities.length > 0) {
  throw new AggregateError(
    result.errors.map(e => new Error(e)),
    `All feedback ingestion failed for ${entities.length} entities`
  );
  }

  logger.info('Feedback ingestion completed', {
  processed: result.processed,
  failed: result.failed,
  windowCount: result.windows.length,
  });

  return result;
}

async function processEntityWindow(
  entity: FeedbackIngestInput['entities'][number],
  window: WindowSize,
  source: string,
  orgId: string
): Promise<FeedbackWindow | null> {
  try {
  // Retryable API call for each entity
  const metrics = await withRetry(
    () => fetchFeedbackMetrics(entity.id, window, source, orgId),
    {
    maxRetries: 3,
    initialDelayMs: 1000,
    retryableErrors: ['ECONNREFUSED', 'ETIMEDOUT', 'rate limit', 'timeout'],
    onRetry: (error, attempt) => {
      logger.warn(`Retry ${attempt} for entity ${entity.id}`, { error: error["message"] });
    },
    }
  );

  return {
    entityId: entity.id,
    window,
    metrics,
  };
  } catch (error) {
  logger.error(`Failed to process entity ${entity.id} for window ${window}`, error instanceof Error ? error : new Error(String(error)));
  // Re-throw to let caller handle the failure count
  throw error;
  }
}

async function fetchFeedbackMetrics(
  entityId: string,
  window: WindowSize,
  _source: string,
  _orgId: string
): Promise<FeedbackWindow['metrics']> {
  // Calculate date range for window
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - window * TIME.DAY);

  logger.debug('Fetching feedback metrics', {
  dateRange: { start: startDate, end: endDate },
  });

  // Feedback metrics API integration not yet implemented
  // This is a placeholder that will be replaced with actual API call
  throw new Error('Feedback metrics API integration not implemented');
}

/**
* Store feedback metrics to database
*/
async function storeFeedbackMetrics(
  windows: FeedbackWindow[],
  _orgId: string
): Promise<void> {
  const db = await getDb();

  // FIX #4: Proper connection management using Knex transaction
  const trx = await db.transaction();

  try {
  // Set transaction timeout to prevent long-running queries
  await trx.raw('SET LOCAL statement_timeout = ?', [30000]); // 30 seconds

  // Perform inserts without nested retries inside transaction
  for (const window of windows) {
    await trx.raw(
    `INSERT INTO feedback_metrics (
      entity_id, window_days, metric_count, positive_count,
      negative_count, neutral_count, org_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
    ON CONFLICT (entity_id, window_days)
    DO UPDATE SET
      metric_count = EXCLUDED.metric_count,
      positive_count = EXCLUDED.positive_count,
      negative_count = EXCLUDED.negative_count,
      neutral_count = EXCLUDED.neutral_count,
      updated_at = NOW()`,
    [
      window.entityId,
      window.window,
      window.metrics["count"],
      window.metrics.positive,
      window.metrics.negative,
      window.metrics.neutral,
    ]
    );
  }

  await trx.commit();
  } catch (error) {
  await trx.rollback();
  throw error;
  }
}

/**
* Register the feedback ingest job with the scheduler
*/
export function registerFeedbackIngestJob(scheduler: JobScheduler): void {
  scheduler.register(
  {
    name: 'feedback-ingest',
    queue: 'feedback',
    priority: 'normal',
    maxRetries: 3,
    timeout: 300000,
  },
  async (_data: unknown, _job) => {
    // Job handler implemented separately
    throw new Error('Handler not implemented - use feedbackIngestJob function');
  }
  );
}

// Export for use in job registration
export { FeedbackIngestInputSchema, storeFeedbackMetrics };
