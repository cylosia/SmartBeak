
import { randomUUID } from 'crypto';
import type { NextApiRequest, NextApiResponse } from 'next';

import { requireAuth, validateMethod, canAccessDomain, sendError } from '../../../lib/auth';
import { pool } from '../../../lib/db';
import { rateLimit } from '../../../lib/rate-limit';

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

    // AUTHORIZATION CHECK: Check domain access with org_id verification
    // SECURITY FIX: P1-HIGH Issue 4 - Verify org_id matches for all content access
    const hasAccess = await canAccessDomain(auth.userId, domainId, pool);
    if (!hasAccess) {
      // Security audit log for unauthorized access attempt
      console.warn(`[IDOR] User ${auth.userId} tried to create content in domain ${domainId} not belonging to their org`);
      return sendError(res, 403, 'Access denied to domain');
    }

    // SECURITY FIX: Verify domain belongs to user's org_id explicitly
    // P1-FIX: Combined query with org_id verification in single atomic check
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
      console.warn(`[IDOR] Domain ${domainId} not found or does not belong to user's org ${auth["orgId"]}`);
      return sendError(res, 403, 'Access denied to domain');
    }

    // Generate unique content ID
    const contentId = randomUUID();
    const now = new Date();

    // Insert into content_items table with org_id verification
    await pool.query(
      `INSERT INTO content_items (id, domain_id, title, body, status, content_type, created_at, updated_at, created_by, org_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [contentId, domainId, title, '', 'draft', type, now, now, auth.userId, auth["orgId"]]
    );

    // Security audit log for content creation
    console.log(`[audit:content:create] Content created: ${contentId} by user: ${auth.userId}, org: ${auth["orgId"]}, domain: ${domainId}, type: ${type}`);

    // Return created content info
    res.status(201).json({
      id: contentId,
      status: 'draft',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
  } catch (error: unknown) {
    console.error('[content/create] Error:', error);

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
