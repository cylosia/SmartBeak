
import type { NextApiRequest, NextApiResponse } from 'next';

import { requireAuth, validateMethod, sendError } from '../../../lib/auth';
import { pool } from '../../../lib/db';
import { rateLimit } from '../../../lib/rate-limit';
import { getLogger } from '@kernel/logger';

const logger = getLogger('content:update');

/**
* POST /api/content/update
* Updates draft content only. Published content cannot be modified directly.
* Requires: contentId, updates (title, body, etc.)
* SECURITY FIX: P1-HIGH Issue 4 - IDOR in Content Access
* Verifies domain membership for all content access (content_items has no org_id column;
* org scope is enforced through the domain_id → memberships → domain_registry join).
*/

// UUID validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Maximum input lengths
const MAX_TITLE_LENGTH = 500;
// P0-FIX: Use byte length (not char length) so multi-byte Unicode cannot exceed column storage.
// 100,000 UTF-8 bytes matches the documented "100KB" limit.
const MAX_BODY_BYTES = 100_000;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!validateMethod(req, res, ['POST'])) return;

  try {
    // Authenticate before rate-limiting so the limit can be scoped per-user.
    // A global key ('content:update') lets one user exhaust the quota for
    // all users; per-user keying eliminates that DoS vector.
    const auth = await requireAuth(req, res);
    if (!auth) return;

    const allowed = await rateLimit(`content:update:${auth.userId}`, 30, req, res);
    if (!allowed) return;

    const { contentId, title, body } = req.body;

    if (!contentId) {
      return sendError(res, 400, 'contentId is required');
    }

    // Require at least one real field — otherwise the UPDATE is skipped but the
    // handler would still return { updated: true }, desynchronising client state.
    if (title === undefined && body === undefined) {
      return sendError(res, 400, 'At least one field (title or body) must be provided');
    }

    // Validate UUID format
    if (!UUID_REGEX.test(contentId)) {
      return sendError(res, 400, 'Invalid contentId format. Expected UUID.');
    }

    // SECURITY FIX: P1-HIGH Issue 7 - Missing Input Length Validation
    if (title !== undefined) {
      if (typeof title !== 'string') {
        return sendError(res, 400, 'title must be a string');
      }
      if (title.length > MAX_TITLE_LENGTH) {
        return sendError(res, 400, `title must be less than ${MAX_TITLE_LENGTH} characters`);
      }
    }

    if (body !== undefined) {
      if (typeof body !== 'string') {
        return sendError(res, 400, 'body must be a string');
      }
      // P0-FIX: Measure UTF-8 bytes, not JS character count, to match DB storage limits.
      if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
        return sendError(res, 413, `body exceeds maximum length of ${MAX_BODY_BYTES} bytes`);
      }
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
        `SELECT ci.id, ci.domain_id, ci.status
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
        logger.warn('IDOR attempt: user tried to access content not in their org', { userId: auth.userId, contentId });
        return sendError(res, 404, 'Content not found');
      }

      const content = rows[0];

      // Only drafts can be updated
      if (content['status'] === 'published') {
        await client.query('ROLLBACK');
        return sendError(res, 409, 'Cannot update published content. Create a new draft or unpublish first.');
      }

      if (content['status'] === 'archived') {
        await client.query('ROLLBACK');
        return sendError(res, 409, 'Cannot update archived content. Unarchive first.');
      }

      // Build update query dynamically
      // P0-FIX: Whitelist validation for allowed fields to prevent SQL injection.
      // Only title and body are accepted from the request body; other fields in
      // ALLOWED_FIELDS are reserved for future use.
      const ALLOWED_FIELDS: Record<string, string> = {
        title: 'title',
        body: 'body',
      };

      const updates: string[] = [];
      const values: unknown[] = [];
      let paramIndex = 1;

      // P0-FIX: Validate field against whitelist before adding to query
      const addUpdateField = (fieldName: string, value: unknown) => {
        const columnName = ALLOWED_FIELDS[fieldName];
        if (!columnName) {
          throw new Error(`Invalid field: ${fieldName}`);
        }
        updates.push(`${columnName} = $${paramIndex++}`);
        values.push(value);
      };

      if (title !== undefined) {
        addUpdateField('title', title);
      }

      if (body !== undefined) {
        addUpdateField('body', body);
      }

      // Always update the updated_at timestamp
      updates.push(`updated_at = $${paramIndex++}`);
      values.push(new Date());

      // Add contentId as the last WHERE parameter.
      // P0-FIX: Removed AND org_id = $N — content_items has no org_id column.
      // Authorization is already enforced by the SELECT FOR UPDATE above.
      values.push(contentId);

      if (updates.length > 1) { // > 1 because updated_at is always included
        await client.query(
          `UPDATE content_items SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
          values
        );
      }

      // Record the update in the audit log.
      // 42P01 = undefined_table: tolerated while the migration hasn't run yet.
      // Any other failure re-throws so the transaction is rolled back — content
      // must not be silently modified without a corresponding audit record.
      try {
        await client.query(
          `INSERT INTO content_audit_log
             (content_id, action, changed_fields, performed_by, performed_at)
           VALUES ($1, 'updated', $2, $3, $4)`,
          [
            contentId,
            JSON.stringify({ title: title !== undefined, body: body !== undefined }),
            auth.userId,
            new Date(),
          ]
        );
      } catch (auditError: unknown) {
        const err = auditError as { code?: string };
        if (err.code === '42P01') {
          logger.warn('content_audit_log table missing; skipping audit log', { contentId });
        } else {
          throw auditError;
        }
      }

      // Fetch updated content.
      // P0-FIX: Removed AND org_id = $2 — content_items has no org_id column.
      const { rows: updatedRows } = await client.query(
        'SELECT id, domain_id, title, body, status, content_type, created_at, updated_at FROM content_items WHERE id = $1',
        [contentId]
      );

      await client.query('COMMIT');

      res.json({
        updated: true,
        content: updatedRows[0],
      });
    } catch (txError) {
      await client.query('ROLLBACK').catch(() => {});
      throw txError;
    } finally {
      client.release();
    }
  } catch (error: unknown) {
    logger.error('Error updating content', error instanceof Error ? error : undefined, { error: String(error) });

    if (error instanceof Error && error.message?.includes('DATABASE_NOT_CONFIGURED')) {
      return sendError(res, 503, 'Service unavailable. Database not configured.');
    }

    // SECURITY FIX: P1-HIGH Issue 2 - Sanitize error messages
    sendError(res, 500, 'Internal server error. Failed to update content.');
  }
}
