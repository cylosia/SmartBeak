import crypto from 'crypto';
import { Pool } from 'pg';

import { getLogger } from '@kernel/logger';

import { IndexingJob } from '../domain/entities/IndexingJob';
import { IndexingJobRepository } from './ports/IndexingJobRepository';
import { SearchIndexRepository } from './ports/SearchIndexRepository';

const logger = getLogger('search:indexing:service');

// ============================================================================
// Type Definitions
// ============================================================================

/**
* Result type for enqueue operations
*/
export interface EnqueueResult {
  /** Whether operation succeeded */
  success: boolean;
  /** Created indexing job */
  job?: IndexingJob;
  /** Error message (if failed) */
  error?: string;
}

// ============================================================================
// Search Indexing Service
// ============================================================================

/**
* Service for managing search indexing operations.
*
* This service provides high-level operations for enqueueing content
* to be indexed or deleted from the search index.
*/
export class SearchIndexingService {
  /**
  * Create a new SearchIndexingService
  * @param jobs - Job repository
  * @param indexes - Search index repository
  * @param pool - Database connection pool
  */
  constructor(
  private readonly jobs: IndexingJobRepository,
  private readonly indexes: SearchIndexRepository,
  private readonly pool: Pool
  ) {}

  /**
  * Enqueue a content item for indexing
  *
  * @param domainId - Domain ID
  * @param contentId - Content ID to index
  * @returns Promise resolving to the result of the operation
  *
  * @example
  * ```typescript
  * const result = await service.enqueueIndex('domain-123', 'content-456');
  * if (result.success) {
  *   // Indexing job created successfully
  * }
  * ```
  */
  async enqueueIndex(domainId: string, contentId: string): Promise<EnqueueResult> {
  // Validate inputs
  const validationError = this.validateInputs(domainId, contentId);
  if (validationError) {
    return { success: false, error: validationError };
  }

  const client = await this.pool.connect();

  try {
    await client.query('BEGIN');

    // P0-FIX: Move repository calls inside transaction for consistency
    const index = await this.indexes.getActive(domainId, client);

    // Handle case where no active index exists
    if (!index) {
    await client.query('ROLLBACK');
    return {
    success: false,
    error: `No active search index found for domain '${domainId}'`
    };
    }

    const job = IndexingJob.create(
    crypto.randomUUID(),
    index.id,
    contentId,
    'index',
    'pending',
    0
    );

    // P0-FIX: Pass client to save for transactional consistency
    await this.jobs.save(job, client);

    await client.query('COMMIT');

    return { success: true, job };
  } catch (error) {
    try {
    await client.query('ROLLBACK');
    } catch (rollbackError) {
    logger.error(`Rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
    }
    const errorMessage = error instanceof Error ? error.message : 'Failed to enqueue index job';
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to enqueue index', err, { domainId, contentId });
    return {
    success: false,
    error: errorMessage
    };
  } finally {
    client.release();
  }
  }

  /**
  * Enqueue a content item for deletion from index
  *
  * @param domainId - Domain ID
  * @param contentId - Content ID to delete from index
  * @returns Promise resolving to the result of the operation
  *
  * @example
  * ```typescript
  * const result = await service.enqueueDelete('domain-123', 'content-456');
  * if (result.success) {
  *   console.log('Delete job created:', result.job?.id);
  * }
  * ```
  */
  async enqueueDelete(domainId: string, contentId: string): Promise<EnqueueResult> {
  // Validate inputs
  const validationError = this.validateInputs(domainId, contentId);
  if (validationError) {
    return { success: false, error: validationError };
  }

  const client = await this.pool.connect();

  try {
    await client.query('BEGIN');

    // P0-FIX: Move repository calls inside transaction for consistency
    const index = await this.indexes.getActive(domainId, client);

    // Handle case where no active index exists
    if (!index) {
    await client.query('ROLLBACK');
    return {
    success: false,
    error: `No active search index found for domain '${domainId}'`
    };
    }

    const job = IndexingJob.create(
    crypto.randomUUID(),
    index.id,
    contentId,
    'delete',
    'pending',
    0
    );

    // P0-FIX: Pass client to save for transactional consistency
    await this.jobs.save(job, client);

    await client.query('COMMIT');

    return { success: true, job };
  } catch (error) {
    try {
    await client.query('ROLLBACK');
    } catch (rollbackError) {
    logger.error(`Rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
    }
    const errorMessage = error instanceof Error ? error.message : 'Failed to enqueue delete job';
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to enqueue delete', err, { domainId, contentId });
    return {
    success: false,
    error: errorMessage
    };
  } finally {
    client.release();
  }
  }

  // ============================================================================
  // Validation
  // ============================================================================

  /**
  * Validates input parameters
  * @param domainId - Domain ID
  * @param contentId - Content ID
  * @returns Error message if invalid, undefined if valid
  */
  private validateInputs(domainId: string, contentId: string): string | undefined {
  if (!domainId || typeof domainId !== 'string') {
    return 'Domain ID is required and must be a string';
  }
  if (domainId.length < 1 || domainId.length > 255) {
    return 'Domain ID must be between 1 and 255 characters';
  }

  if (!contentId || typeof contentId !== 'string') {
    return 'Content ID is required and must be a string';
  }
  if (contentId.length < 1 || contentId.length > 255) {
    return 'Content ID must be between 1 and 255 characters';
  }

  return undefined;
  }
}
