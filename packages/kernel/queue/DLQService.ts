import { Pool } from 'pg';

import { getLogger } from '@kernel/logger';

﻿import { randomUUID } from 'crypto';


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
    error["stack"] ?? null,
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
  * @param region - Optional region filter
  * @param limit - Maximum number of entries to return (default: 100)
  * @param offset - Number of entries to skip (default: 0)
  * @returns Array of DLQ entries
  */
  async list(region?: string, limit = 100, offset = 0): Promise<DLQEntry[]> {
  // P0-CRITICAL FIX: Cap offset to prevent unbounded pagination
  const MAX_SAFE_OFFSET = 10000;
  const safeOffset = Math.min(Math.max(0, offset), MAX_SAFE_OFFSET);
  logger.debug('Listing DLQ entries', { region, limit, offset: safeOffset });

  const query = region
    ? `SELECT
    id, publishing_job_id as 'jobId', region,
    error_message as 'errorMessage',
    error_stack as 'errorStack',
    error_category as 'errorCategory',
    job_data as 'jobData',
    retry_count as 'retryCount',
    created_at as 'createdAt'
    FROM publishing_dlq
    WHERE region = $1
    ORDER BY created_at DESC
    LIMIT $2 OFFSET $3`
    : `SELECT
    id, publishing_job_id as 'jobId', region,
    error_message as 'errorMessage',
    error_stack as 'errorStack',
    error_category as 'errorCategory',
    job_data as 'jobData',
    retry_count as 'retryCount',
    created_at as 'createdAt'
    FROM publishing_dlq
    ORDER BY created_at DESC
    LIMIT $1 OFFSET $2`;

  const { rows } = region
    ? await this["pool"].query(query, [region, limit, safeOffset])
    : await this["pool"].query(query, [limit, safeOffset]);

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
  * @param category - Error category to filter by
  * @param limit - Maximum number of entries to return (default: 100)
  * @param offset - Number of entries to skip (default: 0)
  * @returns Array of DLQ entries
  */
  async listByCategory(category: ErrorCategory, limit = 100, offset = 0): Promise<DLQEntry[]> {
  // P0-CRITICAL FIX: Cap offset to prevent unbounded pagination
  const MAX_SAFE_OFFSET = 10000;
  const safeOffset = Math.min(Math.max(0, offset), MAX_SAFE_OFFSET);
  logger.debug('Listing DLQ entries by category', { category, limit, offset: safeOffset });

  const { rows } = await this["pool"].query(
    `SELECT
    id, publishing_job_id as 'jobId', region,
    error_message as 'errorMessage',
    error_stack as 'errorStack',
    error_category as 'errorCategory',
    job_data as 'jobData',
    retry_count as 'retryCount',
    created_at as 'createdAt'
    FROM publishing_dlq
    WHERE error_category = $1
    ORDER BY created_at DESC
    LIMIT $2 OFFSET $3`,
    [category, limit, safeOffset]
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
  * Retry a job - removes from DLQ
  * @param jobId - Job ID to retry
  * @returns True if job was found and removed
  */
  async retry(jobId: string): Promise<boolean> {
  logger.info('Retrying job from DLQ', { jobId });

  const { rowCount } = await this["pool"].query(
    'DELETE FROM publishing_dlq WHERE publishing_job_id = $1',
    [jobId]
  );

  const success = (rowCount ?? 0) > 0;
  if (success) {
    logger.info('Job removed from DLQ for retry', { jobId });
  } else {
    logger.warn('Job not found in DLQ for retry', { jobId });
  }

  return success;
  }

  /**
  * Get retry statistics
  * @returns DLQ statistics including totals and breakdowns
  */
  async getStats(): Promise<{
  total: number;
  byCategory: Record<ErrorCategory, number>;
  byRegion: Record<string, number>;
  }> {
  logger.debug('Getting DLQ stats');

  const { rows: totalRows } = await this["pool"].query(
    'SELECT COUNT(*) as count FROM publishing_dlq'
  );

  const { rows: categoryRows } = await this["pool"].query(
    `SELECT error_category, COUNT(*) as count
    FROM publishing_dlq
    GROUP BY error_category`
  );

  const { rows: regionRows } = await this["pool"].query(
    `SELECT region, COUNT(*) as count
    FROM publishing_dlq
    GROUP BY region`
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
