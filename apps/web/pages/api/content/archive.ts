

import { randomUUID } from 'crypto';
import type { NextApiRequest, NextApiResponse } from 'next';

import { requireAuth, validateMethod, sendError } from '../../../lib/auth';
import { pool } from '../../../lib/db';
import { rateLimit } from '../../../lib/rate-limit';
import { getLogger } from '@kernel/logger';

const logger = getLogger('content:archive');

/**
* POST /api/content/archive
* Archives content by creating an archive intent and marking content as archived.
* This is a soft delete - content can be restored later.
* Requires: contentId
* SECURITY FIX: P1-HIGH Issue 4 - IDOR in Content Access
* Verifies org_id matches for all content access
*/

// UUID validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Maximum reason length
const MAX_REASON_LENGTH = 500;

export interface ContentItem {
  id: string;
  domain_id: string;
  title: string;
  status: string;
  org_id: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!validateMethod(req, res, ['POST'])) return;

  try {
    // RATE LIMITING: Write endpoint - 30 requests/minute
    const allowed = await rateLimit('content:archive', 30, req, res);
    if (!allowed) return;

    // Authenticate request
    const auth = await requireAuth(req, res);
    if (!auth) return;

    const { contentId, reason } = req.body;

    // Validate required fields
    if (!contentId) {
      return sendError(res, 400, 'contentId is required');
    }

    // Validate UUID format
    if (!UUID_REGEX.test(contentId)) {
      return sendError(res, 400, 'Invalid contentId format. Expected UUID.');
    }

    // Validate reason if provided
    if (reason !== undefined && typeof reason !== 'string') {
      return sendError(res, 400, 'reason must be a string');
    }
    if (reason && reason.length > MAX_REASON_LENGTH) {
      return sendError(res, 400, `reason must be less than ${MAX_REASON_LENGTH} characters`);
    }

    // SECURITY FIX: P1-HIGH Issue 4 - IDOR fix: Verify org_id matches for all content access
    // P1-FIX: Changed ci["id"] to ci.id — bracket notation is for JSON field access, not columns
    const { rows } = await pool.query<ContentItem>(
      `SELECT ci.id, ci.domain_id, ci.title, ci.status, ci.org_id
       FROM content_items ci
       WHERE ci.id = $1
       AND ci.org_id = $2
       AND ci.domain_id IN (
         SELECT domain_id FROM memberships m
         JOIN domain_registry dr ON dr.org_id = m.org_id
         WHERE m.user_id = $3
       )`,
      [contentId, auth["orgId"], auth.userId]
    );

    if (rows.length === 0) {
      // SECURITY FIX: Return 404 (not 403) to prevent ID enumeration
      logger.warn('IDOR attempt: user tried to archive content not in their org', { userId: auth.userId, contentId });
      return sendError(res, 404, 'Content not found');
    }

    const content = rows[0]!;

    // Verify org_id matches
    if (content.org_id !== auth["orgId"]) {
      logger.warn('IDOR attempt: content org_id does not match user org_id', { contentOrgId: content.org_id, userOrgId: auth["orgId"] });
      return sendError(res, 404, 'Content not found');
    }

    // Ownership already verified in the query above

    // Already archived
    if (content.status === 'archived') {
      return sendError(res, 409, 'Content is already archived');
    }

    const intentId = randomUUID();
    const now = new Date();

    // Create archive intent record for audit trail
    try {
      await pool.query(
        `INSERT INTO content_archive_intents (id, content_id, reason, requested_at, status, requested_by, org_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [intentId, contentId, reason || 'User initiated', now, 'approved', auth.userId, auth["orgId"]]
      );
    } catch (err: unknown) {
      // P1-FIX: Use unknown instead of any for type safety
      // Intent table may not exist, continue with archive
      const pgError = err as { code?: string };
      if (pgError.code !== '42P01') {
        throw err;
      }
    }

    // Mark content as archived with org_id verification
    await pool.query(
      `UPDATE content_items
      SET status = 'archived',
        archived_at = $1,
        updated_at = $1,
        archived_by = $2
      WHERE id = $3 AND org_id = $4`,
      [now, auth.userId, contentId, auth["orgId"]]
    );

    // Security audit log for archive action
    logger.info('Content archived', { contentId, userId: auth.userId, orgId: auth["orgId"], intentId });

    res.json({
      archived: true,
      archivedAt: now.toISOString(),
      message: 'Content has been archived and can be restored later.',
    });
  } catch (error: unknown) {
    logger.error('Error archiving content', error instanceof Error ? error : undefined, { error: String(error) });

    // SECURITY FIX: P1-HIGH Issue 2 - Sanitize error messages
    const message = error instanceof Error ? error.message : '';
    if (message.includes('DATABASE_NOT_CONFIGURED')) {
      return sendError(res, 503, 'Service unavailable. Database not configured.');
    }

    sendError(res, 500, 'Internal server error. Failed to archive content.');
  }
}
