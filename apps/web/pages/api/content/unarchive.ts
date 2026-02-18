

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
* Verifies domain membership for all content access (content_items has no org_id column;
* org scope is enforced through the domain_id → memberships → domain_registry join).
*/

// UUID validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Maximum reason length
const MAX_REASON_LENGTH = 500;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!validateMethod(req, res, ['POST'])) return;

  try {
    // Authenticate before rate-limiting so the limit can be scoped per-user.
    // A global key ('content:unarchive') lets one user exhaust the quota for
    // all users; per-user keying eliminates that DoS vector.
    const auth = await requireAuth(req, res);
    if (!auth) return;

    const allowed = await rateLimit(`content:unarchive:${auth.userId}`, 30, req, res);
    if (!allowed) return;

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

      // SECURITY FIX: P1-HIGH Issue 4 - IDOR fix: Verify domain membership for content access.
      // content_items has no org_id column; access is scoped by verifying that the item's
      // domain_id is reachable through the current user's org memberships.
      // P0-FIX: ci["id"] was invalid PostgreSQL syntax (array subscript); corrected to ci.id.
      const { rows } = await client.query(
        `SELECT ci.id, ci.title, ci.status
         FROM content_items ci
         WHERE ci.id = $1
         AND ci.domain_id IN (
           SELECT domain_id FROM memberships m
           JOIN domain_registry dr ON dr.org_id = m.org_id
           WHERE m.user_id = $2
         )
         FOR UPDATE`,
        [contentId, auth.userId]
      );

      if (rows.length === 0) {
        await client.query('ROLLBACK');
        // SECURITY FIX: Return 404 (not 403) to prevent ID enumeration
        logger.warn('IDOR attempt: user tried to unarchive content not in their org', { userId: auth.userId, contentId });
        return sendError(res, 404, 'Content not found');
      }

      const content = rows[0];

      // Can only unarchive archived content
      if (content['status'] !== 'archived') {
        await client.query('ROLLBACK');
        return sendError(res, 409, `Cannot unarchive content with status '${content['status']}'. Only archived content can be restored.`);
      }

      const now = new Date();
      const restoreReason = reason || 'User initiated restore';

      // Restore to draft status.
      // P0-FIX: Removed restored_at and restored_reason — those columns do not exist
      // in content_items. Removed AND org_id = $4 — content_items has no org_id column.
      await client.query(
        `UPDATE content_items
        SET status = 'draft',
          updated_at = $1,
          archived_at = NULL
        WHERE id = $2`,
        [now, contentId]
      );

      // Record unarchive action in audit log.
      // The content_archive_audit table exists and has: content_id, action, reason,
      // performed_by, performed_at. There is no org_id column on this table.
      // Only ignore error 42P01 (undefined_table) — the table may not yet exist
      // in environments where the migration hasn't run. Any other failure
      // (permissions, constraint violation, disk full) re-throws so the
      // transaction is rolled back and no unarchive occurs without a trace.
      try {
        await client.query(
          `INSERT INTO content_archive_audit (content_id, action, reason, performed_by, performed_at)
          VALUES ($1, $2, $3, $4, $5)`,
          [contentId, 'unarchived', restoreReason, auth.userId, now]
        );
      } catch (auditError: unknown) {
        const err = auditError as { code?: string };
        if (err.code === '42P01') {
          logger.warn('content_archive_audit table missing; skipping audit log', { contentId });
        } else {
          // Re-throw to roll back the transaction — content must not be unarchived
          // without a corresponding audit record.
          throw auditError;
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
    logger.error('Error unarchiving content', error instanceof Error ? error : undefined, { error: String(error) });

    // SECURITY FIX: P1-HIGH Issue 2 - Sanitize error messages
    const message = error instanceof Error ? error.message : '';
    if (message.includes('DATABASE_NOT_CONFIGURED')) {
      return sendError(res, 503, 'Service unavailable. Database not configured.');
    }

    sendError(res, 500, 'Internal server error. Failed to restore content.');
  }
}
