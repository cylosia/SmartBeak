import { DLQService as KernelDLQService, DLQEntry, ErrorCategory } from '@kernel/queue/DLQService';
import { getLogger } from '@kernel/logger';

import { Pool } from 'pg';


/**
* Dead Letter Queue Service
* @deprecated Use @kernel/queue instead
* This file re-exports from kernel for backward compatibility
* with additional error handling and type safety wrappers.
*
* P2-MEDIUM FIX: Added missing import for KernelDLQService
*/

const logger = getLogger('dlq-service-compat');

// Re-export types for backward compatibility
export type { ErrorCategory, DLQEntry } from '@kernel/queue/DLQService';

// Re-export DLQService for backward compatibility
export { DLQService } from '@kernel/queue/DLQService';

/**
* Extended DLQ service with enhanced error handling
* Wraps the kernel DLQService with additional validation and logging
*/
export class SafeDLQService extends KernelDLQService {
  constructor(safePool: Pool) {
  // Validate pool before passing to parent
  if (!safePool) {
    const error = new Error('Database pool is required');
    logger["error"]('DLQ service initialization failed', error);
    throw error;
  }

  if (typeof safePool.query !== 'function') {
    const error = new Error('Invalid database pool: query method not found');
    logger["error"]('DLQ service initialization failed', error);
    throw error;
  }

  super(safePool);
  logger.info('SafeDLQService initialized');
  }

  /**
  * Record a failed job with enhanced error handling
  * @param jobId - Job identifier
  * @param region - Region where job failed
  * @param error - Error that caused the failure
  * @param jobData - Original job data
  * @param retryCount - Number of retry attempts made
  * @param orgId - Organization ID for tenant isolation (required)
  * @throws Error if recording fails
  */
  // CDLQ-2-FIX P1: orgId is now required. An optional orgId allowed callers to omit it,
  // bypassing tenant isolation and letting DLQ entries be recorded without an org boundary.
  async recordSafe(
  jobId: string,
  region: string,
  error: Error,
  jobData: Record<string, unknown>,
  retryCount: number,
  orgId: string
  ): Promise<void> {
  try {
    // Validate inputs
    if (typeof jobId !== 'string' || jobId.length === 0) {
    logger["error"]('Invalid jobId for DLQ record', new Error('Validation failed'), { jobId });
    throw new Error('Invalid jobId: must be a non-empty string');
    }

    if (typeof region !== 'string' || region.length === 0 || region.length > 100) {
    logger["error"]('Invalid region for DLQ record', new Error('Validation failed'), { region });
    throw new Error('Invalid region: must be a non-empty string (max 100 chars)');
    }

    if (!error || !(error instanceof Error)) {
    logger["error"]('Invalid error for DLQ record', new Error('Validation failed'));
    throw new Error('Invalid error: must be an Error instance');
    }

    if (!Number.isFinite(retryCount) || retryCount < 0) {
    logger["error"]('Invalid retryCount for DLQ record', new Error('Validation failed'), {
    });
    throw new Error('Invalid retryCount: must be a non-negative number');
    }

    // CDLQ-2-FIX P1: Validate the now-required orgId.
    if (typeof orgId !== 'string' || orgId.length === 0) {
    logger["error"]('Invalid orgId for DLQ record', new Error('Validation failed'), { orgId });
    throw new Error('Invalid orgId: must be a non-empty string');
    }

    const sanitizedJobId = jobId.trim();
    const sanitizedRegion = region.trim().toLowerCase();
    const sanitizedRetryCount = Math.floor(retryCount);

    await this.record(sanitizedJobId, sanitizedRegion, error, jobData, sanitizedRetryCount, orgId);

    logger.info('Job recorded to DLQ', {
    jobId: sanitizedJobId,
    region: sanitizedRegion,
    });
  } catch (recordError) {
    logger["error"](
    'Failed to record job to DLQ',
    recordError instanceof Error ? recordError : new Error(String(recordError)),
    { jobId, region }
    );
    throw recordError;
  }
  }

  // M12-FIX: Removed unused private categorizeError() method (dead code)
}

/**
* DLQ statistics
*/
export interface DLQStats {
  total: number;
  byCategory: Record<ErrorCategory, number>;
  byRegion: Record<string, number>;
}

