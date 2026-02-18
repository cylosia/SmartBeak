


import { Pool } from 'pg';

import { DLQService, RegionWorker } from '@kernel/queue';
import { EventBus } from '@kernel/event-bus';
import { getLogger } from '@kernel/logger';
import { withSpan, addSpanAttributes, recordSpanException, getBusinessKpis, getSloTracker } from '@packages/monitoring';
import { writeToOutbox } from '@packages/database/outbox';

import { PostgresPublishAttemptRepository } from '../infra/persistence/PostgresPublishAttemptRepository';
import { PublishAdapter } from './ports/PublishAdapter';
import { PublishingFailed } from '../domain/events/PublishingFailed';
import { PublishingJobRepository } from './ports/PublishingJobRepository';
import { PublishingStarted } from '../domain/events/PublishingStarted';
import { PublishingSucceeded } from '../domain/events/PublishingSucceeded';

const logger = getLogger('publishing:worker');

/**
* Result type for process operation
*/
export interface ProcessResult {
  success: boolean;
  error?: string;
}

/**
* Target configuration for publishing
*/
export interface TargetConfig {
  url?: string;
  headers?: Record<string, string>;
  timeout?: number;
}

/**
* Worker for processing publishing jobs.
*
* This worker handles the actual publishing of content to external targets,
* managing state transitions, retries, and dead letter queue.
*/
export class PublishingWorker {
  // Performance: Maximum retry attempts
  private static readonly MAX_RETRIES = 3;
  // Security: Default request timeout
  private static readonly DEFAULT_TIMEOUT = 30000;

  constructor(
  private readonly jobs: PublishingJobRepository,
  private readonly attempts: PostgresPublishAttemptRepository,
  private readonly adapter: PublishAdapter,
  private readonly eventBus: EventBus,
  private readonly dlq: DLQService,
  private readonly regionWorker: RegionWorker,
  private readonly pool: Pool
  ) {}

