
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';

import { requireAuth, validateMethod, sendError, canAccessDomain, getRateLimitIdentifier, checkRateLimit } from '../../../lib/auth';
import { pool } from '../../../lib/db';
import { getLogger } from '@kernel/logger';

/**
* GET /api/exports/activity.csv
* Export activity log as CSV
*/

const RATE_LIMIT_CONFIG = {
  maxRequests: 5,
  windowMs: 60 * 1000, // 1 minute
};

const QuerySchema = z.object({
  domainId: z.string().uuid().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

function validateDateRange(startDate?: string, endDate?: string): { valid: boolean; error?: string } {
  if (startDate && endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return { valid: false, error: 'Invalid date format' };
  }

  if (start > end) {
    return { valid: false, error: 'startDate must be before endDate' };
  }

  // Limit date range to 90 days to prevent excessive exports
  const daysDiff = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
  if (daysDiff > 90) {
    return { valid: false, error: 'Date range cannot exceed 90 days' };
  }
  }

  return { valid: true };
}

function sanitizeCsvCell(value: string): string {
  if (!value) return '';

  // Escape double quotes first (before wrapping)
  let sanitized = value.replace(/"/g, '""');

  // P1-FIX: Sanitize formula injection characters anywhere in the cell, not just
  // at the start. A tab or quote prefix can position a dangerous char mid-cell
  // where spreadsheet parsers still evaluate it as a formula.
  const dangerousChars = /[=+\-@\t\r]/;
  if (dangerousChars.test(sanitized)) {
  sanitized = '\'' + sanitized;
  }

  // Always wrap in double quotes per RFC 4180
  return `"${sanitized}"`;
}

const logger = getLogger('ActivityCsvExport');

async function recordExportAudit(params: {
  userId: string;
  orgId: string;
  domainId?: string | undefined;
  recordCount: number;
  filters: { startDate?: string | undefined; endDate?: string | undefined };
  ip: string;
}) {
  try {
  await pool.query(
    `INSERT INTO audit_events (org_id, actor_type, actor_id, action, entity_type, metadata, ip_address, created_at)
    VALUES ($1, 'user', $2, 'activity_export_csv', 'export', $3, $4, NOW())`,
    [
    params.orgId,
    params.userId,
    JSON.stringify({
      domain_id: params.domainId,
      record_count: params.recordCount,
      filters: params.filters,
      format: 'csv',
    }),
    params.ip,
    ]
  );
  } catch (error) {
  logger.error('Failed to record audit event', error instanceof Error ? error : undefined);
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!validateMethod(req, res, ['GET'])) return;

  try {

  const rateLimitId = getRateLimitIdentifier(req);
  if (!checkRateLimit(req, res, rateLimitId, RATE_LIMIT_CONFIG)) {
    return;
  }

  const auth = await requireAuth(req, res);
  if (!auth) return; // requireAuth already sent error response

  // Get client IP for audit logging
  const forwarded = req.headers['x-forwarded-for'];
  const ip = typeof forwarded === 'string'
    ? forwarded.split(',')[0]!.trim()
    : req.socket?.remoteAddress || 'unknown';

  // Validate query parameters
  const parseResult = QuerySchema.safeParse(req.query);
  if (!parseResult.success) {
    return sendError(res, 400, 'Validation failed', parseResult.error.issues);
  }

  const { domainId, startDate, endDate } = parseResult.data;

  const dateRangeValidation = validateDateRange(startDate, endDate);
  if (!dateRangeValidation.valid) {
    return sendError(res, 400, dateRangeValidation.error || 'Invalid date range');
  }

  if (domainId) {
    const hasAccess = await canAccessDomain(auth.userId, domainId, pool);
    if (!hasAccess) {
    logger.warn('Unauthorized access attempt to export activity', { userId: auth.userId, domainId });
    return sendError(res, 403, 'Access denied to domain');
    }
  }

  // Build query with soft delete filter
  let query = `SELECT timestamp, actor, action, details
        FROM activity_log
        WHERE org_id = $1
        AND deleted_at IS NULL`;
  // P2-FIX: Require orgId — previously fell back to userId which queried wrong tenant
  if (!auth.orgId) {
    return sendError(res, 400, 'Organization context is required for exports');
  }
  const params: (string | number)[] = [auth.orgId];
  let paramIndex = 2;

  if (domainId) {
    query += ` AND domain_id = $${paramIndex++}`;
    params.push(domainId);
  }

  if (startDate) {
    query += ` AND timestamp >= $${paramIndex++}`;
    params.push(startDate);
  }

  if (endDate) {
    query += ` AND timestamp <= $${paramIndex++}`;
    params.push(endDate);
  }

  query += ` ORDER BY timestamp DESC`;

  // P2-MEDIUM FIX: Implement cursor-based pagination for large exports
  const BATCH_SIZE = 1000;
  const MAX_RECORDS = 50000;
  let allRows: Array<{ timestamp?: Date | string; actor: string; action: string; details?: unknown }> = [];
  let lastTimestamp: string | null = null;
  let hasMore = true;
  let totalFetched = 0;

  while (hasMore && totalFetched < MAX_RECORDS) {
    let batchQuery = query;
    const batchParams = [...params];
    let batchParamIndex = paramIndex;

    // Add cursor for pagination
    if (lastTimestamp) {
      batchQuery += ` AND timestamp < $${batchParamIndex++}`;
      batchParams.push(lastTimestamp);
    }

    // P1-FIX: Use parameterized LIMIT instead of string interpolation
    batchQuery += ` LIMIT $${batchParamIndex++}`;
    batchParams.push(BATCH_SIZE);

    const batchResult = await pool.query(batchQuery, batchParams);
    const batchRows = batchResult.rows;

    if (batchRows.length === 0) {
      hasMore = false;
    } else {
      allRows = allRows.concat(batchRows);
      totalFetched += batchRows.length;
      lastTimestamp = batchRows[batchRows.length - 1]?.timestamp instanceof Date
        ? batchRows[batchRows.length - 1].timestamp.toISOString()
        : String(batchRows[batchRows.length - 1]?.timestamp ?? '');
      
      hasMore = batchRows.length === BATCH_SIZE;
    }
  }

  await recordExportAudit({
    userId: auth.userId,
    orgId: auth.orgId,
    recordCount: allRows.length,
    filters: { startDate, endDate },
    ip: ip || 'unknown',
  });

  // Generate CSV with sanitization
  const headers = 'timestamp,actor,action,details\n';
  const rows = allRows.map((row: { timestamp?: Date | string; actor: string; action: string; details?: unknown }) => {
    const timestampStr = row.timestamp instanceof Date 
      ? row.timestamp.toISOString() 
      : String(row.timestamp ?? '');
    const timestamp = sanitizeCsvCell(timestampStr);
    const actor = sanitizeCsvCell(row.actor);
    const action = sanitizeCsvCell(row.action);
    const details = row.details ? sanitizeCsvCell(JSON.stringify(row.details)) : '';
    return `${timestamp},${actor},${action},${details}`;
  }).join('\n');

  const csv = headers + (rows || 'No activity found');

  // Set headers for download
  const filename = `activity-export-${new Date().toISOString().split('T')[0]}.csv`;
  res.setHeader('Content-Type', 'text/csv');
  // P2-FIX: Use double quotes per RFC 6266 (single quotes are non-standard)
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');

  res.send(csv);
  } catch (error: unknown) {
  if (error instanceof Error && error.name === 'AuthError') return;
  logger.error('Failed to export activity', error instanceof Error ? error : undefined);
  sendError(res, 500, 'Failed to export activity');
  }
}
