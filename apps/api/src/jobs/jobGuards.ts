import { z } from 'zod';

import { getLogger } from '@kernel/logger';
import { RateLimitError, ErrorCodes } from '@errors';
const logger = getLogger('job-guards');

const CountResultSchema = z.object({
  count: z.union([z.string(), z.number()]),
});

// P2-3 FIX: Sentinel error class used so checkOrgCapacity can distinguish
// "at capacity" from infrastructure failures (DB timeout, pool exhaustion).
// Previously a bare catch block swallowed ALL exceptions, making a DB outage
// indistinguishable from "org is at capacity" and silently blocking all jobs.
class OrgCapacityError extends RateLimitError {
  constructor() {
    super('Org concurrency limit reached', ErrorCodes.RATE_LIMITED);
    this.name = 'OrgCapacityError';
  }
}

// P2-5 FIX: Single private helper eliminates the copy-pasted count query +
// NaN guard that existed in assertOrgCapacity and getOrgActiveJobCount.
async function queryOrgJobCount(db: Database, orgId: string): Promise<number> {
  const countResult = await db('job_executions')
    .where({ status: 'started' })
    .andWhere({ entity_id: orgId })['count']();

  if (!countResult.length) {
    throw new Error('No count result returned from job_executions query');
  }

  const result = CountResultSchema.safeParse(countResult[0]);
  if (!result.success) {
    throw new Error(`Invalid count result: ${result.error.message}`);
  }

  const raw = result.data['count'];
  const count = typeof raw === 'string' ? parseInt(raw, 10) : raw;

  if (Number.isNaN(count)) {
    throw new Error(`Invalid job count value: ${String(raw)}`);
  }

  return count;
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
 * Assert organization has capacity for new jobs.
 *
 * P2-3 FIX: Throws RateLimitError (HTTP 429) instead of plain Error (HTTP 500).
 * Plain Error bypassed Fastify's error classifier and returned 500 to callers
 * instead of the correct 429 Too Many Requests.
 */
export async function assertOrgCapacity(db: Database, orgId: string): Promise<void> {
  logger.debug('Checking org capacity', { orgId, maxActiveJobs: MAX_ACTIVE_JOBS_PER_ORG });

  const count = await queryOrgJobCount(db, orgId);

  logger.debug('Org job count', { orgId, activeJobs: count });

  if (count >= MAX_ACTIVE_JOBS_PER_ORG) {
    logger.warn('Org concurrency limit reached', {
      activeJobs: count,
      limit: MAX_ACTIVE_JOBS_PER_ORG,
    });
    throw new OrgCapacityError();
  }
}

/**
 * Check if org has capacity without throwing.
 *
 * P1-2 FIX: Previously caught ALL exceptions (including DB errors, connection
 * pool exhaustion, statement timeouts) and returned false, making a database
 * outage appear as "org is at capacity". This silently blocked all new job
 * creation during any DB blip.
 *
 * Now only OrgCapacityError → false; all other errors propagate so callers
 * can surface the real infrastructure problem.
 */
export async function checkOrgCapacity(db: Database, orgId: string): Promise<boolean> {
  try {
    await assertOrgCapacity(db, orgId);
    return true;
  } catch (err) {
    if (err instanceof OrgCapacityError) {
      return false;
    }
    // Re-throw DB errors, timeouts, pool exhaustion, etc.
    throw err;
  }
}

/**
 * Get current active job count for org.
 */
export async function getOrgActiveJobCount(db: Database, orgId: string): Promise<number> {
  return queryOrgJobCount(db, orgId);
}
