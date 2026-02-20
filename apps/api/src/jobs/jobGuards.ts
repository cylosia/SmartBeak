import { z } from 'zod';

import { getLogger } from '@kernel/logger';
import { RateLimitError, ValidationError, DatabaseError } from '@errors';
import type { OrgId } from '@kernel/branded';

const logger = getLogger('job-guards');

const CountResultSchema = z.object({
  count: z.union([z.string(), z.number()]),
});

function validateCountResult(row: unknown): { count: string | number } {
  const result = CountResultSchema.safeParse(row);
  if (!result.success) {
    throw new ValidationError(`Invalid count result: ${result.error["message"]}`, 'count');
  }
  return result.data;
}

const MAX_ACTIVE_JOBS_PER_ORG = 10;

/** Valid job execution statuses matching the DB enum */
export type JobExecutionStatus = 'pending' | 'started' | 'completed' | 'failed' | 'retrying';

// Type definitions for database - using Knex-like interface
export interface JobExecution {
  id: string;
  status: JobExecutionStatus;
  entity_id: string;
}

export interface CountResult {
  count: string | number;
}

/**
 * Database interface compatible with Knex query builder.
 * Includes `raw` and `transaction` for advisory-lock-based capacity checks.
 */
export interface Database {
  <T = Record<string, unknown>>(tableName: string): KnexQueryBuilder<T>;
  raw: (sql: string, bindings?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  transaction: <T>(fn: (trx: Database) => Promise<T>) => Promise<T>;
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
 * Parse and validate a count query result.
 *
 * P3-1 FIX: Extracted shared logic from assertOrgCapacity and getOrgActiveJobCount
 * to eliminate duplicated query + validation + NaN-check code.
 */
function getValidatedJobCount(countResult: Array<{ count: string | number }>): number {
  if (!countResult.length) {
    throw new DatabaseError('No count result returned from job_executions query');
  }

  const result = validateCountResult(countResult[0]);
  const count = typeof result["count"] === 'string' ? parseInt(result["count"], 10) : result["count"];

  if (Number.isNaN(count)) {
    throw new ValidationError(`Invalid job count value: ${String(result["count"])}`, 'count');
  }

  return count;
}

/**
 * Assert organization has capacity for new jobs.
 *
 * P0-1 FIX: Uses a PostgreSQL advisory lock within a transaction to prevent
 * TOCTOU race conditions. Previously, the count was read and the caller
 * inserted in separate operations — two concurrent requests could both read
 * count=9 (limit=10), both pass the check, and both insert, exceeding the
 * limit. The advisory lock serializes capacity checks per org.
 *
 * P1-7 FIX: Throws AppError subclasses instead of bare Error.
 * P1-8 FIX: Uses branded OrgId type.
 */
export async function assertOrgCapacity(db: Database, orgId: OrgId): Promise<void> {
  logger.debug('Checking org capacity', { orgId, maxActiveJobs: MAX_ACTIVE_JOBS_PER_ORG });

  await db.transaction(async (trx) => {
    // Acquire advisory lock scoped to this org for the duration of the transaction.
    // hashtext() produces a stable int4 from the org string key.
    await trx.raw(
      `SELECT pg_advisory_xact_lock(hashtext($1))`,
      [`org_capacity:${orgId}`]
    );

    const countResult = await trx('job_executions')
      .where({ status: 'started' })
      .andWhere({ entity_id: orgId })["count"]();

    const count = getValidatedJobCount(countResult);

    logger.debug('Org job count', { orgId, activeJobs: count });

    if (count >= MAX_ACTIVE_JOBS_PER_ORG) {
      logger.warn('Org concurrency limit reached', {
        activeJobs: count,
        limit: MAX_ACTIVE_JOBS_PER_ORG,
      });
      throw new RateLimitError(
        'Org concurrency limit reached',
        0
      );
    }
  });
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
export async function checkOrgCapacity(db: Database, orgId: OrgId): Promise<boolean> {
  try {
    await assertOrgCapacity(db, orgId);
    return true;
  } catch (err) {
    // Only treat the specific capacity-limit RateLimitError as a "false" return.
    // Everything else (DB errors, validation errors, etc.) is re-thrown.
    if (err instanceof RateLimitError) {
      return false;
    }
    throw err;
  }
}

/**
 * Get current active job count for org.
 *
 * P3-1 FIX: Now uses shared getValidatedJobCount helper.
 * P1-8 FIX: Uses branded OrgId type.
 */
export async function getOrgActiveJobCount(db: Database, orgId: OrgId): Promise<number> {
  const countResult = await db('job_executions')
    .where({ status: 'started' })
    .andWhere({ entity_id: orgId })["count"]();

  return getValidatedJobCount(countResult);
}
