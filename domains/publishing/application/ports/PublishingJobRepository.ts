import { PoolClient } from 'pg';

import { PublishingJob } from '../../domain/entities/PublishingJob';

﻿


/**
* Repository interface for PublishingJob persistence.
*

* This allows repositories to participate in parent transactions by passing a PoolClient.
*
* @throws {RepositoryError} Implementations should throw domain-appropriate errors
*/
export interface PublishingJobRepository {
  /**
  * Retrieve a publishing job by its unique ID
  *
  * @param id - The unique identifier of the publishing job
  * @param client - Optional database client for transaction context
  * @returns Promise resolving to the publishing job, or null if not found
  * @throws {Error} If database connection fails or other infrastructure error occurs
  */
  getById(id: string, client?: PoolClient): Promise<PublishingJob | null>;

  /**
  * Save or update a publishing job
  *
  * @param job - The publishing job to persist
  * @param client - Optional database client for transaction context
  * @returns Promise resolving when save is complete
  * @throws {Error} If persistence operation fails
  */
  save(job: PublishingJob, client?: PoolClient): Promise<void>;

  /**
  * List all pending publishing jobs
  *
  * @param limit - Maximum number of jobs to return (default: 100, max: 1000)
  * @param client - Optional database client for transaction context
  * @returns Promise resolving to array of pending publishing jobs
  * @throws {Error} If query execution fails
  */
  listPending(limit?: number, client?: PoolClient): Promise<PublishingJob[]>;

  /**
  * List publishing jobs by domain
  *
  * @param domainId - The domain/tenant identifier
  * @param limit - Maximum number of jobs to return (default: 100, max: 1000)
  * @param client - Optional database client for transaction context
  * @returns Promise resolving to array of publishing jobs
  * @throws {Error} If query execution fails
  */
  listByDomain(domainId: string, limit?: number, client?: PoolClient): Promise<PublishingJob[]>;

  /**
  * Delete a publishing job
  *
  * @param id - The unique identifier of the publishing job to delete
  * @param client - Optional database client for transaction context
  * @returns Promise resolving when deletion is complete
  * @throws {Error} If deletion fails
  */
  delete(id: string, client?: PoolClient): Promise<void>;

  /**
  * Batch save multiple publishing jobs
  *
  * @param jobs - Array of publishing jobs to save
  * @param client - Optional database client for transaction context
  * @returns Promise resolving to batch operation result
  * @throws {Error} If persistence operation fails
  */
  batchSave?(jobs: PublishingJob[], client?: PoolClient): Promise<{ saved: number; failed: number; errors: string[] }>;
}

/**
* Custom error class for repository operations
*/
export class PublishingJobError extends Error {
  constructor(
  message: string,
  public readonly code: string,
  override readonly cause?: unknown
  ) {
  super(message);
  this["name"] = 'PublishingJobError';
  }
}
