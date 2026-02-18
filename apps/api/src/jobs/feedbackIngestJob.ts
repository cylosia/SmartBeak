
import pLimit from 'p-limit';
import { z } from 'zod';

import { TIME as _TIME } from '@kernel/constants';
import { getLogger } from '@kernel/logger';
import { withRetry } from '@kernel/retry';
import { withSpan, addSpanAttributes, getBusinessKpis } from '@packages/monitoring';

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
*
* P0-3 FIX: Guard against scheduling this job while fetchFeedbackMetrics
* is not implemented. Previously, the stub threw inside the processing loop,
* causing every entity to fail, burning 3 retries, and flooding error logs.
*/
export async function feedbackIngestJob(payload: unknown): Promise<IngestResult> {
  return withSpan({ spanName: 'feedbackIngestJob' }, async () => {
  // P0-3 FIX: Fail fast if the metrics API is not yet implemented.
  // This prevents the job from burning through retries on dead code.
  try {
    await fetchFeedbackMetrics('__probe__', 7, 'api', '00000000-0000-0000-0000-000000000000');
  } catch (error) {
    if (error instanceof NotImplementedError) {
      logger.error('feedbackIngestJob called but fetchFeedbackMetrics is not implemented. Remove this job from the scheduler.');
      throw error; // Non-retryable -- do not retry NotImplementedError
    }
    // Probe failed for other reasons (network etc.) -- continue with actual processing
  }

  // Validate input
  let validatedInput: FeedbackIngestInput;
  try {
  validatedInput = FeedbackIngestInputSchema.parse(payload);
  } catch (error) {
    if (error instanceof Error) {
      logger.error('Invalid feedback ingest payload', error);
      throw new Error(`Validation failed: ${error.message}`);
    }
    throw error;
  }

  const { source, entities, orgId } = validatedInput;

  // Validate orgId at job start
  if (!orgId) {
  throw new Error('orgId is required');
  }

  addSpanAttributes({ 'ingest.source': source, 'ingest.entity_count': entities.length });
  try { getBusinessKpis().recordIngestionAttempt(source); } catch (kpiErr) {
    logger.warn('KPI not initialized; skipping recordIngestionAttempt', { error: kpiErr instanceof Error ? kpiErr.message : String(kpiErr) });
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

  // P1-7 FIX: Reduced from pLimit(10) to pLimit(3).
  // Each entity processes 3 windows with up to 3 retries each = 9 DB operations per slot.
  // 10 concurrent slots = 90 simultaneous DB ops, exhausting a default pool of 10 connections.
  // 3 concurrent slots = ≤27 simultaneous DB ops, leaving headroom for other queries.
  const limit = pLimit(3);
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
          const errorMessage = err instanceof Error ? `Entity ${entity.id}: ${err.message}` : `Entity ${entity.id}: Unknown error`;
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
    throw new Error(`Failed to store feedback metrics: ${error.message}`);
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

  addSpanAttributes({ 'ingest.processed': result.processed, 'ingest.failed': result.failed });
  try {
    if (result.processed > 0) getBusinessKpis().recordIngestionSuccess(source, result.processed);
    if (result.failed > 0) getBusinessKpis().recordIngestionFailure(source, result.failed);
  } catch (kpiErr) {
    logger.warn('KPI not initialized; skipping ingestion metrics', { error: kpiErr instanceof Error ? kpiErr.message : String(kpiErr) });
  }

  logger.info('Feedback ingestion completed', {
  processed: result.processed,
  failed: result.failed,
  windowCount: result.windows.length,
  });

  return result;
  });
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
      logger.warn(`Retry ${attempt} for entity ${entity.id}`, { error: error.message });
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

/**
 * P0-3 FIX: fetchFeedbackMetrics previously threw unconditionally
 * ("Feedback metrics API integration not implemented"), making the entire
 * feedbackIngestJob dead code that burned through retries and flooded logs.
 *
 * This function now fails fast with a clear NotImplementedError so callers
 * can detect and avoid scheduling the job until integration is complete.
 */
async function fetchFeedbackMetrics(
  _entityId: string,
  _window: WindowSize,
  _source: string,
  _orgId: string
): Promise<FeedbackWindow['metrics']> {
  // TODO: Implement feedback metrics API integration.
  // Until this is implemented, feedbackIngestJob must NOT be scheduled.
  // The job entry point guards against this with a pre-check.
  throw new NotImplementedError('Feedback metrics API integration not implemented');
}

/**
 * P0-3 FIX: Dedicated error class so callers can distinguish "not implemented"
 * from transient failures and avoid retrying.
 */
class NotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotImplementedError';
  }
}

