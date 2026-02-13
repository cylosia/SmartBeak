

import type { NextApiRequest, NextApiResponse } from 'next';

import { requireAuth, validateMethod, sendError } from '../../../lib/auth';
import { pool } from '../../../lib/db';
import { rateLimit } from '../../../lib/rate-limit';
import { getLogger } from '@kernel/logger';

const logger = getLogger('content:unarchive');

/**
* POST /api/content/unarchive
* Restores archived content back to draft status.
* Requires: contentId
* SECURITY FIX: P1-HIGH Issue 4 - IDOR in Content Access
* Verifies org_id matches for all content access
*/

// UUID validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Maximum reason length
const MAX_REASON_LENGTH = 500;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!validateMethod(req, res, ['POST'])) return;

  try {
    // RATE LIMITING: Write endpoint - 30 requests/minute
    const allowed = await rateLimit('content:unarchive', 30, req, res);
    if (!allowed) return;

    // Authenticate request
    const auth = await requireAuth(req, res);
    if (!auth) return;

    const { contentId, reason } = req.body;

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

    // P1-FIX: Wrap SELECT + UPDATE in a transaction with FOR UPDATE to prevent
    // TOCTOU race conditions (concurrent requests bypassing status checks)
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // SECURITY FIX: P1-HIGH Issue 4 - IDOR fix: Verify org_id matches for all content access
      const { rows } = await client.query(
        `SELECT ci["id"], ci.title, ci.status, ci.org_id
         FROM content_items ci
         WHERE ci["id"] = $1
         AND ci.org_id = $2
         AND ci.domain_id IN (
           SELECT domain_id FROM memberships m
           JOIN domain_registry dr ON dr.org_id = m.org_id
           WHERE m.user_id = $3
         )
         FOR UPDATE`,
        [contentId, auth["orgId"], auth.userId]
      );

      if (rows.length === 0) {
        await client.query('ROLLBACK');
        // SECURITY FIX: Return 404 (not 403) to prevent ID enumeration
        logger.warn('IDOR attempt: unarchive content not in org', { userId: auth.userId, contentId });
        return sendError(res, 404, 'Content not found');
      }

      const content = rows[0];

      // Can only unarchive archived content
      if (content.status !== 'archived') {
        await client.query('ROLLBACK');
        return sendError(res, 409, `Cannot unarchive content with status '${content.status}'. Only archived content can be restored.`);
      }

      const now = new Date();

      // Restore to draft status with org_id verification
      await client.query(
        `UPDATE content_items
        SET status = 'draft',
          restored_at = $1,
          restored_reason = $2,
          updated_at = $1,
          archived_at = NULL
        WHERE id = $3 AND org_id = $4`,
        [now, reason || 'User initiated restore', contentId, auth["orgId"]]
      );

      // Record unarchive action in audit log if table exists
      try {
        await client.query(
          `INSERT INTO content_archive_audit (content_id, action, reason, performed_at, org_id)
          VALUES ($1, $2, $3, $4, $5)`,
          [contentId, 'unarchived', reason || 'User initiated restore', now, auth["orgId"]]
        );
      } catch (auditError: unknown) {
        // Audit table may not exist yet - log but don't fail
        const err = auditError as { code?: string; message?: string };
        if (err.code !== '42P01') {
          logger.warn('Audit log error', { message: err.message });
        }
      }

      await client.query('COMMIT');

      res.json({
        restored: true,
        status: 'draft',
        restoredAt: now.toISOString(),
        message: 'Content has been restored to draft status.',
      });
    } catch (txError) {
      await client.query('ROLLBACK').catch(() => {});
      throw txError;
    } finally {
      client.release();
    }
  } catch (error: unknown) {
    logger.error('Content unarchive error', error instanceof Error ? error : new Error(String(error)));

    // SECURITY FIX: P1-HIGH Issue 2 - Sanitize error messages
    const message = error instanceof Error ? error.message : '';
    if (message.includes('DATABASE_NOT_CONFIGURED')) {
      return sendError(res, 503, 'Service unavailable. Database not configured.');
    }

    sendError(res, 500, 'Internal server error. Failed to restore content.');
  }
}
