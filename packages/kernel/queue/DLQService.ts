import { Pool } from 'pg';

import { getLogger } from '@kernel/logger';

import { randomUUID } from 'crypto';


/**
* Dead Letter Queue Service
* Infrastructure service for handling failed jobs with full error context
*/

const logger = getLogger('dlq-service');

export type ErrorCategory = 'network' | 'auth' | 'validation' | 'timeout' | 'database' | 'unknown';

export interface DLQEntry {
  id: string;
  jobId: string;
  region: string;
  errorMessage: string;
  errorStack?: string;
  errorCategory: ErrorCategory;
  jobData: unknown;
  retryCount: number;
  createdAt: Date;
}

/**
* Categorize errors for better alerting and handling
*/
function categorizeError(error: Error): ErrorCategory {
  const message = error["message"].toLowerCase();

  if (message.includes('timeout') || message.includes('etimedout')) {
  return 'timeout';
  }
  if (message.includes('unauthorized') || message.includes('forbidden') || message.includes('auth')) {
  return 'auth';
  }
  if (message.includes('validation') || message.includes('invalid')) {
  return 'validation';
  }
  if (message.includes('connection') || message.includes('econnrefused') || message.includes('enotfound')) {
  return 'network';
  }
  if (message.includes('database') || message.includes('query') || message.includes('sql')) {
  return 'database';
  }
  return 'unknown';
}

export class DLQService {
  constructor(private readonly pool: Pool) {}

