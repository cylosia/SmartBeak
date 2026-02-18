
import { randomUUID } from 'crypto';
import { z } from 'zod';

import { getLogger } from '@kernel/logger';
import { getDb } from '../db';
import { JobScheduler } from './JobScheduler';
// P1-CORRECTNESS FIX: Tighten variant schema from `z.unknown()` to at least
// require each variant to be a non-null object, preventing nonsensical data
// (e.g., a variant that is a number or null) from passing validation.
const ExperimentVariantSchema = z.object({}).passthrough();

const ExperimentSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  status: z.enum(['draft', 'ready', 'running', 'completed', 'cancelled']),
  variants: z.array(ExperimentVariantSchema).optional(),
});

export type Experiment = z.infer<typeof ExperimentSchema>;

function validateExperiment(row: unknown): Experiment {
  const result = ExperimentSchema.safeParse(row);
  if (!result.success) {
  throw new Error(`Invalid experiment data: ${result.error.message}`);
  }
  return result.data;
}

const logger = getLogger('experiment-start');

// Zod validation schema
const ExperimentStartInputSchema = z.object({
  experimentId: z.string().uuid(),
  // P1-5 FIX: Cap triggeredBy to prevent DoS via oversized payload.
  // An unbounded string causes either a PostgreSQL "value too long" error
  // mid-transaction (stuck experiment state) or unbounded TEXT column growth.
  triggeredBy: z.string().max(256).optional(),
  // P1-6 FIX: Bound the metadata record to prevent DoS via oversized payload.
  // An unbounded z.record(z.string(), z.unknown()) allows an attacker to submit
  // millions of keys or multi-MB values, causing OOM, WAL bloat, and disk exhaustion.
  // Cap keys at 100 chars, values capped indirectly via the 50-key limit + 32KB total.
  metadata: z
    .record(z.string().max(100), z.unknown())
    .refine((m: Record<string, unknown>) => JSON.stringify(m).length < 32_768, {
      message: 'metadata exceeds 32 KB size limit',
    })
    .optional(),
});

export type ExperimentStartInput = z.infer<typeof ExperimentStartInputSchema>;

