import { PoolClient } from 'pg';

import { IndexingJob } from '../../domain/entities/IndexingJob';

﻿


/**
* Repository interface for IndexingJob persistence.
*
* This interface manages the persistence of search indexing jobs,
* which track the status of content that needs to be indexed or removed
* from the search index. Implementations should support job queue semantics
* for efficient processing.
*
* P1-FIX: All methods accept optional client parameter for transaction support
*/
export interface IndexingJobRepository {
  /**
  * Retrieve an indexing job by its unique ID
  *
  * @param id - The unique identifier of the indexing job
  * @param client - Optional database client for transaction participation
  * @returns Promise resolving to the indexing job, or null if not found
  * @throws {IndexingRepositoryError} If database query fails
  *
  * @example
  * ```typescript
  * const job = await repo.getById('job-123');
  * if (job) {
  *   job.start();
  *   await repo.save(job);
  * }
  * ```
  */
  getById(id: string, client?: PoolClient): Promise<IndexingJob | null>;

  /**
  * Retrieve multiple indexing jobs by their IDs (batch operation)
  * P1-FIX: Added for efficient batch processing
  *
  * @param ids - Array of job IDs to fetch
  * @param client - Optional database client for transaction participation
  * @returns Promise resolving to array of indexing jobs (may be fewer than requested if some don't exist)
  * @throws {IndexingRepositoryError} If database query fails
  */
  getByIds?(ids: string[], client?: PoolClient): Promise<IndexingJob[]>;

  /**
  * Save or update an indexing job
  *
  * @param job - The indexing job to persist
  * @param client - Optional database client for transaction participation
  * @returns Promise resolving when save is complete
  * @throws {IndexingRepositoryError} If persistence operation fails
  *
  * @example
  * ```typescript
  * const job = new IndexingJob('job-1', 'index-1', 'content-1', 'index', 'pending');
  * await repo.save(job);
  * ```
  */
  save(job: IndexingJob, client?: PoolClient): Promise<void>;

  /**
  * Save multiple indexing jobs in a batch
  * P1-FIX: Added for efficient batch processing
  *
  * @param jobs - Array of indexing jobs to persist
  * @param client - Optional database client for transaction participation
  * @returns Promise resolving when save is complete
  * @throws {IndexingRepositoryError} If persistence operation fails
  */
  saveBatch?(jobs: IndexingJob[], client?: PoolClient): Promise<void>;

  /**
  * Update status of multiple jobs by ID (batch operation)
  * P1-FIX: Added for efficient batch status updates
  *
  * @param jobIds - Array of job IDs to update
  * @param status - New status to set
  * @param client - Optional database client for transaction participation
  * @returns Promise resolving when update is complete
  */
  updateStatusBatch?(jobIds: string[], status: string, client?: PoolClient): Promise<void>;

  /**
  * List all pending indexing jobs, ordered by priority/creation time
  *
  * This method is typically used by workers to fetch jobs for processing.
  *
  * @param limit - Maximum number of jobs to return (default: 100, max: 1000)
  * @param client - Optional database client for transaction participation
  * @returns Promise resolving to array of pending indexing jobs
  * @throws {IndexingRepositoryError} If query execution fails
  *
  * @example
  * ```typescript
  * const pendingJobs = await repo.listPending();
  * for (const job of pendingJobs) {
  *   await processJob(job);
  * }
  * ```
  */
  listPending(limit?: number, client?: PoolClient): Promise<IndexingJob[]>;

  /**
  * List pending jobs with a limit (for batch processing)
  *
  * @param limit - Maximum number of jobs to return
  * @param client - Optional database client for transaction participation
  * @returns Promise resolving to array of pending indexing jobs
  * @throws {IndexingRepositoryError} If query execution fails
  */
  listPendingBatch?(limit: number, client?: PoolClient): Promise<IndexingJob[]>;

  /**
  * Batch save indexing jobs for better performance
  * P1-FIX: Added for efficient batch processing with transaction support
  *
  * @param jobs - Array of indexing jobs to save
  * @param client - Optional database client for transaction participation
  * @returns Promise resolving when save is complete
  * @throws {IndexingRepositoryError} If persistence operation fails
  */
  batchSave?(jobs: IndexingJob[], client?: PoolClient): Promise<void>;
}

/**
* Options for querying indexing jobs
*/
export interface ListIndexingJobsOptions {
  /** Filter by job status */
  status?: 'pending' | 'processing' | 'done' | 'failed';
  /** Filter by action type */
  action?: 'index' | 'delete';
  /** Maximum number of jobs to return */
  limit?: number;
  /** Number of jobs to skip (for pagination) */
  offset?: number;
  /** Filter by content ID */
  contentId?: string;
}

/**
* Custom error class for indexing job repository operations
*/
export class IndexingRepositoryError extends Error {
  constructor(
  message: string,
  public readonly operation: 'get' | 'save' | 'list' | 'delete' | 'batch',
  public readonly jobId?: string,
  override readonly cause?: unknown
  ) {
  super(message);
  this["name"] = 'IndexingRepositoryError';
  }

  /**
  * Checks if the error is a 'not found' error
  */
  isNotFound(): boolean {
  return this.message.includes('not found') || this.cause instanceof Error &&
    this.cause.message.includes('not found');
  }

  /**
  * Checks if the error is a connection/timeout error
  */
  isTransient(): boolean {
  const transientErrors = ['timeout', 'connection', 'unavailable', 'retry'];
  const errorMessage = this.message.toLowerCase();
  return transientErrors.some(pattern => errorMessage.includes(pattern));
  }
}

/**
* Statistics for indexing job repository
*/
export interface IndexingJobStats {
  /** Number of pending jobs */
  pending: number;
  /** Number of jobs currently being processed */
  processing: number;
  /** Number of successfully completed jobs */
  done: number;
  /** Number of failed jobs */
  failed: number;
}
