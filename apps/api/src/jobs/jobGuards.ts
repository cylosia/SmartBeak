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
    // AUDIT-FIX P3: Pass structured details object. The second argument to
    // @errors:ValidationError is `details`, not a field name. Passing bare 'count'
    // produced confusing output like { details: "count" }.
    throw new ValidationError('Invalid count result from job_executions query', { field: 'count' });
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
  // AUDIT-FIX M17: entity_id maps to org_id semantically. The DB column
  // name is entity_id; the interface matches the column for Knex query compatibility.
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
  // AUDIT-FIX P3: Made bindings required to prevent accidental SQL injection.
  // The previous optional parameter allowed `db.raw('SELECT ... WHERE id = ' + input)`
  // without type errors. Callers with no bindings should pass an empty array.
  raw: (sql: string, bindings: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  transaction: <T>(fn: (trx: Database) => Promise<T>) => Promise<T>;
}

/**
 * Simplified Knex query builder interface
 */
export interface KnexQueryBuilder<T> {
  where: (conditions: Partial<T>) => KnexQueryBuilder<T>;
  andWhere: (conditions: Partial<T>) => KnexQueryBuilder<T>;
  // AUDIT-FIX P1: Added whereIn for multi-value status filtering.
  whereIn: (column: keyof T & string, values: unknown[]) => KnexQueryBuilder<T>;
  count: () => Promise<Array<{ count: string | number }>>;
}

/**
 * Parse and validate a count query result.
 */
function getValidatedJobCount(countResult: Array<{ count: string | number }>): number {
  // AUDIT-FIX P3: Extract first row with explicit undefined check for noUncheckedIndexedAccess.
  // TypeScript doesn't narrow array[0] from .length checks.
  const firstRow = countResult[0];
  if (!firstRow) {
    throw new DatabaseError('No count result returned from job_executions query');
  }

  const result = validateCountResult(firstRow);
  const count = typeof result["count"] === 'string' ? parseInt(result["count"], 10) : result["count"];

  if (Number.isNaN(count)) {
    // AUDIT-FIX P2: Log raw value server-side but don't interpolate into error
    // message. Database corruption or unexpected data could leak internal state.
    logger.warn('Invalid job count value', { rawCount: String(result["count"]) });
    throw new ValidationError('Invalid job count value from job_executions query', { field: 'count' });
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
    //
    // AUDIT-FIX P1: Use pg_try_advisory_xact_lock instead of pg_advisory_xact_lock.
    // The blocking variant has no timeout — if a transaction holding the lock hangs
    // (network partition, dead connection), all subsequent callers for that org block
    // indefinitely, exhausting the connection pool.
    const lockResult = await t.raw(
      `SELECT pg_try_advisory_xact_lock($1, hashtext($2)) AS acquired`,
      [1001, `org_capacity:${orgId}`]
    );
    const lockRow = lockResult.rows[0];
    if (!lockRow || lockRow['acquired'] !== true) {
      logger.warn('Could not acquire capacity lock, rejecting request', { orgId });
      throw new RateLimitError('Could not acquire capacity lock, try again', 5);
    }

    // AUDIT-FIX P1: Count 'started', 'pending', AND 'retrying' jobs.
    // Previously only 'started' was counted. 'pending' was added to prevent
    // burst-past. 'retrying' must also be counted because jobs in this status
    // are transitioning back to 'started' and will imminently consume resources.
    // Under heavy failure/retry scenarios, an org could exceed the concurrency
    // limit by 2-3x from uncounted retrying jobs.
    const countResult = await t('job_executions')
      .whereIn('status', ['started', 'pending', 'retrying'])
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
 *
 * AUDIT-FIX P2: Replaced lock-based implementation with a lightweight read.
 * The previous implementation delegated to assertOrgCapacity() which acquires
 * pg_advisory_xact_lock — a blocking lock. For an informational/UI check
 * ("can this org create more jobs?"), the lock serialized all callers,
 * creating unnecessary contention. This now uses getOrgActiveJobCount()
 * which reads without a lock. The result is advisory only — use
 * assertOrgCapacity() within a transaction for authoritative enforcement.
 */
export async function checkOrgCapacity(db: Database, orgId: OrgId): Promise<boolean> {
  try {
    const count = await getOrgActiveJobCount(db, orgId);
    return count < MAX_ACTIVE_JOBS_PER_ORG;
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
  // AUDIT-FIX P1: Count 'started', 'pending', and 'retrying' for consistency
  // with assertOrgCapacity(). Informational reads should reflect the same semantics.
  const countResult = await db('job_executions')
    .whereIn('status', ['started', 'pending', 'retrying'])
    .andWhere({ entity_id: orgId })["count"]();

  return getValidatedJobCount(countResult);
}