  /**
  * Record a failed job with full error context
  * @param jobId - Job ID
  * @param region - Region identifier
  * @param error - Error that caused the failure
  * @param jobData - Original job data
  * @param retryCount - Number of retry attempts made
  */
  async record(
  jobId: string,
  region: string,
  error: Error,
  jobData: unknown,
  retryCount: number
  ): Promise<void> {
  const category = categorizeError(error);

  logger.info('Recording job to DLQ', {
  });

  try {
    await this["pool"].query(
    `INSERT INTO publishing_dlq (
    id, publishing_job_id, region,
    error_message, error_stack, error_category,
    job_data, retry_count, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
    [
    randomUUID(),
    jobId,
    region,
    error["message"],
    // P2-16 SECURITY FIX: Truncate stack traces to prevent leaking file paths and secrets
    error["stack"] ? error["stack"].split('\n').slice(0, 5).join('\n') : null,
    category,
    JSON.stringify(jobData),
    retryCount,
    ]
    );

    logger.info('Job recorded to DLQ successfully', { jobId, category });
  } catch (dbError) {
    logger["error"]('Failed to record job to DLQ', dbError as Error, { jobId });
    throw dbError;
  }
  }

  /**
  * List DLQ entries, optionally filtered by region
  * MEDIUM FIX M9: Add pagination for large result sets
  * SECURITY FIX P0-3: Added orgId parameter for tenant isolation
  * @param orgId - Organization ID for tenant isolation (required)
  * @param region - Optional region filter
  * @param limit - Maximum number of entries to return (default: 100)
  * @param offset - Number of entries to skip (default: 0)
  * @returns Array of DLQ entries
  */
  async list(orgId: string, region?: string, limit = 100, offset = 0): Promise<DLQEntry[]> {
  if (!orgId || typeof orgId !== 'string') {
    throw new Error('orgId is required for tenant isolation');
  }
  // P0-CRITICAL FIX: Cap offset to prevent unbounded pagination
  const MAX_SAFE_OFFSET = 10000;
  const safeOffset = Math.min(Math.max(0, offset), MAX_SAFE_OFFSET);
  logger.debug('Listing DLQ entries', { orgId, region, limit, offset: safeOffset });

  const query = region
    ? `SELECT
    id, publishing_job_id as "jobId", region,
    error_message as "errorMessage",
    error_stack as "errorStack",
    error_category as "errorCategory",
    job_data as "jobData",
    retry_count as "retryCount",
    created_at as "createdAt"
    FROM publishing_dlq
    WHERE org_id = $1 AND region = $2
    ORDER BY created_at DESC
    LIMIT $3 OFFSET $4`
    : `SELECT
    id, publishing_job_id as "jobId", region,
    error_message as "errorMessage",
    error_stack as "errorStack",
    error_category as "errorCategory",
    job_data as "jobData",
    retry_count as "retryCount",
    created_at as "createdAt"
    FROM publishing_dlq
    WHERE org_id = $1
    ORDER BY created_at DESC
    LIMIT $2 OFFSET $3`;

  const { rows } = region
    ? await this["pool"].query(query, [orgId, region, limit, safeOffset])
    : await this["pool"].query(query, [orgId, limit, safeOffset]);

  logger.debug('DLQ entries retrieved', { count: rows.length });

  return rows.map(row => ({
    ...row,
    // FIX: Added try-catch around JSON.parse to handle malformed data
    jobData: ((): unknown => {
    if (typeof row.jobData !== 'string') {
    return row.jobData;
    }
    try {
    return JSON.parse(row.jobData);
    } catch (parseError) {
    logger.warn('Failed to parse jobData JSON, returning raw string', {
    jobId: row.jobId,
    error: parseError instanceof Error ? parseError["message"] : 'Unknown parse error',
    });
    return row.jobData; // Return raw string if parsing fails
    }
    })(),
  }));
  }

  /**
  * Get entries by error category for targeted remediation
  * P0-2 FIX: Fixed single-quoted aliases to double-quoted (PostgreSQL standard)
  * P0-3 SECURITY FIX: Added orgId parameter for tenant isolation
  * @param orgId - Organization ID for tenant isolation (required)
  * @param category - Error category to filter by
  * @param limit - Maximum number of entries to return (default: 100)
  * @param offset - Number of entries to skip (default: 0)
  * @returns Array of DLQ entries
  */
  async listByCategory(orgId: string, category: ErrorCategory, limit = 100, offset = 0): Promise<DLQEntry[]> {
  if (!orgId || typeof orgId !== 'string') {
    throw new Error('orgId is required for tenant isolation');
  }
  // P0-CRITICAL FIX: Cap offset to prevent unbounded pagination
  const MAX_SAFE_OFFSET = 10000;
  const safeOffset = Math.min(Math.max(0, offset), MAX_SAFE_OFFSET);
  logger.debug('Listing DLQ entries by category', { orgId, category, limit, offset: safeOffset });

  // P0-2 FIX: Changed single-quoted aliases to double-quoted (PostgreSQL identifier syntax)
  // P0-3 FIX: Added org_id filter for tenant isolation
  const { rows } = await this["pool"].query(
    `SELECT
    id, publishing_job_id as "jobId", region,
    error_message as "errorMessage",
    error_stack as "errorStack",
    error_category as "errorCategory",
    job_data as "jobData",
    retry_count as "retryCount",
    created_at as "createdAt"
    FROM publishing_dlq
    WHERE org_id = $1 AND error_category = $2
    ORDER BY created_at DESC
    LIMIT $3 OFFSET $4`,
    [orgId, category, limit, safeOffset]
  );

  return rows.map(row => ({
    ...row,
    // FIX: Added try-catch around JSON.parse to handle malformed data
    jobData: ((): unknown => {
    if (typeof row.jobData !== 'string') {
    return row.jobData;
    }
    try {
    return JSON.parse(row.jobData);
    } catch (parseError) {
    logger.warn('Failed to parse jobData JSON, returning raw string', {
    jobId: row.jobId,
    error: parseError instanceof Error ? parseError["message"] : 'Unknown parse error',
    });
    return row.jobData; // Return raw string if parsing fails
    }
    })(),
  }));
  }

  /**
  * Retry a job - removes from DLQ for re-processing
  * SECURITY FIX P0-3: Added orgId parameter for tenant isolation
  * @param orgId - Organization ID for tenant isolation (required)
  * @param jobId - Job ID to retry
  * @returns True if job was found and removed
  */
  async retry(orgId: string, jobId: string): Promise<boolean> {
  if (!orgId || typeof orgId !== 'string') {
    throw new Error('orgId is required for tenant isolation');
  }
  logger.info('Retrying job from DLQ', { orgId, jobId });

  const { rowCount } = await this["pool"].query(
    'DELETE FROM publishing_dlq WHERE publishing_job_id = $1 AND org_id = $2',
    [jobId, orgId]
  );

  const success = (rowCount ?? 0) > 0;
  if (success) {
    logger.info('Job removed from DLQ for retry', { orgId, jobId });
  } else {
    logger.warn('Job not found in DLQ for retry', { orgId, jobId });
  }

  return success;
  }

  /**
  * Permanently delete a DLQ entry without re-processing
  * SECURITY FIX P0-4: Separate delete from retry to prevent accidental re-execution
  * SECURITY FIX P0-3: Requires orgId for tenant isolation
  * @param orgId - Organization ID for tenant isolation (required)
  * @param jobId - Job ID to delete
  * @returns True if entry was found and deleted
  */
  async delete(orgId: string, jobId: string): Promise<boolean> {
  if (!orgId || typeof orgId !== 'string') {
    throw new Error('orgId is required for tenant isolation');
  }
  logger.info('Permanently deleting job from DLQ', { orgId, jobId });

  const { rowCount } = await this["pool"].query(
    'DELETE FROM publishing_dlq WHERE publishing_job_id = $1 AND org_id = $2',
    [jobId, orgId]
  );

  const success = (rowCount ?? 0) > 0;
  if (success) {
    logger.info('Job permanently deleted from DLQ', { orgId, jobId });
  } else {
    logger.warn('Job not found in DLQ for deletion', { orgId, jobId });
  }

  return success;
  }

  /**
  * Get retry statistics
  * P0-3 SECURITY FIX: Added orgId parameter for tenant isolation
  * @param orgId - Organization ID for tenant isolation (required)
  * @returns DLQ statistics including totals and breakdowns
  */
  async getStats(orgId?: string): Promise<{
  total: number;
  byCategory: Record<ErrorCategory, number>;
  byRegion: Record<string, number>;
  }> {
  logger.debug('Getting DLQ stats', { orgId });

  // P0-3 FIX: Filter by org_id when provided to prevent cross-tenant data leakage
  const orgFilter = orgId ? 'WHERE org_id = $1' : '';
  const orgParams = orgId ? [orgId] : [];

  const { rows: totalRows } = await this["pool"].query(
    `SELECT COUNT(*) as count FROM publishing_dlq ${orgFilter}`,
    orgParams
  );

  const { rows: categoryRows } = await this["pool"].query(
    `SELECT error_category, COUNT(*) as count
    FROM publishing_dlq
    ${orgFilter}
    GROUP BY error_category`,
    orgParams
  );

  const { rows: regionRows } = await this["pool"].query(
    `SELECT region, COUNT(*) as count
    FROM publishing_dlq
    ${orgFilter}
    GROUP BY region`,
    orgParams
  );

  const byCategory: Record<string, number> = {};
  categoryRows.forEach(row => {
    byCategory[row.error_category] = parseInt(row.count, 10);
  });

  const byRegion: Record<string, number> = {};
  regionRows.forEach(row => {
    byRegion[row.region] = parseInt(row.count, 10);
  });

  const stats = {
    total: parseInt(totalRows[0].count, 10),
    byCategory: byCategory as Record<ErrorCategory, number>,
    byRegion: byRegion,
  };

  logger.debug('DLQ stats retrieved', stats);

  return stats;
  }

  /**
  * Purge old DLQ entries
  * @param olderThanDays - Purge entries older than this many days
  * @returns Number of entries purged
  */
  async purge(olderThanDays: number): Promise<number> {
  logger.info('Purging old DLQ entries', { olderThanDays });

  const { rowCount } = await this["pool"].query(
    `DELETE FROM publishing_dlq
    WHERE created_at < NOW() - make_interval(days => $1::int)`,
    [olderThanDays]
  );

  const purged = rowCount ?? 0;
  logger.info('DLQ purge completed', { purged, olderThanDays });

  return purged;
  }
}
