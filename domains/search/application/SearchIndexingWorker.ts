import { Pool, PoolClient } from 'pg';

import { EventBus } from '@kernel/event-bus';
import { getLogger } from '@kernel/logger';

import { ContentRepository } from '../../content/application/ports/ContentRepository';
import { IndexingJobRepository } from './ports/IndexingJobRepository';
import { SearchDocument, SearchDocumentFields } from '../domain/entities/SearchDocument';
import { SearchDocumentRepository } from './ports/SearchDocumentRepository';
import { SearchIndexed } from '../domain/events/SearchIndexed';
import { SearchIndexFailed } from '../domain/events/SearchIndexFailed';

const logger = getLogger('search:indexing:worker');

// ============================================================================
// Type Definitions
// ============================================================================

/**
* Result type for process operation
*/
export interface ProcessResult {
  /** Whether operation succeeded */
  success: boolean;
  /** Error message (if failed) */
  error?: string;
}

/**
* Batch processing result
* P1-FIX: Added for batch operation tracking
*/
export interface BatchProcessResult {
  /** Number of jobs successfully processed */
  succeeded: number;
  /** Number of jobs that failed */
  failed: number;
  /** Detailed results per job ID */
  results: Map<string, ProcessResult>;
}

// ============================================================================
// Search Indexing Worker
// ============================================================================

/**
* Worker for processing search indexing jobs.
*
* This worker handles the actual indexing and deletion of search documents,
* managing transactions and state transitions atomically.
*
* P1-FIX: Added batch processing with proper transaction context propagation
*/
export class SearchIndexingWorker {
  /** Maximum number of retry attempts */
  private static readonly MAX_RETRIES = 3;

  /**
  * Create a new SearchIndexingWorker
  * @param jobs - Job repository
  * @param docs - Search document repository
  * @param eventBus - Event bus for publishing events
  * @param pool - Database connection pool
  * @param contentRepo - Content repository
  */
  constructor(
  private readonly jobs: IndexingJobRepository,
  private readonly docs: SearchDocumentRepository,
  private readonly eventBus: EventBus,
  private readonly pool: Pool,
  private readonly contentRepo: ContentRepository
  ) {}

