


import { Pool, PoolClient } from 'pg';

import { getLogger } from '@kernel/logger';

import { PublishingJob, PublishingJobState, PublishingStatus } from '../../domain/entities/PublishingJob';
import { PublishingJobRepository } from '../../application/ports/PublishingJobRepository';

const logger = getLogger('publishing:job:repository');

// Valid statuses for runtime validation
const VALID_STATUSES: PublishingStatus[] = ['pending', 'publishing', 'published', 'failed'];

/**
* Validate status at runtime to prevent corrupted data from creating invalid entities
*/
function validateStatus(status: string): PublishingStatus {
  if (!VALID_STATUSES.includes(status as PublishingStatus)) {
  throw new Error(
    `Invalid publishing status in database: '${status}'. ` +
    `Expected one of: ${VALID_STATUSES.join(', ')}`
  );
  }
  return status as PublishingStatus;
}

// Database row type for PublishingJob
export interface PublishingJobRow {
  id: string;
  domain_id: string;
  content_id: string;
  target_id: string;
  status: string;
  error_message?: string | null;
  started_at?: Date | null;
  completed_at?: Date | null;
  attempt_count?: number | null;
}

/**
* Map database row to PublishingJob
*/
function mapRowToPublishingJob(row: PublishingJobRow | null | undefined): PublishingJob | null {
  if (!row) return null;

  try {
  const state: PublishingJobState = {
    id: row["id"],
    domainId: row.domain_id,
    contentId: row.content_id,
    targetId: row.target_id,
    status: validateStatus(row["status"]),
    errorMessage: row.error_message ?? undefined,
    startedAt: row.started_at ? new Date(row.started_at) : undefined,
    completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
    attemptCount: row.attempt_count ?? 0,
  };

  return PublishingJob.reconstitute(state);
  } catch (error: unknown) {
  const errorObj = error instanceof Error ? error : new Error(String(error));
  logger.error('Failed to map row to PublishingJob', errorObj, { rowId: row["id"] });
  return null;
  }
}

/**
* Repository implementation for PublishingJob using PostgreSQL
*
* All methods accept optional client parameter for transaction support
* P0-FIX: Proper transaction boundaries with BEGIN/COMMIT/ROLLBACK
*
* */
export class PostgresPublishingJobRepository implements PublishingJobRepository {
  constructor(private pool: Pool) {}

  /**
  * Helper to get queryable (pool or client)
  */
  private getQueryable(client?: PoolClient): Pool | PoolClient {
  return client || this.pool;
  }

