import { z } from 'zod';

import { getLogger } from '@kernel/logger';
const logger = getLogger('job-guards');

const CountResultSchema = z.object({
  count: z.union([z.string(), z.number()]),
});

function validateCountResult(row: unknown): { count: string | number } {
  const result = CountResultSchema.safeParse(row);
  if (!result.success) {
  throw new Error(`Invalid count result: ${result.error["message"]}`);
  }
  return result.data;
}

const MAX_ACTIVE_JOBS_PER_ORG = 10;

// Type definitions for database - using Knex-like interface
export interface JobExecution {
  id: string;
  status: string;
  entity_id: string;
}

export interface CountResult {
  count: string | number;
}

/**
 * Database interface compatible with Knex query builder
 * Uses generic typing to allow flexible query building
 */
export interface Database {
  <T = Record<string, unknown>>(tableName: string): KnexQueryBuilder<T>;
}

/**
 * Simplified Knex query builder interface
 */
export interface KnexQueryBuilder<T> {
  where: (conditions: Partial<T>) => KnexQueryBuilder<T>;
  andWhere: (conditions: Partial<T>) => KnexQueryBuilder<T>;
  count: () => Promise<Array<{ count: string | number }>>;
}

/**
* Assert organization has capacity for new jobs
* MEDIUM FIX M1: Added proper types
* MEDIUM FIX M2: Added structured logging
*/
export async function assertOrgCapacity(db: Database, orgId: string): Promise<void> {
  logger.debug('Checking org capacity', { orgId, maxActiveJobs: MAX_ACTIVE_JOBS_PER_ORG });

  const countResult = await db('job_executions')
  .where({ status: 'started' })
  .andWhere({ entity_id: orgId })["count"]();

  // P2-2 FIX: Check array is non-empty before accessing index 0
  if (!countResult.length) {
  throw new Error('No count result returned from job_executions query');
  }

  const result = validateCountResult(countResult[0]);

  const count = typeof result["count"] === 'string' ? parseInt(result["count"], 10) : result["count"];

  // P2-3 FIX: Check for NaN. parseInt returns NaN for non-numeric strings,
  // and NaN >= MAX_ACTIVE_JOBS_PER_ORG evaluates to false, silently bypassing
  // the capacity limit.
  if (Number.isNaN(count)) {
  throw new Error(`Invalid job count value: ${String(result["count"])}`);
  }

  logger.debug('Org job count', { orgId, activeJobs: count });

  if (count >= MAX_ACTIVE_JOBS_PER_ORG) {
  logger.warn('Org concurrency limit reached', {
    activeJobs: count,
    limit: MAX_ACTIVE_JOBS_PER_ORG
  });
  throw new Error('Org concurrency limit reached');
  }
}

/**
 * Check if org has capacity without throwing on capacity-limit errors.
 *
 * P1-FIX: Previously caught ALL exceptions and returned false. A database
 * connection failure returned false (appearing as "no capacity"), silently
 * masking outages. Now only capacity-limit errors return false; all other
 * errors (DB down, query failure, unexpected values) are re-thrown so
 * callers and alerting systems see them.
 */
export async function checkOrgCapacity(db: Database, orgId: string): Promise<boolean> {
  try {
    await assertOrgCapacity(db, orgId);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Only treat the specific capacity-limit message as a "false" return.
    // Everything else (DB errors, NaN counts, etc.) is re-thrown.
    if (msg === 'Org concurrency limit reached') {
      return false;
    }
    throw err;
  }
}

/**
* Get current active job count for org
*/
export async function getOrgActiveJobCount(db: Database, orgId: string): Promise<number> {
  const countResult = await db('job_executions')
  .where({ status: 'started' })
  .andWhere({ entity_id: orgId })["count"]();

  // P2-2 FIX: Check array is non-empty before accessing index 0
  if (!countResult.length) {
  throw new Error('No count result returned from job_executions query');
  }

  const result = validateCountResult(countResult[0]);
  const count = typeof result["count"] === 'string' ? parseInt(result["count"], 10) : result["count"];

  // P2-3 FIX: Guard against NaN from parseInt
  if (Number.isNaN(count)) {
  throw new Error(`Invalid job count value: ${String(result["count"])}`);
  }

  return count;
}