  /**
  * Process an indexing job
  *
  * @param jobId - ID of the indexing job to process
  * @param client - Optional database client for transaction participation
  * @returns Promise resolving to the result of the operation
  */
  async process(jobId: string, client?: PoolClient): Promise<ProcessResult> {
  if (!jobId || typeof jobId !== 'string') {
    return { success: false, error: 'Invalid job ID: must be a non-empty string' };
  }

  if (jobId.length > 255) {
    return { success: false, error: 'Invalid job ID: exceeds maximum length' };
  }

  // P1-FIX: Use provided client or acquire new one
  const shouldReleaseClient = !client;
  const queryClient = client || await this.pool.connect();

  try {
    if (shouldReleaseClient) {
    await queryClient.query('BEGIN');
    }

    // P1-FIX: Pass client to repository for transaction context
    const job = await this.jobs.getById(jobId, queryClient);

    // Handle not found case
    if (!job) {
    if (shouldReleaseClient) {
    await queryClient.query('ROLLBACK');
    }
    return { success: false, error: `Indexing job '${jobId}' not found` };
    }

    // Validate state transition
    if (!job.isPending()) {
    if (shouldReleaseClient) {
    await queryClient.query('ROLLBACK');
    }
    return {
    success: false,
    error: `Invalid job state: expected 'pending', got '${job.status}'`
    };
    }

    // Start processing (immutable - returns new instance)
    const processingJob = job.start();
    await this.jobs.save(processingJob, queryClient);

    if (shouldReleaseClient) {
    await queryClient.query('COMMIT');
    }

    // Execute indexing outside transaction (may call external services)
    try {
    if (processingJob.action === 'index') {
    // Query database for actual content fields
    const content = await this.contentRepo.getById(processingJob.contentId);
    if (!content) {
    throw new Error(`Content '${processingJob.contentId}' not found`);
    }
    const fields: SearchDocumentFields = {
    title: content.title ?? '',
    body: content.body ?? '',
    excerpt: (content.body ?? '').substring(0, 200)
    };
    const doc = SearchDocument.create(
    processingJob.contentId,
    processingJob.indexId,
    fields,
    'indexed'
    );
    await this.docs.upsert(doc, queryClient);
    } else {
    await this.docs.markDeleted(processingJob.contentId, queryClient);
    }

    // Success - mark job as done
    if (shouldReleaseClient) {
    await queryClient.query('BEGIN');
    }
    const completedJob = processingJob.succeed();
    await this.jobs.save(completedJob, queryClient);
    if (shouldReleaseClient) {
    await queryClient.query('COMMIT');
    }
    await this.eventBus.publish(new SearchIndexed().toEnvelope(processingJob.contentId));

    // Audit logging
    await this.auditLog('indexing_succeeded', processingJob.indexId, {
    contentId: processingJob.contentId,
    action: processingJob.action
    });

    return { success: true };

    } catch (err: unknown) {
    // Failure - mark job as failed
    if (shouldReleaseClient) {
    await queryClient.query('BEGIN');
    }

    const failedJob = processingJob.fail();
    await this.jobs.save(failedJob, queryClient);

    const errorMessage = err instanceof Error ? err.message : String(err);
    if (shouldReleaseClient) {
    await queryClient.query('COMMIT');
    }
    await this.eventBus.publish(new SearchIndexFailed().toEnvelope(processingJob.contentId, errorMessage));

    // Audit logging
    await this.auditLog('indexing_failed', processingJob.indexId, {
    contentId: processingJob.contentId,
    error: errorMessage
    });

    return { success: false, error: errorMessage };
    }
  } catch (error) {
    if (shouldReleaseClient) {
    try {
    await queryClient.query('ROLLBACK');
    } catch (rollbackError) {
    const rollbackErrorMessage = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
      logger.error(`Rollback failed: ${rollbackErrorMessage}`);
    }
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  } finally {
    if (shouldReleaseClient) {
    queryClient.release();
    }
  }
  }

  /**
  * Process multiple jobs in batch for better performance
  * P1-FIX: Complete rewrite to use batch operations instead of N+1 pattern
  *
  * @param jobIds - Array of job IDs to process
  * @returns Promise resolving to batch results
  */
  async processBatch(jobIds: string[]): Promise<Map<string, ProcessResult>> {
  if (!Array.isArray(jobIds)) {
    throw new Error('jobIds must be an array');
  }

  const MAX_BATCH_SIZE = 100;
  if (jobIds.length > MAX_BATCH_SIZE) {
    throw new Error(`Batch size ${jobIds.length} exceeds maximum ${MAX_BATCH_SIZE}`);
  }

  const results = new Map<string, ProcessResult>();

  // P1-FIX: Use single transaction for entire batch where possible
  const client = await this.pool.connect();

  try {
    await client.query('BEGIN');

    // P1-FIX: Fetch all jobs in a single query if repository supports it
    let jobs: Array<{ id: string; job: any }> = [];

    if (this.jobs.getByIds) {
    // Use batch fetch if available
    const fetchedJobs = await this.jobs.getByIds(jobIds, client);
    for (const job of fetchedJobs) {
    jobs.push({ id: job.id, job });
    }
    } else {
    // Fall back to individual fetches within transaction
    for (const jobId of jobIds) {
    const job = await this.jobs.getById(jobId, client);
    if (job) {
    jobs.push({ id: jobId, job });
    } else {
    results.set(jobId, { success: false, error: 'Job not found' });
    }
    }
    }

    // Filter to only pending jobs
    const pendingJobs = jobs.filter(({ job }) => job.isPending());

    for (const { id, job } of jobs) {
    if (!job.isPending()) {
    results.set(id, {
    success: false,
    error: `Invalid job state: expected 'pending', got '${job.status}'`
    });
    }
    }

    if (pendingJobs.length === 0) {
    await client.query('COMMIT');
    return results;
    }

    // Mark all pending jobs as processing
    const processingJobs = pendingJobs.map(({ job }) => job.start());

    // P1-FIX: Use batch save if available
    if (this.jobs.saveBatch) {
    await this.jobs.saveBatch(processingJobs, client);
    } else {
    // Fall back to individual saves within transaction
    for (const job of processingJobs) {
    await this.jobs.save(job, client);
    }
    }

    await client.query('COMMIT');

    // Process indexing outside transaction (may call external services)
    const completedJobs: Array<{ id: string; job: any; success: boolean; error?: string }> = [];

    for (const { id, job: originalJob } of pendingJobs) {
    const processingJob = originalJob.start();

    try {
    if (processingJob.action === 'index') {
    const content = await this.contentRepo.getById(processingJob.contentId);
    if (!content) {
        throw new Error(`Content '${processingJob.contentId}' not found`);
    }
    const fields: SearchDocumentFields = {
        title: content.title ?? '',
        body: content.body ?? '',
        excerpt: (content.body ?? '').substring(0, 200)
    };
    const doc = SearchDocument.create(
        processingJob.contentId,
        processingJob.indexId,
        fields,
        'indexed'
    );
    await this.docs.upsert(doc, client);
    } else {
    await this.docs.markDeleted(processingJob.contentId, client);
    }

    completedJobs.push({ id, job: processingJob.succeed(), success: true });
    results.set(id, { success: true });

    await this.eventBus.publish(new SearchIndexed().toEnvelope(processingJob.contentId));

    } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    completedJobs.push({ id, job: processingJob.fail(), success: false, error: errorMessage });
    results.set(id, { success: false, error: errorMessage });

    await this.eventBus.publish(new SearchIndexFailed().toEnvelope(processingJob.contentId, errorMessage));
    }
    }

    // Update final statuses in batch
    if (completedJobs.length > 0) {
    await client.query('BEGIN');

    if (this.jobs.saveBatch) {
    await this.jobs.saveBatch(
    completedJobs.map(c => c.job),
    client
    );
    } else {
    for (const { job } of completedJobs) {
    await this.jobs.save(job, client);
    }
    }

    await client.query('COMMIT');
    }

    // Audit logging
    for (const { id, job, success, error } of completedJobs) {
    await this.auditLog(
    success ? 'indexing_succeeded' : 'indexing_failed',
    job.indexId,
    {
    jobId: id,
    contentId: job.contentId,
    action: job.action,
    ...(error && { error })
    }
    );
    }

    return results;

  } catch (error) {
    // P1-FIX: Log ROLLBACK errors instead of suppressing
    await client.query('ROLLBACK').catch((rollbackErr) => {
    logger.error('ROLLBACK failed after batch processing error', rollbackErr);
    });

    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Batch processing failed: ${errorMessage} (jobs: ${jobIds.length})`);

    // Mark all remaining jobs as failed
    for (const jobId of jobIds) {
    if (!results.has(jobId)) {
    results.set(jobId, { success: false, error: `Batch failed: ${errorMessage}` });
    }
    }

    return results;
  } finally {
    client.release();
  }
  }

  /**
  * Fetch and process a batch of pending jobs
  * P1-FIX: Added helper method for efficient batch processing
  *
  * @param batchSize - Number of jobs to fetch and process
  * @returns Promise resolving to batch processing results
  */
  async processPendingBatch(batchSize: number = 10): Promise<BatchProcessResult> {
  const client = await this.pool.connect();

  try {
    await client.query('BEGIN');

    // Fetch pending jobs
    const pendingJobs = await this.jobs.listPending(batchSize, client);

    await client.query('COMMIT');

    if (pendingJobs.length === 0) {
    return { succeeded: 0, failed: 0, results: new Map() };
    }

    // Process the batch
    const jobIds = pendingJobs.map(job => job.id);
    const results = await this.processBatch(jobIds);

    let succeeded = 0;
    let failed = 0;

    for (const [, result] of results) {
    if (result.success) {
    succeeded++;
    } else {
    failed++;
    }
    }

    return { succeeded, failed, results };

  } catch (error) {
    // P1-FIX: Log ROLLBACK errors instead of suppressing
    await client.query('ROLLBACK').catch((rollbackErr) => {
    logger.error('ROLLBACK failed after processPendingBatch error', rollbackErr);
    });
    throw error;
  } finally {
    client.release();
  }
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  /**
  * Audit logging for indexing operations
  * @param action - Action being logged
  * @param entityId - Entity ID
  * @param details - Additional details
  */
  private async auditLog(
  action: string,
  entityId: string,
  details: Record<string, unknown>
  ): Promise<void> {
  logger.info(`[AUDIT][search-indexing] ${action}`, {
    ...details,
    timestamp: new Date().toISOString()
  });
  }
}
