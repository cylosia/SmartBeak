import type { NextApiRequest, NextApiResponse } from 'next';

import { requireAuth, validateMethod, requireOrgAdmin, sendError } from '../../../lib/auth';
import { pool } from '../../../lib/db';
import { rateLimit } from '../../../lib/rate-limit';
import { getLogger } from '../../../../packages/kernel/logger';

const logger = getLogger('DomainArchive');

/**
* POST /api/domains/archive
* Archive a domain (mark as read-only)
* Requires org admin role for security
* SECURITY FIX: P1-HIGH Issue 4 - IDOR in Content Access
* Verifies org_id matches for all domain access
*/

// UUID validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Maximum reason length
const MAX_REASON_LENGTH = 1000;

export interface DomainResult {
  id: string;
  status: string;
  org_id: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!validateMethod(req, res, ['POST'])) return;

  try {
    // RATE LIMITING: Sensitive endpoint - 10 requests/minute
    const allowed = await rateLimit('domains:archive', 10, req, res);
    if (!allowed) return;

    // Authenticate request
    const auth = await requireAuth(req, res);
    if (!auth) return;

    // AUTHORIZATION CHECK: Require org admin for domain archiving
    try {
      await requireOrgAdmin(auth, res);
    } catch (adminError) {
      logger.warn({ userId: auth.userId }, 'Non-admin user attempted to archive domain');
      return;
    }

    const { domainId, reason } = req.body;

    // Validate required fields
    if (!domainId) {
      return sendError(res, 400, 'domainId is required');
    }

    // Validate UUID format
    if (!UUID_REGEX.test(domainId)) {
      return sendError(res, 400, 'Invalid domainId format. Expected UUID.');
    }

    // Validate reason if provided
    if (reason !== undefined && typeof reason !== 'string') {
      return sendError(res, 400, 'reason must be a string');
    }
    if (reason && reason.length > MAX_REASON_LENGTH) {
      return sendError(res, 400, `reason must be less than ${MAX_REASON_LENGTH} characters`);
    }

    // Verify domain exists and get org_id for authorization verification
    // SECURITY FIX: P1-HIGH Issue 4 - Always verify org_id matches
    const { rows: domainRows } = await pool.query<DomainResult>(
      `SELECT domain_id as id, status, org_id FROM domain_registry
      WHERE domain_id = $1
      AND org_id = $2`,
      [domainId, auth["orgId"]]
    );

    if (domainRows.length === 0) {
      // SECURITY FIX: Return 404 (not 403) to prevent ID enumeration
      logger.warn({ userId: auth.userId, domainId }, 'User attempted to archive non-existent or unauthorized domain');
      return sendError(res, 404, 'Domain not found');
    }

    const domain = domainRows[0]!;

    // Double-check org_id matches (defense in depth)
    if (domain.org_id !== auth["orgId"]) {
      logger.warn({ domainOrgId: domain.org_id, userOrgId: auth["orgId"] }, 'Domain org_id does not match user org_id');
      return sendError(res, 404, 'Domain not found');
    }

    // Check if already archived
    if (domain.status === 'archived') {
      return sendError(res, 409, 'Domain is already archived');
    }

    // Update domain status to archived with org_id verification
    const result = await pool.query<DomainResult>(
      `UPDATE domain_registry
      SET status = 'archived',
        archived_at = NOW(),
        updated_at = NOW(),
        archived_by = $2,
        archive_reason = $3
      WHERE domain_id = $1 AND org_id = $4 AND status != 'archived'
      RETURNING domain_id as id, status`,
      [domainId, auth.userId, reason || 'User initiated archive', auth["orgId"]]
    );

    if (result.rowCount === 0) {
      return sendError(res, 404, 'Domain not found or already archived');
    }

    // Security audit log for domain archive
    logger.info({ domainId, userId: auth.userId, orgId: auth["orgId"], reason: reason || 'User initiated' }, 'Domain archived');

    res.json({
      archived: true,
      domainId: result.rows[0]!["id"],
      status: result.rows[0]!.status,
      archivedAt: new Date().toISOString(),
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AuthError') return;
    logger.error({ error }, 'Failed to archive domain');

    // SECURITY FIX: P1-HIGH Issue 2 - Sanitize error messages
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('DATABASE_NOT_CONFIGURED')) {
      return sendError(res, 503, 'Service unavailable. Database not configured.');
    }

    sendError(res, 500, 'Internal server error. Failed to archive domain');
  }
}