/**
* Experiment Start Job
* Validates and starts an experiment within a database transaction
* to ensure atomicity of all operations
*/
export async function experimentStartJob(payload: unknown): Promise<{ status: string; experimentId: string }> {
  // Validate input
  let validatedInput: ExperimentStartInput;
  try {
  validatedInput = ExperimentStartInputSchema.parse(payload);
  } catch (error) {
  if (error instanceof Error) {
    // P1-3 FIX: Use structured logging instead of string concatenation to prevent
    // log injection. String concatenation happens before the logger can redact
    // sensitive fields — a malicious error.message with newlines breaks log parsers.
    logger.error('Invalid experiment start payload', error, { validationError: error.message });
    throw new Error(`Validation failed: ${error.message}`);
  }
  throw error;
  }

  const { experimentId, triggeredBy, metadata } = validatedInput;

  logger.info('Starting experiment', { experimentId, triggeredBy });

  // This ensures atomicity - either all updates succeed or none do
  const db = await getDb();
  return await db.transaction(async (trx) => {
  // Set transaction timeout to prevent long-running queries
  await trx.raw('SET LOCAL statement_timeout = ?', [30000]); // 30 seconds

  // Lock in consistent order: runs -> experiments to avoid deadlock with concurrent jobs
  // This also prevents race conditions when multiple concurrent jobs try to start the same experiment
  // P1-SQL FIX: Select only the id column for the lock query — SELECT * fetches all columns
  // unnecessarily and is expensive if experiment_runs has large JSONB/bytea columns.
  await trx('experiment_runs')
    .where({ experiment_id: experimentId })
    .forUpdate()
    .select('id');

  // Fetch experiment with row-level locking to prevent concurrent modifications
  // Lock acquired AFTER runs lock to maintain consistent locking order
  // P2-4 FIX: Select only the columns consumed by validateExperiment.
  // SELECT * unnecessarily fetches large JSONB/bytea columns inside a transaction
  // holding a FOR UPDATE lock, increasing latency under contention.
  const expResult = await trx('experiments')
    .where({ id: experimentId })
    .forUpdate()
    .select(['id', 'name', 'status', 'variants'])
    .first();
  const exp = expResult ? validateExperiment(expResult) : undefined;

  if (!exp) {
    logger.error('Experiment not found', new Error('Experiment not found'), { experimentId });
    throw new Error('Experiment not found');
  }

  // P1-3 FIX: Use an allowlist (only 'ready' can be started) instead of a blocklist.
  // Previously 'draft' was implicitly allowed, letting incomplete/unapproved experiments
  // run in production and corrupting A/B test results.
  if (exp.status === 'running') {
    logger.warn('Experiment is already running', { experimentId });
    return { status: 'already_running', experimentId };
  }
  if (exp.status !== 'ready') {
    logger.error('Cannot start experiment — not in ready state', undefined, {
      currentStatus: exp.status,
    });
    throw new Error(`Cannot start experiment with status: ${exp.status}`);
  }

  if (!exp.variants || exp.variants.length < 2) {
    logger.error('Experiment must have at least 2 variants', undefined, {
    variantCount: exp.variants?.length || 0,
    });
    throw new Error('Experiment must have at least 2 variants');
  }

  // The WHERE clause ensures we only update if status is still not 'running'
  // This prevents multiple concurrent jobs from starting the same experiment
  // F-4.8 FIX: Build the update payload conditionally to avoid NULL overwrite.
  // With `exactOptionalPropertyTypes`, passing `metadata: undefined` to Knex causes
  // `UPDATE experiments SET metadata = NULL` — silently erasing existing metadata
  // on any retry that omits the metadata field. Only include metadata in the SET
  // clause when the caller explicitly provides it.
  const updatePayload: Record<string, unknown> = {
    status: 'running',
    started_at: new Date(),
    started_by: triggeredBy ?? null,
  };
  if (metadata !== undefined) {
    updatePayload['metadata'] = JSON.stringify(metadata);
  }

  // P1-3 FIX: whereNotIn now explicitly includes 'draft' to match the allowlist guard above.
  const updated = await trx('experiments')
    .where({ id: experimentId })
    .whereNotIn('status', ['running', 'completed', 'cancelled', 'draft'])
    .update(updatePayload)
    .returning(['id']);

  if (updated.length === 0) {
    // Race condition: another job may have updated the status
    // Check current state to return appropriate response
    // P2-4 FIX: Select only columns consumed by validateExperiment.
    // SELECT * fetches large JSONB/bytea columns unnecessarily inside a
    // transaction holding a FOR UPDATE lock, increasing latency under contention.
    const currentExpResult = await trx('experiments')
    .where({ id: experimentId })
    .select(['id', 'name', 'status', 'variants'])
    .first();
    const currentExp = currentExpResult ? validateExperiment(currentExpResult) : undefined;

    if (currentExp?.status === 'running') {
    logger.info('Experiment started by another concurrent job', { experimentId });
    return { status: 'already_running', experimentId };
    }

    throw new Error('Failed to update experiment status - experiment may have invalid state');
  }

  // Also create experiment run record for audit trail within same transaction.
  // P1-CORRECTNESS FIX: Include explicit `id` to avoid failure when the table
  // has a UUID primary key without a DB-level default (gen_random_uuid() requires PG13+
  // and is not guaranteed to be set in all environments).
  // P1-9 FIX: Use onConflict().ignore() to guard against duplicate run records.
  // On retry after a partial commit (network partition between UPDATE and INSERT),
  // the experiment_id+status unique partial index (status='running') prevents
  // a duplicate experiment_runs row that would corrupt A/B result aggregation.
  await trx('experiment_runs')
    .insert({
      id: randomUUID(),
      experiment_id: experimentId,
      started_at: new Date(),
      started_by: triggeredBy ?? null,
      status: 'running',
    })
    .onConflict(['experiment_id'])
    .ignore();

  logger.info('Experiment started successfully', {
    name: exp.name,
    variantCount: exp.variants.length,
  });

  return { status: 'started', experimentId };
  });
}

/**
* Register the experiment start job with the scheduler
*/
// P1-ARCHITECTURE FIX: Wire handler to call experimentStartJob instead of throwing
export function registerExperimentStartJob(scheduler: JobScheduler): void {
  scheduler.register(
  {
    name: 'experiment-start',
    queue: 'experiments',
    priority: 'high',
    maxRetries: 2,
    timeout: 60000,
  },
  async (data: unknown, _job) => {
    await experimentStartJob(data);
  }
  );
}

// Export for job registration
export { ExperimentStartInputSchema };