  /**
  * Process a publishing job
  *
  * @param jobId - ID of the publishing job to process
  * @param targetConfig - Configuration for the publishing target
  * @returns Promise resolving to the result of the operation
  * MEDIUM FIX M14: Explicit return type
  */
  async process(jobId: string, targetConfig: TargetConfig): Promise<ProcessResult> {
  return withSpan({
    spanName: 'PublishingWorker.process',
    attributes: { 'publishing.job_id': jobId },
  }, async () => {
    // Validate inputs with enhanced error handling
    const validationError = this.validateInputs(jobId, targetConfig);
    if (validationError) {
    return { success: false, error: validationError };
    }

    if (targetConfig.url) {
    try {
      new URL(targetConfig.url);
    } catch {
      return { success: false, error: 'Invalid target URL format' };
    }
    }

    const platform = targetConfig.url ? new URL(targetConfig.url).hostname : 'unknown';
    try { getBusinessKpis().recordPublishAttempt(platform); } catch { /* not initialized */ }

    try {
    return await this.regionWorker.execute(jobId, async () => {
    const client = await this.pool.connect();

    // Phase 1: atomically mark job as started
    let job;
    let updatedJob;
    let attempt;
    try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await client.query('SET LOCAL statement_timeout = $1', [30000]);

    job = await this.jobs.getById(jobId, client, { forUpdate: true });
    if (!job) {
        await client.query('ROLLBACK');
        return { success: false, error: `Publishing job '${jobId}' not found` };
    }

    attempt = job.attemptCount + 1;
    updatedJob = job.start();
    // Pass client so this save participates in the open transaction
    await this.jobs.save(updatedJob, client);
    await writeToOutbox(client, new PublishingStarted().toEnvelope(job["id"]));
    await client.query('COMMIT');
    } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* ignore secondary error */ }
    throw error;
    } finally {
    client.release();
    }

    // Phase 2: call external adapter (outside any transaction)
    const validatedConfig = this.validateTargetConfig(targetConfig);
    let publishError: unknown;
    try {
    await this.adapter.publish({
        domainId: job.domainId,
        contentId: job.contentId,
        targetConfig: validatedConfig,
    });
    } catch (err: unknown) {
    publishError = err;
    }

    // Phase 3: atomically record outcome on a fresh connection
    const outcomeClient = await this.pool.connect();
    try {
    await outcomeClient.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await outcomeClient.query('SET LOCAL statement_timeout = $1', [30000]);

    if (!publishError) {
        // P0-FIX: Pass outcomeClient so the attempt INSERT and job status UPDATE
        // are committed atomically. Without this, a crash between record() and
        // COMMIT leaves the attempt recorded as success but the job still in
        // 'publishing' state, causing the worker to re-publish to the external target.
        await this.attempts.record(job["id"], attempt, 'success', undefined, outcomeClient);
        const succeededJob = updatedJob.succeed();
        await this.jobs.save(succeededJob, outcomeClient);
        await writeToOutbox(outcomeClient, new PublishingSucceeded().toEnvelope(job["id"]));
        await outcomeClient.query('COMMIT');

        await this.auditLog('publish_succeeded', job.domainId, { jobId: job["id"] });
        addSpanAttributes({ 'publishing.result': 'success' });
        try {
        getBusinessKpis().recordPublishSuccess(platform);
        getSloTracker().recordSuccess('slo.publishing.success_rate');
        } catch { /* not initialized */ }

        return { success: true };
    } else {
        const errorMessage = publishError instanceof Error ? publishError.message : String(publishError);
        // P0-FIX: Pass outcomeClient so failure attempt and job state update are atomic.
        await this.attempts.record(job["id"], attempt, 'failure', errorMessage, outcomeClient);
        const failedJob = updatedJob.fail(errorMessage);
        await this.jobs.save(failedJob, outcomeClient);
        await writeToOutbox(outcomeClient, new PublishingFailed().toEnvelope(job["id"], errorMessage));
        await outcomeClient.query('COMMIT');

        await this.auditLog('publish_failed', job.domainId, { jobId: job["id"], error: errorMessage });
        addSpanAttributes({ 'publishing.result': 'failure' });
        recordSpanException(publishError instanceof Error ? publishError : new Error(String(publishError)));
        try {
        getBusinessKpis().recordPublishFailure(platform, errorMessage);
        getSloTracker().recordFailure('slo.publishing.success_rate');
        } catch { /* not initialized */ }

        throw publishError;
    }
    } catch (error) {
    try { await outcomeClient.query('ROLLBACK'); } catch { /* ignore secondary error */ }
    throw error;
    } finally {
    outcomeClient.release();
    }
    });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await this.dlq.record(jobId, this.regionWorker.region, err instanceof Error ? err : new Error(errorMessage), { jobId }, 1);
    await this.auditLog('publish_dlq', jobId, { error: errorMessage });

    return { success: false, error: errorMessage };
  }
  });
  }

  /**
  * Validates input parameters
  * MEDIUM FIX M14: Explicit return type
  */
  private validateInputs(jobId: string, targetConfig: TargetConfig): string | undefined {
  if (!jobId || typeof jobId !== 'string') {
    return 'Job ID is required and must be a string';
  }
  if (jobId.length < 1 || jobId.length > 255) {
    return 'Job ID must be between 1 and 255 characters';
  }
  if (!targetConfig || typeof targetConfig !== 'object') {
    return 'Target configuration is required';
  }
  return undefined;
  }

  /**
  * Validates and sanitizes target configuration
  * MEDIUM FIX M14: Explicit return type
  */
  private validateTargetConfig(config: TargetConfig): TargetConfig {
  const validated: TargetConfig = {
    timeout: Math.min(
    config.timeout || PublishingWorker.DEFAULT_TIMEOUT,
    PublishingWorker.DEFAULT_TIMEOUT
    )
  };

  // Security: Validate URL if provided
  if (config.url) {
    try {
    const url = new URL(config.url);
    // Security: Only allow HTTPS
    if (url.protocol !== 'https:') {
    throw new Error('Only HTTPS URLs are allowed');
    }
    validated.url = config.url;
    } catch {
    throw new Error(`Invalid URL: ${config.url}`);
    }
  }

  // Security: Sanitize headers
  if (config.headers) {
    validated.headers = this.sanitizeHeaders(config.headers);
  }

  return validated;
  }

  /**
  * Sanitizes HTTP headers for security
  * MEDIUM FIX M14: Explicit return type
  */
  private sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const sanitized: Record<string, string> = {};
  const forbiddenHeaders = [
    'cookie',
    'set-cookie',
    'authorization',
    'proxy-authorization'
  ];

  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();

    // Skip forbidden headers
    if (forbiddenHeaders.includes(lowerKey)) {
    continue;
    }

    // Validate header name (alphanumeric, hyphens, underscores)
    if (!/^[a-zA-Z0-9\-_]+$/.test(key)) {
    continue;
    }

    // Sanitize value - remove control characters
    // eslint-disable-next-line no-control-regex
    sanitized[key] = value.replace(/[\x00-\x1F\x7F]/g, '');
  }

  return sanitized;
  }

  /**
  * Audit logging for publishing operations
  * MEDIUM FIX M14: Explicit return type
  */
  private async auditLog(
  action: string,
  entityId: string,
  details: Record<string, unknown>
  ): Promise<void> {
  logger.info(`[AUDIT][publishing] ${action}`, {
    ...details,
    timestamp: new Date().toISOString()
  });
  }
}
