


import crypto from 'crypto';
import { Pool } from 'pg';

import { getLogger } from '@kernel/logger';
import { withSpan, addSpanAttributes } from '@packages/monitoring';

import { PublishingJob } from '../domain/entities/PublishingJob';
import { PublishingJobRepository } from './ports/PublishingJobRepository';
import { PublishTargetRepository } from './ports/PublishTargetRepository';

const logger = getLogger('publishing:service');

// ============================================================================
// Type Definitions
// ============================================================================

/**
* Result type for publishing operations
*/
export interface PublishingResult {
  /** Whether operation succeeded */
  success: boolean;
  /** Publishing job (if created) */
  job?: PublishingJob;
  /** Error message (if failed) */
  error?: string;
}

// ============================================================================
// Publishing Service
// ============================================================================

/**
* Service for managing publishing operations.
*
* This service provides high-level operations for creating and managing
* publishing jobs with proper validation and error handling.
*/
export class PublishingService {
  /**
  * Create a new PublishingService
  * @param jobs - Job repository
  * @param targets - Target repository
  * @param pool - Database connection pool
  */
  constructor(
  private readonly jobs: PublishingJobRepository,
  private readonly targets: PublishTargetRepository,
  private readonly pool: Pool
  ) {}

  /**
  * Create a new publishing job
  *
  * @param domainId - Domain ID
  * @param contentId - Content ID to publish
  * @param targetId - Target ID to publish to
  * @returns Promise resolving to the result of the operation
  *
  * @example
  * ```typescript
  * const result = await service.publish('domain-123', 'content-456', 'target-789');
  * if (result.success) {
  *   // Publishing job created successfully
  * }
  * ```
  */
  async publish(
  domainId: string,
  contentId: string,
  targetId: string
  ): Promise<PublishingResult> {
  return withSpan({
    spanName: 'PublishingService.publish',
    attributes: {
    'publishing.domain_id': domainId,
    'publishing.content_id': contentId,
    'publishing.target_id': targetId,
    },
  }, async () => {
    // Validate inputs
    const validationError = this.validateInputs(domainId, contentId, targetId);
    if (validationError) {
    addSpanAttributes({ 'publishing.result': 'validation_failed' });
    return { success: false, error: validationError };
    }

    const client = await this.pool.connect();

    try {
    await client.query('BEGIN');

    // Verify target exists with FOR UPDATE to prevent race conditions
    // P0-FIX: Move repository calls inside transaction for consistency
    const targetResult = await client.query(
      'SELECT * FROM publish_targets WHERE id = $1 FOR UPDATE',
      [targetId]
    );
    const target = targetResult.rows[0] ? {
      id: targetResult.rows[0]["id"],
      domainId: targetResult.rows[0].domain_id,
      // Map other fields as needed
    } : null;
    if (!target) {
      await client.query('ROLLBACK');
      addSpanAttributes({ 'publishing.result': 'target_not_found' });
      return {
      success: false,
      error: `Publish target '${targetId}' not found`
      };
    }

    // Verify target belongs to domain
    if (target.domainId !== domainId) {
      await client.query('ROLLBACK');
      addSpanAttributes({ 'publishing.result': 'target_domain_mismatch' });
      return {
      success: false,
      error: 'Target does not belong to the specified domain'
      };
    }

    // Create publishing job
    const job = PublishingJob.create(
      crypto.randomUUID(),
      domainId,
      contentId,
      targetId,
    );

    // P0-FIX: Pass client to save for transactional consistency
    await this.jobs.save(job, client);

    await client.query('COMMIT');

    addSpanAttributes({ 'publishing.result': 'success' });
    return { success: true, job };
    } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      logger.error(`Rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
    }
    addSpanAttributes({ 'publishing.result': 'error' });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create publishing job'
    };
    } finally {
    client.release();
    }
  });
  }

  /**
  * Retry a failed publishing job
  *
  * @param jobId - ID of the failed job to retry
  * @returns Promise resolving to the result of the operation
  */
  async retry(jobId: string): Promise<PublishingResult> {
  // Validate input
  if (!jobId || typeof jobId !== 'string') {
    return { success: false, error: 'Job ID is required and must be a string' };
  }

  try {
    const job = await this.jobs.getById(jobId);

    // Handle not found case
    if (!job) {
    return { success: false, error: `Publishing job '${jobId}' not found` };
    }

    // Check if job can be retried
    if (!job.canRetry()) {
    return {
    success: false,
    error: `Job '${jobId}' cannot be retried. Current status: ${job["status"]}`
    };
    }

    // Retry the job (immutable - returns new instance)
    const retriedJob = job.retry();
    await this.jobs.save(retriedJob);

    return { success: true, job: retriedJob };
  } catch (error) {
    return {
    success: false,
    error: error instanceof Error ? error.message : 'Failed to retry publishing job'
    };
  }
  }

  /**
  * Cancel a pending publishing job
  *
  * @param jobId - ID of the job to cancel
  * @returns Promise resolving to the result of the operation
  */
  async cancel(jobId: string): Promise<PublishingResult> {
  // Validate input
  if (!jobId || typeof jobId !== 'string') {
    return { success: false, error: 'Job ID is required and must be a string' };
  }

  try {
    const job = await this.jobs.getById(jobId);

    // Handle not found case
    if (!job) {
    return { success: false, error: `Publishing job '${jobId}' not found` };
    }

    // Only pending jobs can be cancelled
    if (job["status"] !== 'pending') {
    return {
    success: false,
    error: `Cannot cancel job with status '${job["status"]}'. Only pending jobs can be cancelled.`
    };
    }

    // Delete the job
    await this.jobs.delete(jobId);

    return { success: true };
  } catch (error) {
    return {
    success: false,
    error: error instanceof Error ? error.message : 'Failed to cancel publishing job'
    };
  }
  }

  // ============================================================================
  // Validation
  // ============================================================================

  /**
  * Validates input parameters
  * @param domainId - Domain ID
  * @param contentId - Content ID
  * @param targetId - Target ID
  * @returns Error message if invalid, undefined if valid
  */
  private validateInputs(
  domainId: string,
  contentId: string,
  targetId: string
  ): string | undefined {
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

  if (!targetId || typeof targetId !== 'string') {
    return 'Target ID is required and must be a string';
  }
  if (targetId.length < 1 || targetId.length > 255) {
    return 'Target ID must be between 1 and 255 characters';
  }

  return undefined;
  }
}
