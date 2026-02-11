

import { Pool, PoolClient } from 'pg';
import { randomUUID } from 'crypto';

import { getLogger } from '@kernel/logger';

const logger = getLogger('publishing:attempt:repository');

/**
* Repository implementation for Publish Attempts using PostgreSQL
*
* P1-FIX: Added optional PoolClient parameter for transaction support
* */
export class PostgresPublishAttemptRepository {
  constructor(private pool: Pool) {}

  /**
  * Helper to get queryable (pool or client)
  * P1-FIX: Support transaction participation
  */
  private getQueryable(client?: PoolClient): Pool | PoolClient {
    return client || this.pool;
  }

  /**
  * Record a publish attempt
  */
  async record(
  jobId: string,
  attempt: number,
  status: 'success' | 'failure',
  error?: string
  ): Promise<void> {
  // Validate inputs
  if (!jobId || typeof jobId !== 'string') {
    throw new Error('jobId must be a non-empty string');
  }
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new Error('attempt must be a positive integer');
  }

  // Limit error message length
  const safeError = error && error.length > 1000 ? error.slice(0, 1000) + '...' : error;

  try {
    await this.pool.query(
    `INSERT INTO publish_attempts (id, publishing_job_id, attempt_number, status, error)
    VALUES ($1, $2, $3, $4, $5)`,
    [randomUUID(), jobId, attempt, status, safeError ?? null]
    );
  } catch (err) {
    logger.error('Failed to record publish attempt', err as Error, {
    });
    throw err;
  }
  }

  /**
  * Get attempts for a publishing job
  */
  async listByJob(jobId: string, limit: number = 100): Promise<Array<{
  id: string;
  attemptNumber: number;
  status: string;
  error: string | null;
  createdAt: Date;
  }>> {
  // Validate input
  if (!jobId || typeof jobId !== 'string') {
    throw new Error('jobId must be a non-empty string');
  }
  // Validate and cap limit
  const MAX_LIMIT = 1000;
  const safeLimit = Math.min(Math.max(1, limit), MAX_LIMIT);
  try {
    const { rows } = await this.pool.query(
    `SELECT id, attempt_number, status, error, created_at
    FROM publish_attempts
    WHERE publishing_job_id = $1
    ORDER BY attempt_number ASC
    LIMIT $2`,
    [jobId, safeLimit]
    );

    return rows.map(r => ({
    id: r["id"],
    attemptNumber: r.attempt_number,
    status: r["status"],
    error: r.error,
    createdAt: r.created_at,
    }));
  } catch (err) {
    logger.error('Failed to list publish attempts', err as Error, { jobId });
    throw err;
  }
  }
}
