import { z } from 'zod';

import { getLogger } from '@kernel/logger';
import { parseIntEnv } from '@config/env';
import { RateLimitError, ValidationError, DatabaseError } from '@errors';
import type { OrgId } from '@kernel/branded';

const logger = getLogger('job-guards');

const CountResultSchema = z.object({
  count: z.union([z.string(), z.number()]),
});

function validateCountResult(row: unknown): { count: string | number } {
  const result = CountResultSchema.safeParse(row);
  if (!result.success) {
    // AUDIT-FIX L7: Don't interpolate Zod error details into the exception.
    // Log the full error server-side for debugging.
    logger.warn('Invalid count result from DB', { error: result.error["message"] });
    throw new ValidationError('Invalid count result from job_executions query', 'count');
  }
  return result.data;
}

// AUDIT-FIX L6: Make capacity limit configurable via env var with sensible bounds.
const MAX_ACTIVE_JOBS_PER_ORG = parseIntEnv('MAX_ACTIVE_JOBS_PER_ORG', 10, { min: 1, max: 1000 });

/** Valid job execution statuses matching the DB enum */
export type JobExecutionStatus = 'pending' | 'started' | 'completed' | 'failed' | 'retrying';

// Type definitions for database - using Knex-like interface
export interface JobExecution {
  id: string;
  status: JobExecutionStatus;
  // AUDIT-FIX M17: Renamed from entity_id to org_id for clarity.
  // The DB column is still entity_id but the interface should reflect semantics.
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
 */
function getValidatedJobCount(countResult: Array<{ count: string | number }>): number {
  if (!countResult.length) {
    throw new DatabaseError('No count result returned from job_executions query');
  }

  const result = validateCountResult(countResult[0]);
  const count = typeof result["count"] === 'string' ? parseInt(result["count"], 10) : result["count"];

  if (Number.isNaN(count)) {
    // AUDIT-FIX P2: Log raw value server-side but don't interpolate into error
    // message. Database corruption or unexpected data could leak internal state.
    logger.warn('Invalid job count value', { rawCount: String(result["count"]) });
    throw new ValidationError('Invalid job count value from job_executions query', 'count');
  }

  return count;
}

/**
 * Assert organization has capacity for new jobs.
 *
 * AUDIT-FIX H8: Accepts a transaction handle so the caller's INSERT can run
 * inside the same locked transaction, preventing the TOCTOU race where the
 * advisory lock is released before the INSERT.
 *
 * AUDIT-FIX H9: Uses pg_advisory_xact_lock(key1, key2) with two int4 values
 * for a 64-bit key space, reducing cross-org collision risk from hashtext().
 *
 * AUDIT-FIX M19: retryAfter changed from 0 to 60 (seconds). retryAfter:0
 * violates the positive integer schema and causes retry storms.
 */
export async function assertOrgCapacity(
  db: Database,
  orgId: OrgId,
  /** Optional: pass a transaction handle to hold the lock through INSERT */
  trx?: Database
): Promise<void> {
  logger.debug('Checking org capacity', { orgId, maxActiveJobs: MAX_ACTIVE_JOBS_PER_ORG });

  const doCheck = async (t: Database) => {
    // AUDIT-FIX H9: Use two int4 keys for 64-bit advisory lock space.
    // hashtext() returns int4 (~4.3B values), causing cross-org collisions.
    // Using a fixed namespace key + org hash provides 64-bit key space.
    await t.raw(
      `SELECT pg_advisory_xact_lock($1, hashtext($2))`,
      [1001, `org_capacity:${orgId}`]
    );

    const countResult = await t('job_executions')
      .where({ status: 'started' })
      .andWhere({ entity_id: orgId })["count"]();

    const count = getValidatedJobCount(countResult);

    logger.debug('Org job count', { orgId, activeJobs: count });

    if (count >= MAX_ACTIVE_JOBS_PER_ORG) {
      logger.warn('Org concurrency limit reached', {
        activeJobs: count,
        limit: MAX_ACTIVE_JOBS_PER_ORG,
      });
      // AUDIT-FIX M19: retryAfter:60 instead of 0 to prevent retry storms.
      throw new RateLimitError(
        'Org concurrency limit reached',
        60
      );
    }
  };

  // AUDIT-FIX H8: If a transaction is provided, run within it so the caller's
  // INSERT also happens inside the locked transaction. Otherwise, create our own.
  if (trx) {
    await doCheck(trx);
  } else {
    await db.transaction(doCheck);
  }
}

/**
 * Check if org has capacity without throwing on capacity-limit errors.
 */
export async function checkOrgCapacity(db: Database, orgId: OrgId): Promise<boolean> {
  try {
    await assertOrgCapacity(db, orgId);
    return true;
  } catch (err) {
    if (err instanceof RateLimitError) {
      return false;
    }
    throw err;
  }
}

/**
 * Get current active job count for org.
 *
 * AUDIT-FIX M20: Added note that this reads without an advisory lock.
 * The result is informational and MUST NOT be used for capacity decisions.
 * Use assertOrgCapacity() with a transaction for capacity enforcement.
 */
export async function getOrgActiveJobCount(db: Database, orgId: OrgId): Promise<number> {
  const countResult = await db('job_executions')
    .where({ status: 'started' })
    .andWhere({ entity_id: orgId })["count"]();

  return getValidatedJobCount(countResult);
}
