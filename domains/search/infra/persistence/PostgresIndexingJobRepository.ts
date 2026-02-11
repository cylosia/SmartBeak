


import { Pool, PoolClient } from 'pg';

import { getLogger } from '@kernel/logger';

import { IndexingJob } from '../../domain/entities/IndexingJob';
import { IndexingJobRepository } from '../../application/ports/IndexingJobRepository';

const logger = getLogger('search:indexing:repository');

/**
* Repository implementation for IndexingJob using PostgreSQL
*
* P1-FIX: Added optional PoolClient parameter for transaction support
* */
export class PostgresIndexingJobRepository implements IndexingJobRepository {
  constructor(private pool: Pool) {}

  /**
  * Helper to get queryable (pool or client)
  * P1-FIX: Support transaction participation
  */
  private getQueryable(client?: PoolClient): Pool | PoolClient {
    return client || this.pool;
  }

  /**
  * Get indexing job by ID
  * @param id - Job ID
  * @param client - Optional client for transaction context
  * @returns IndexingJob or null if not found
  */
  async getById(id: string, client?: PoolClient): Promise<IndexingJob | null> {
  // Validate input
  if (!id || typeof id !== 'string') {
    throw new Error('id must be a non-empty string');
  }
  const queryable = this.getQueryable(client);
  try {
    const { rows } = await queryable.query(
    `SELECT id, index_id, content_id, action, status, attempt_count
    FROM indexing_jobs
    WHERE id = $1`,
    [id]
    );

    if (!rows[0]) {
    return null;
    }

    const r = rows[0];
    // Use reconstitute for immutable entity creation
    return IndexingJob.reconstitute(
    r.id,
    r.index_id,
    r.content_id,
    r.action,
    r.status,
    r.attempt_count
    );
  } catch (error) {
    // P1-FIX: Type assertion with validation
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to get indexing job by ID', err, { id });
    throw error;
  }
  }

