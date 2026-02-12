
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';

import { requireAuth, validateMethod, sendError, canAccessDomain, getRateLimitIdentifier, checkRateLimit } from '../../../lib/auth';
import { pool } from '../../../lib/db';
import { getLogger } from '@kernel/logger';

/**
* GET /api/exports/activity.pdf
* Export activity log as PDF
* Note: In production, use a proper PDF generation library like Puppeteer or PDFKit
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

const logger = getLogger('ActivityPdfExport');

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
    VALUES ($1, 'user', $2, 'activity_export_pdf', 'export', $3, $4, NOW())`,
    [
    params["orgId"],
    params.userId,
    JSON.stringify({
      domain_id: params["domainId"],
      record_count: params.recordCount,
      filters: params.filters,
      format: 'pdf',
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
  if (!auth["orgId"]) {
    return sendError(res, 400, 'Organization context is required for exports');
  }
  const params: (string | number)[] = [auth["orgId"]];
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

  query += ` ORDER BY timestamp DESC LIMIT 10000`;

  // Fetch activities
  const result = await pool.query(query, params);

  await recordExportAudit({
    userId: auth.userId,
    orgId: auth["orgId"],
    recordCount: result.rowCount || 0,
    filters: { startDate, endDate },
    ip: ip || 'unknown',
  });

  // In production, generate actual PDF with proper library
  // For now, return a text-based placeholder
  let pdfContent = `
Activity Log Export
==================
Generated: ${new Date().toISOString()}
User: ${auth.userId}
Organization: ${auth["orgId"] || 'N/A'}
Domain: ${domainId || 'All Domains'}
Records: ${result.rowCount || 0}

`;

  // Add activity records to the PDF content
  if (result.rows.length > 0) {
    pdfContent += 'ACTIVITY RECORDS\n';
    pdfContent += '================\n\n';

    result.rows.forEach((row: { timestamp: string | Date; actor: string; action: string; details?: unknown }, index: number) => {
    pdfContent += `[${index + 1}] ${new Date(row.timestamp).toLocaleString()}\n`;
    pdfContent += `    Actor: ${row.actor}\n`;
    pdfContent += `    Action: ${row.action}\n`;
    if (row.details) {
      pdfContent += `    Details: ${JSON.stringify(row.details, null, 2)}\n`;
    }
    pdfContent += '\n';
    });
  } else {
    pdfContent += 'No activity records found for the specified filters.\n';
  }

  pdfContent += `
==================
End of Report
Exported by: ${auth.userId}
Export Date: ${new Date().toISOString()}
`;

  // P2-FIX: Content is plain text, not a valid PDF — use correct Content-Type
  const filename = `activity-export-${new Date().toISOString().split('T')[0]}.txt`;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');

  res.send(Buffer.from(pdfContent));
  } catch (error: unknown) {
  if (error instanceof Error && error.name === 'AuthError') return;
  logger.error('Failed to export activity PDF', error instanceof Error ? error : undefined);
  sendError(res, 500, 'Failed to export activity PDF');
  }
}
