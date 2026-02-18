
import { randomUUID } from 'crypto';
import type { NextApiRequest, NextApiResponse } from 'next';

import { requireAuth, validateMethod, sendError } from '../../../lib/auth';
import { pool } from '../../../lib/db';
import { rateLimit } from '../../../lib/rate-limit';
import { getLogger } from '@kernel/logger';

const logger = getLogger('content:create');

/**
* POST /api/content/create
* Creates a new content item as draft
* Requires: domainId, title (optional), type (optional)
* SECURITY FIX: P1-HIGH Issue 4 - IDOR in Content Access
* Verifies org_id matches for all content access
*/

// UUID validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Valid content types
const VALID_CONTENT_TYPES = ['article', 'page', 'post', 'product', 'guide', 'review'];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!validateMethod(req, res, ['POST'])) return;

  try {
    // RATE LIMITING: Write endpoint - 30 requests/minute
    const allowed = await rateLimit('content:create', 30, req, res);
    if (!allowed) return;

    // Authenticate request
    const auth = await requireAuth(req, res);
    if (!auth) return; // requireAuth already sent error response

    // P2-037 FIX: Enforce minimum role for content creation.
    // Viewer-role users should not be able to create content.
    const CONTENT_CREATE_ROLES: string[] = ['owner', 'admin', 'editor'];
    const hasRole = auth.roles.some((r: string) => CONTENT_CREATE_ROLES.includes(r));
    if (!hasRole) {
      return sendError(res, 403, 'Forbidden. Editor or admin access required to create content.');
    }

    const { domainId, title = '', type = 'article' } = req.body;

    // Validate required fields
    if (!domainId) {
      return sendError(res, 400, 'domainId is required');
    }

    // Validate UUID format for domainId
    if (!UUID_REGEX.test(domainId)) {
      return sendError(res, 400, 'Invalid domainId format. Expected UUID.');
    }

    // Validate title
    if (typeof title !== 'string') {
      return sendError(res, 400, 'title must be a string');
    }
    if (title.length > 500) {
      return sendError(res, 400, 'title must be less than 500 characters');
    }

    // Validate content type
    if (!VALID_CONTENT_TYPES.includes(type)) {
      return sendError(res, 400, `Invalid type. Must be one of: ${VALID_CONTENT_TYPES.join(', ')}`);
    }

    // SECURITY FIX: Single authorization check with org_id verification.
    // Removed redundant canAccessDomain() call which was a separate DB round trip
    // that didn't verify org_id. This query does userId + domainId + orgId atomically.
    const { rows: domainRows } = await pool.query(
      `SELECT dr.domain_id, dr.org_id
       FROM domain_registry dr
       JOIN memberships m ON m.org_id = dr.org_id
       WHERE dr.domain_id = $1
       AND m.user_id = $2
       AND dr.org_id = $3`,
      [domainId, auth.userId, auth["orgId"]]
    );

    // P1-FIX: Single verification check - query already filtered by org_id
    if (domainRows.length === 0) {
      logger.warn('IDOR attempt: domain not found or does not belong to user org', { domainId, orgId: auth["orgId"] });
      return sendError(res, 403, 'Access denied to domain');
    }

    // Generate unique content ID
    const contentId = randomUUID();
    const now = new Date();

    // SECURITY FIX: Removed created_by and org_id columns which don't exist in DB schema
    // (content_items migration only has: id, domain_id, title, body, status, content_type, publish_at, archived_at, created_at, updated_at)
    // The org_id relationship is maintained through domain_registry.org_id (domain_id -> domain_registry -> org_id)
    await pool.query(
      `INSERT INTO content_items (id, domain_id, title, body, status, content_type, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [contentId, domainId, title, '', 'draft', type, now, now]
    );

    // Security audit log for content creation
    logger.info('Content created', { contentId, userId: auth.userId, orgId: auth["orgId"], domainId, type });

    // Return created content info
    res.status(201).json({
      id: contentId,
      status: 'draft',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
  } catch (error: unknown) {
    logger.error('Error creating content', error instanceof Error ? error : undefined, { error: String(error) });

    // Handle specific database errors
    const pgError = error as { code?: string; message?: string };
    if (pgError.code === '23503') { // Foreign key violation
      return sendError(res, 400, 'Invalid domainId. Domain does not exist.');
    }
    if (pgError.code === '23505') { // Unique violation
      return sendError(res, 409, 'Content with this ID already exists.');
    }
    if (pgError.message?.includes('DATABASE_NOT_CONFIGURED')) {
      return sendError(res, 503, 'Service unavailable. Database not configured.');
    }

    // SECURITY FIX: P1-HIGH Issue 2 - Sanitize error messages
    sendError(res, 500, 'Internal server error. Failed to create content.');
  }
}