  /**
  * Save an indexing job
  * @param job - IndexingJob to save
  * @param client - Optional client for transaction context
  */
  async save(job: IndexingJob, client?: PoolClient): Promise<void> {
  // Validate input
  if (!job || typeof job.id !== 'string') {
    throw new Error('job must have a valid id');
  }
  const queryable = this.getQueryable(client);
  try {
    await queryable.query(
    `INSERT INTO indexing_jobs (id, index_id, content_id, action, status, attempt_count)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (id)
    DO UPDATE SET status = $5, attempt_count = $6`,
    [job.id, job.indexId, job.contentId, job.action, job.status, job.attemptCount]
    );
  } catch (error) {
    // P1-FIX: Type assertion with validation
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to save indexing job', err, {
    id: job.id,
    indexId: job.indexId
    });
    throw error;
  }
  }

  /**
  * List pending indexing jobs with pagination
  * @param limit - Maximum number of results
  * @param client - Optional client for transaction context
  * @returns Array of IndexingJob
  */
  async listPending(
  limit: number = 100,
  client?: PoolClient
  ): Promise<IndexingJob[]> {
  // Validate inputs
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('limit must be a positive integer');
  }
  // P0-CRITICAL FIX: Clamp limit to prevent unbounded pagination
  const MAX_LIMIT = 1000;
  const safeLimit = Math.min(Math.max(1, limit), MAX_LIMIT);

  const queryable = this.getQueryable(client);
  try {
    const { rows } = await queryable.query(
    `SELECT id, index_id, content_id, action, status, attempt_count
    FROM indexing_jobs
    WHERE status IN ('pending', 'failed')
    ORDER BY created_at ASC
    LIMIT $1`,
    [safeLimit]
    );

    return rows.map(r =>
    IndexingJob.reconstitute(
    r.id,
    r.index_id,
    r.content_id,
    r.action,
    r.status,
    r.attempt_count
    )
    );
  } catch (error) {
    // P1-FIX: Type assertion with validation
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to list pending indexing jobs', err);
    throw error;
  }
  }

  /**
  * Batch save indexing jobs for better performance
  * @param jobs - Array of IndexingJob to save
  * @param client - Optional client for transaction context
  * P1-FIX: Added client parameter to support transaction participation
  */
  async batchSave(jobs: IndexingJob[], client?: PoolClient): Promise<void> {
  if (jobs.length === 0) return;

  // Validate batch size limit
  const MAX_BATCH_SIZE = 1000;
  if (jobs.length > MAX_BATCH_SIZE) {
    throw new Error(
    `Batch size ${jobs.length} exceeds maximum allowed ${MAX_BATCH_SIZE}. ` +
    `Split into smaller batches.`
    );
  }

  // Limit chunk size for processing
  const CHUNK_SIZE = 100;
  if (jobs.length > CHUNK_SIZE) {
    for (let i = 0; i < jobs.length; i += CHUNK_SIZE) {
    await this.batchSave(jobs.slice(i, i + CHUNK_SIZE), client);
    }
    return;
  }

  // P1-FIX: Use provided client or create new connection
  const newClient = client || await this.pool.connect();
  const shouldManageTransaction = !client;

  try {
    if (shouldManageTransaction) {
    await newClient.query('BEGIN');
    }

    // Use unnest for efficient batch insert
    // P1-FIX: Update all fields on conflict
    await newClient.query(
    `INSERT INTO indexing_jobs (id, index_id, content_id, action, status, attempt_count)
    SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::int[])
    ON CONFLICT (id)
    DO UPDATE SET
    index_id = EXCLUDED.index_id,
    content_id = EXCLUDED.content_id,
    action = EXCLUDED.action,
    status = EXCLUDED.status,
    attempt_count = EXCLUDED.attempt_count,
    updated_at = now()`,
    [
    jobs.map(j => j.id),
    jobs.map(j => j.indexId),
    jobs.map(j => j.contentId),
    jobs.map(j => j.action),
    jobs.map(j => j.status),
    jobs.map(j => j.attemptCount)
    ]
    );

    if (shouldManageTransaction) {
    await newClient.query('COMMIT');
    }
  } catch (error) {
    if (shouldManageTransaction) {
    // P1-FIX: Added logging to empty catch block
    await newClient.query('ROLLBACK').catch((rollbackErr) => {
      logger.error('Rollback failed during batch save', rollbackErr instanceof Error ? rollbackErr : new Error(String(rollbackErr)));
    });
    }
    // P1-FIX: Type assertion with validation
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to batch save indexing jobs', err, { count: jobs.length });
    throw error;
  } finally {
    if (!client) {
    newClient.release();
    }
  }
  }

  /**
  * List pending jobs for batch processing
  * @param limit - Maximum number of results
  * @param client - Optional client for transaction context
  * @returns Array of IndexingJob
  */
  async listPendingBatch(limit: number, client?: PoolClient): Promise<IndexingJob[]> {
  // Validate input
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('limit must be a positive integer');
  }
  // Enforce maximum limit to prevent unbounded queries
  const MAX_LIMIT = 1000;
  const safeLimit = Math.min(limit, MAX_LIMIT);
  return this.listPending(safeLimit, client);
  }

  /**
  * Delete completed old jobs for cleanup
  * @param olderThan - Delete jobs older than this date
  * @returns Number of deleted jobs
  */
  async deleteOld(olderThan: Date): Promise<number> {
  // Validate input
  if (!(olderThan instanceof Date) || isNaN(olderThan.getTime())) {
    throw new Error('olderThan must be a valid Date');
  }
  try {
    const result = await this.pool.query(
    `DELETE FROM indexing_jobs
    WHERE created_at < $1
    AND status = 'done'`,
    [olderThan]
    );

    return result.rowCount || 0;
  } catch (error) {
    // P1-FIX: Type assertion with validation
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to delete old indexing jobs', err);
    throw error;
  }
  }

  /**
  * Count pending jobs
  * @returns Number of pending jobs
  */
  async countPending(): Promise<number> {
  try {
    const { rows } = await this.pool.query(
    `SELECT COUNT(*) as count
    FROM indexing_jobs
    WHERE status IN ('pending', 'failed')`
    );

    return parseInt(rows[0]?.count || '0', 10);
  } catch (error) {
    // P1-FIX: Type assertion with validation
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to count pending indexing jobs', err);
    throw error;
  }
  }
}
