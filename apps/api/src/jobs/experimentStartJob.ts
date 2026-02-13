
import { z } from 'zod';

import { getLogger } from '@kernel/logger';
import { getDb } from '../db';
import { JobScheduler } from './JobScheduler';
const ExperimentSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  status: z.enum(['draft', 'ready', 'running', 'completed', 'cancelled']),
  variants: z.array(z.unknown()).optional(),
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
  triggeredBy: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
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
    logger.error('Invalid experiment start payload: ' + error.message);
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
  await trx('experiment_runs')
    .where({ experiment_id: experimentId })
    .forUpdate()
    .select('*');

  // Fetch experiment with row-level locking to prevent concurrent modifications
  // Lock acquired AFTER runs lock to maintain consistent locking order
  const expResult = await trx('experiments')
    .where({ id: experimentId })
    .forUpdate()  // Lock the row until transaction completes
    .first();
  const exp = expResult ? validateExperiment(expResult) : undefined;

  if (!exp) {
    logger.error('Experiment not found', new Error('Experiment not found'), { experimentId });
    throw new Error('Experiment not found');
  }

  // Validate experiment state
  if (exp.status === 'running') {
    logger.warn('Experiment is already running', { experimentId });
    // Return early but still commit transaction (idempotent behavior)
    return { status: 'already_running', experimentId };
  }

  if (exp.status === 'completed' || exp.status === 'cancelled') {
    logger.error('Cannot start experiment - invalid state', undefined, {
    currentStatus: exp.status
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
  const updated = await trx('experiments')
    .where({ id: experimentId })
    .whereNotIn('status', ['running', 'completed', 'cancelled'])  // Only update valid states
    .update({
    status: 'running',
    started_at: new Date(),
    started_by: triggeredBy,
    metadata: metadata ? JSON.stringify(metadata) : undefined,
    })
    .returning(['id']);

  if (updated.length === 0) {
    // Race condition: another job may have updated the status
    // Check current state to return appropriate response
    const currentExpResult = await trx('experiments')
    .where({ id: experimentId })
    .first();
    const currentExp = currentExpResult ? validateExperiment(currentExpResult) : undefined;

    if (currentExp?.status === 'running') {
    logger.info('Experiment started by another concurrent job', { experimentId });
    return { status: 'already_running', experimentId };
    }

    throw new Error('Failed to update experiment status - experiment may have invalid state');
  }

  // Also create experiment run record for audit trail within same transaction
  await trx('experiment_runs').insert({
    experiment_id: experimentId,
    started_at: new Date(),
    started_by: triggeredBy,
    status: 'running',
  });

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