  /**
  * Execute within transaction boundary
  * P0-FIX: Proper transaction wrapper with BEGIN/COMMIT/ROLLBACK
  */
  async withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
    await client.query('BEGIN');
    await client.query('SET LOCAL statement_timeout = $1', [30000]); // 30 seconds
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
    } catch (error) {
    try {
        await client.query('ROLLBACK');
    } catch (rollbackError) {
        const rollbackErr = rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
        logger.error('Rollback failed', rollbackErr);
    }
    throw error;
    } finally {
    client.release();
    }
  }

  /**
  * Get publishing job by ID
  * P0-5 FIX: Added forUpdate option for SELECT FOR UPDATE within transactions
  */
  async getById(id: string, client?: PoolClient, options?: { forUpdate?: boolean }): Promise<PublishingJob | null> {
  try {
    const queryable = this.getQueryable(client);
    const forUpdate = options?.forUpdate && client ? ' FOR UPDATE' : '';
    const { rows } = await queryable.query(
    `SELECT
    id, domain_id, content_id, target_id, status,
    error_message, started_at, completed_at, attempt_count
    FROM publishing_jobs
    WHERE id = $1${forUpdate}`,
    [id]
    );

    return mapRowToPublishingJob(rows[0]);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to get publishing job by ID', err, { id });
    throw error;
  }
  }

  /**
  * Save publishing job

  */
  async save(job: PublishingJob, client?: PoolClient): Promise<void> {
  try {
    const queryable = this.getQueryable(client);
    const state = job.toState();

    await queryable.query(
    `INSERT INTO publishing_jobs (
    id, domain_id, content_id, target_id, status,
    error_message, started_at, completed_at, attempt_count
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (id) DO UPDATE SET
    status = EXCLUDED.status,
    error_message = EXCLUDED.error_message,
    started_at = EXCLUDED.started_at,
    completed_at = EXCLUDED.completed_at,
    attempt_count = EXCLUDED.attempt_count`,
    [
    state["id"],
    state.domainId,
    state.contentId,
    state.targetId,
    state["status"],
    state.errorMessage ?? null,
    state.startedAt ?? null,
    state.completedAt ?? null,
    state.attemptCount,
    ]
    );
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to save publishing job', err, {
    id: job.toState()["id"]
    });
    throw error;
  }
  }

  /**
  * List pending publishing jobs

  */
  async listPending(limit = 100, client?: PoolClient): Promise<PublishingJob[]> {
  // P1-FIX: Enforce that a transaction client is provided when using
  // FOR UPDATE SKIP LOCKED. Without a transaction, PostgreSQL releases the row
  // locks immediately after the query completes, before the caller has had a chance
  // to process the rows. This defeats the purpose of the lock and allows multiple
  // workers to fetch and process the same jobs concurrently, causing duplicate
  // publishes to external targets.
  if (!client) {
    throw new Error(
      'listPending() requires a transaction client. ' +
      'Open a transaction via pool.connect() + BEGIN and pass the client here.'
    );
  }

  const MAX_LIMIT = 1000;
  const safeLimit = Math.min(Math.max(1, limit), MAX_LIMIT);

  try {
    const queryable = this.getQueryable(client);
    // FOR UPDATE SKIP LOCKED prevents multiple workers from claiming the same rows.
    const { rows } = await queryable.query(
    `SELECT
    id, domain_id, content_id, target_id, status,
    error_message, started_at, completed_at, attempt_count
    FROM publishing_jobs
    WHERE status IN ('pending', 'failed')
    ORDER BY attempt_count ASC, id ASC
    LIMIT $1
    FOR UPDATE SKIP LOCKED`,
    [safeLimit]
    );

    return rows
    .map(mapRowToPublishingJob)
    .filter((job): job is PublishingJob => job !== null);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to list pending publishing jobs', err);
    throw error;
  }
  }

  /**
  * List publishing jobs by domain

  */
  async listByDomain(domainId: string, limit: number = 100, client?: PoolClient): Promise<PublishingJob[]> {
  // Validate inputs
  if (!domainId || typeof domainId !== 'string') {
    throw new Error('domainId must be a non-empty string');
  }
  const MAX_LIMIT = 1000;
  const safeLimit = Math.min(Math.max(1, limit), MAX_LIMIT);

  try {
    const queryable = this.getQueryable(client);
    const { rows } = await queryable.query(
    `SELECT
    id, domain_id, content_id, target_id, status,
    error_message, started_at, completed_at, attempt_count
    FROM publishing_jobs
    WHERE domain_id = $1
    ORDER BY started_at DESC NULLS LAST, id DESC
    LIMIT $2`,
    [domainId, safeLimit]
    );

    // Filter nulls with proper type guard
    const jobs = rows
    .map(mapRowToPublishingJob)
    .filter((job): job is PublishingJob => job !== null);
    return jobs;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to list publishing jobs by domain', err, { domainId });
    throw error;
  }
  }

  /**
  * Delete publishing job

  */
  async delete(id: string, client?: PoolClient): Promise<void> {
  // Validate input
  if (!id || typeof id !== 'string') {
    throw new Error('id must be a non-empty string');
  }
  try {
    const queryable = this.getQueryable(client);
    await queryable.query(
    'DELETE FROM publishing_jobs WHERE id = $1',
    [id]
    );
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to delete publishing job', err, { id });
    throw error;
  }
  }

  /**
  * Batch save publishing jobs using UNNEST pattern
  * for efficient bulk insert/update with proper error handling
  * P0-FIX: Proper transaction boundaries with automatic rollback

  * @param jobs - Array of PublishingJob to save
  * @param client - Optional client for transaction context
  * @returns Promise resolving to batch operation result
  */
  async batchSave(
  jobs: PublishingJob[],
  client?: PoolClient
  ): Promise<{ saved: number; failed: number; errors: string[] }> {
  if (jobs.length === 0) {
    return { saved: 0, failed: 0, errors: [] };
  }

  // Validate batch size limit
  const MAX_BATCH_SIZE = 1000;
  if (jobs.length > MAX_BATCH_SIZE) {
    return {
    saved: 0,
    failed: jobs.length,
    errors: [`Batch size ${jobs.length} exceeds maximum allowed ${MAX_BATCH_SIZE}. Split into smaller batches.`]
    };
  }

  if (client) {
    return this.executeBatchSave(jobs, client);
  }

  // P0-FIX: Proper transaction boundary with explicit ROLLBACK
  const newClient = await this.pool.connect();
  try {
    await newClient.query('BEGIN');
    await newClient.query('SET LOCAL statement_timeout = $1', [60000]); // 60 seconds for batch
    const result = await this.executeBatchSave(jobs, newClient);
    await newClient.query('COMMIT');
    return result;
  } catch (error) {
    try {
    await newClient.query('ROLLBACK');
    } catch (rollbackError) {
    logger.error('Batch save rollback failed', rollbackError as Error);
    }
    throw error;
  } finally {
    newClient.release();
  }
  }

  /**
  * Internal batch save execution
  */
  private async executeBatchSave(
  jobs: PublishingJob[],
  client: PoolClient
  ): Promise<{ saved: number; failed: number; errors: string[] }> {
  try {
    // Use UNNEST pattern for efficient batch insert
    const states = jobs.map(j => j.toState());

    await client.query(
    `INSERT INTO publishing_jobs (
    id, domain_id, content_id, target_id, status,
    error_message, started_at, completed_at, attempt_count
    )
    SELECT * FROM UNNEST(
    $1::text[], $2::text[], $3::text[], $4::text[], $5::text[],
    $6::text[], $7::timestamptz[], $8::timestamptz[], $9::int[]
    )
    ON CONFLICT (id) DO UPDATE SET
    status = EXCLUDED.status,
    error_message = EXCLUDED.error_message,
    started_at = EXCLUDED.started_at,
    completed_at = EXCLUDED.completed_at,
    attempt_count = EXCLUDED.attempt_count`,
    [
    states.map(s => s["id"]),
    states.map(s => s.domainId),
    states.map(s => s.contentId),
    states.map(s => s.targetId),
    states.map(s => s["status"]),
    states.map(s => s.errorMessage ?? null),
    states.map(s => s.startedAt ?? null),
    states.map(s => s.completedAt ?? null),
    states.map(s => s.attemptCount),
    ]
    );

    return { saved: jobs.length, failed: 0, errors: [] };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to batch save publishing jobs', err, { count: jobs.length });
    return { saved: 0, failed: jobs.length, errors: [errorMessage] };
  }
  }
}