/**
* Get DLQ stats with error handling
* @param service - DLQ service instance
* @returns DLQ statistics
* @throws Error if stats retrieval fails
*/
export async function getDLQStatsSafe(service: KernelDLQService): Promise<DLQStats> {
  try {
  if (!service || typeof service.getStats !== 'function') {
    logger["error"]('Invalid DLQ service provided', new Error('Validation failed'));
    throw new Error('Invalid DLQ service: getStats method not found');
  }

  const stats = await service.getStats();

  logger.info('DLQ stats retrieved', {
    total: stats.total,
    categories: Object.keys(stats.byCategory).length,
    regions: Object.keys(stats.byRegion).length,
  });

  return stats;
  } catch (error) {
  logger["error"](
    'Failed to get DLQ stats',
    error instanceof Error ? error : new Error(String(error))
  );
  throw error;
  }
}

/**
* Retry a job from DLQ with error handling
* @param service - DLQ service instance
* @param jobId - Job identifier to retry
* @returns True if job was found and removed, false otherwise
* @throws Error if retry operation fails
*/
export async function retryDLQJobSafe(
  service: KernelDLQService,
  orgId: string,
  jobId: string
): Promise<boolean> {
  try {
  if (!service || typeof service.retry !== 'function') {
    logger.error('Invalid DLQ service provided', new Error('Validation failed'));
    throw new Error('Invalid DLQ service: retry method not found');
  }

  // P0-1 SECURITY FIX: Validate orgId for tenant isolation (was missing, causing arity mismatch)
  if (typeof orgId !== 'string' || orgId.length === 0) {
    logger.error('Invalid orgId for DLQ retry', new Error('Validation failed'), { orgId });
    throw new Error('Invalid orgId: must be a non-empty string');
  }

  if (typeof jobId !== 'string' || jobId.length === 0) {
    logger.error('Invalid jobId for DLQ retry', new Error('Validation failed'), { jobId });
    throw new Error('Invalid jobId: must be a non-empty string');
  }

  const sanitizedJobId = jobId.trim();
  // P0-1 SECURITY FIX: Pass orgId to enforce tenant isolation
  const result = await service.retry(orgId, sanitizedJobId);

  if (result) {
    logger.info('DLQ job retried successfully', { jobId: sanitizedJobId });
  } else {
    logger.warn('DLQ job not found for retry', { jobId: sanitizedJobId });
  }

  return result;
  } catch (error) {
  logger["error"](
    'Failed to retry DLQ job',
    error instanceof Error ? error : new Error(String(error)),
    { jobId }
  );
  throw error;
  }
}

/**
* List DLQ entries with error handling
* @param service - DLQ service instance
* @param region - Optional region filter
* @returns Array of DLQ entries
* @throws Error if listing fails
*/
export async function listDLQEntriesSafe(
  service: KernelDLQService,
  orgId: string,
  region?: string
): Promise<DLQEntry[]> {
  try {
  if (!service || typeof service.list !== 'function') {
    logger.error('Invalid DLQ service provided', new Error('Validation failed'));
    throw new Error('Invalid DLQ service: list method not found');
  }

  // P0-1 SECURITY FIX: Validate orgId for tenant isolation (was missing, causing arity mismatch)
  if (typeof orgId !== 'string' || orgId.length === 0) {
    logger.error('Invalid orgId for DLQ list', new Error('Validation failed'), { orgId });
    throw new Error('Invalid orgId: must be a non-empty string');
  }

  // Validate region if provided
  if (region !== undefined) {
    if (typeof region !== 'string' || region.length === 0 || region.length > 100) {
    logger.error('Invalid region filter', new Error('Validation failed'), { region });
    throw new Error('Invalid region: must be a non-empty string (max 100 chars)');
    }
  }

  const sanitizedRegion = region ? region.trim().toLowerCase() : undefined;
  // P0-1 SECURITY FIX: Pass orgId to enforce tenant isolation
  const entries = await service.list(orgId, sanitizedRegion);

  logger.info('DLQ entries listed', {
    count: entries.length,
    region: sanitizedRegion,
  });

  return entries;
  } catch (error) {
  logger["error"](
    'Failed to list DLQ entries',
    error instanceof Error ? error : new Error(String(error)),
    { region }
  );
  throw error;
  }
}