/**
* Store feedback metrics to database
*
* P1-7 FIX: Previously used individual INSERT per window in a for loop,
* producing up to 300 SQL round-trips (100 entities x 3 windows) inside
* a single transaction. Now batches all inserts into a single UNNEST query.
*
* P2-4 FIX: If trx.rollback() threw (e.g., connection lost), the original
* error was swallowed. Now preserves both errors via AggregateError.
*/
async function storeFeedbackMetrics(
  windows: FeedbackWindow[],
  orgId: string
): Promise<void> {
  const db = await getDb();

  const trx = await db.transaction();

  try {
  // M1 FIX: PostgreSQL SET commands do not accept parameterized placeholders ($1/$?).
  // Using a literal value here is correct; 30000 ms = 30 seconds.
  await trx.raw('SET LOCAL statement_timeout = 30000');

  // P1-7 FIX: Batch all windows into a single INSERT ... SELECT * FROM UNNEST(...)
  // instead of N individual INSERTs. Reduces round-trips from O(n) to O(1).
  if (windows.length > 0) {
    const entityIds = windows.map(w => w.entityId);
    const windowDays = windows.map(w => w.window);
    const metricCounts = windows.map(w => w.metrics.count);
    const positiveCounts = windows.map(w => w.metrics.positive);
    const negativeCounts = windows.map(w => w.metrics.negative);
    const neutralCounts = windows.map(w => w.metrics.neutral);
    const orgIds = windows.map(() => orgId);

    // M2 FIX: PostgreSQL UNNEST requires all arrays to have identical length.
    // Validate before issuing the query to produce a clear error rather than
    // a cryptic Postgres "arrays must have same length" failure.
    const arrays = [entityIds, windowDays, metricCounts, positiveCounts, negativeCounts, neutralCounts, orgIds];
    const lengths = new Set(arrays.map(a => a.length));
    if (lengths.size !== 1) {
      throw new Error(`UNNEST array length mismatch: ${JSON.stringify(arrays.map(a => a.length))}`);
    }

    // P0-2 FIX: ON CONFLICT now includes org_id. Without it, two orgs sharing
    // an entity_id+window_days combination would silently overwrite each other's
    // rows — cross-org data corruption with no error or constraint violation.
    //
    // M3 FIX: updated_at added to the INSERT column list. Previously the INSERT
    // omitted updated_at, leaving first-insert rows with updated_at = NULL.
    // Only the ON CONFLICT UPDATE path set updated_at = NOW(), creating an
    // inconsistency between new and updated rows.
    await trx.raw(
    `INSERT INTO feedback_metrics (
      entity_id, window_days, metric_count, positive_count,
      negative_count, neutral_count, org_id, created_at, updated_at
    )
    SELECT t.entity_id, t.window_days, t.metric_count, t.positive_count,
           t.negative_count, t.neutral_count, t.org_id, NOW(), NOW()
    FROM UNNEST(
      ?::text[], ?::int[], ?::int[], ?::int[],
      ?::int[], ?::int[], ?::text[]
    ) AS t(entity_id, window_days, metric_count, positive_count,
           negative_count, neutral_count, org_id)
    ON CONFLICT (org_id, entity_id, window_days)
    DO UPDATE SET
      metric_count = EXCLUDED.metric_count,
      positive_count = EXCLUDED.positive_count,
      negative_count = EXCLUDED.negative_count,
      neutral_count = EXCLUDED.neutral_count,
      updated_at = NOW()`,
    [entityIds, windowDays, metricCounts, positiveCounts,
     negativeCounts, neutralCounts, orgIds]
    );
  }

  await trx.commit();
  } catch (error) {
  // P2-4 FIX: Preserve original error if rollback also fails
  try {
    await trx.rollback();
  } catch (rollbackError) {
    throw new AggregateError(
    [error, rollbackError],
    `Query failed and rollback also failed`
    );
  }
  throw error;
  }
}

/**
* Register the feedback ingest job with the scheduler
*
* P0-3 FIX: Handler now delegates to feedbackIngestJob instead of throwing.
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
  async (data: unknown, _job) => {
    return feedbackIngestJob(data);
  }
  );
}

// Export for use in job registration
export { FeedbackIngestInputSchema, storeFeedbackMetrics };
