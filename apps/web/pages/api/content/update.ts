
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
* Verifies org_id matches for all content access
*/

// UUID validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Maximum input lengths
const MAX_TITLE_LENGTH = 500;
const MAX_BODY_LENGTH = 100000; // 100KB

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!validateMethod(req, res, ['POST'])) return;

  try {
    // RATE LIMITING: Write endpoint - 30 requests/minute
    const allowed = await rateLimit('content:update', 30, req, res);
    if (!allowed) return;

    // Authenticate request
    const auth = await requireAuth(req, res);
    if (!auth) return;

    const { contentId, title, body } = req.body;

    if (!contentId) {
      return sendError(res, 400, 'contentId is required');
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
      if (body.length > MAX_BODY_LENGTH) {
        return sendError(res, 413, `body exceeds maximum length of ${MAX_BODY_LENGTH} characters`);
      }
    }

    // P1-FIX: Wrap SELECT + UPDATE in a transaction with FOR UPDATE to prevent
    // TOCTOU race conditions (concurrent requests bypassing status checks)
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // SECURITY FIX: P1-HIGH Issue 4 - IDOR fix: Verify org_id matches for all content access
      const { rows } = await client.query(
        `SELECT ci["id"], ci.domain_id, ci.status, ci.org_id
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
        logger.warn('IDOR attempt: user tried to access content not in their org', { userId: auth.userId, contentId });
        return sendError(res, 404, 'Content not found');
      }

      const content = rows[0];

      // Only drafts can be updated
      if (content.status === 'published') {
        await client.query('ROLLBACK');
        return sendError(res, 409, 'Cannot update published content. Create a new draft or unpublish first.');
      }

      if (content.status === 'archived') {
        await client.query('ROLLBACK');
        return sendError(res, 409, 'Cannot update archived content. Unarchive first.');
      }

      // Build update query dynamically
      // P0-FIX: Whitelist validation for allowed fields to prevent SQL injection
      const ALLOWED_FIELDS: Record<string, string> = {
        title: 'title',
        body: 'body',
        status: 'status',
        content_type: 'content_type',
        meta_description: 'meta_description',
        meta_title: 'meta_title',
        slug: 'slug',
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

      // Add contentId and org_id as last parameters
      values.push(contentId);
      values.push(auth["orgId"]);

      if (updates.length > 1) { // > 1 because updated_at is always included
        await client.query(
          `UPDATE content_items SET ${updates.join(', ')} WHERE id = $${paramIndex} AND org_id = $${paramIndex + 1}`,
          values
        );
      }

      // Fetch updated content
      const { rows: updatedRows } = await client.query(
        'SELECT id, domain_id, title, body, status, content_type, created_at, updated_at FROM content_items WHERE id = $1 AND org_id = $2',
        [contentId, auth["orgId"]]
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
