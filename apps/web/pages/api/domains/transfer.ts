import crypto from 'crypto';
import type { NextApiRequest, NextApiResponse } from 'next';

import { requireAuth, validateMethod, requireOrgAdmin, sendError } from '../../../lib/auth';
import { getPoolInstance } from '../../../lib/db';
import { rateLimit } from '../../../lib/rate-limit';
import { getLogger } from '@kernel/logger';

const logger = getLogger('DomainTransfer');

/**
* POST /api/domains/transfer
* Initiate domain ownership transfer
* SECURITY FIX: P1-HIGH Issue 4 - IDOR in Content Access
* Verifies org_id matches for all domain access
*/

// UUID validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!validateMethod(req, res, ['POST'])) return;

  try {
    // RATE LIMITING: Write/transfer endpoint - 5 requests/minute (very sensitive)
    const allowed = await rateLimit('domains:transfer', 5, req, res);
    if (!allowed) return;

    const auth = await requireAuth(req, res);
    if (!auth) return;

    // AUTHORIZATION CHECK: Require org admin for domain transfer
    try {
      await requireOrgAdmin(auth, res);
    } catch {
      logger.warn({ userId: auth.userId }, 'Non-admin user attempted to transfer domain');
      return;
    }

    const { domainId, targetUserId, targetOrgId } = req.body;

    if (!domainId) {
      return sendError(res, 400, 'domainId is required');
    }

    // Validate UUID format
    if (!UUID_REGEX.test(domainId)) {
      return sendError(res, 400, 'Invalid domainId format. Expected UUID.');
    }

    if (targetUserId && !UUID_REGEX.test(targetUserId)) {
      return sendError(res, 400, 'Invalid targetUserId format. Expected UUID.');
    }

    if (targetOrgId && !UUID_REGEX.test(targetOrgId)) {
      return sendError(res, 400, 'Invalid targetOrgId format. Expected UUID.');
    }

    if (!targetUserId && !targetOrgId) {
      return sendError(res, 400, 'targetUserId or targetOrgId is required');
    }

    // SECURITY FIX: P1-HIGH Issue 4 - Verify domain belongs to user's org
    // P0-3 FIX: Wrap verification + insert in a transaction to prevent TOCTOU race
    const pool = await getPoolInstance();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // SELECT FOR UPDATE prevents concurrent transfers of the same domain
      const { rows } = await client.query(
        `SELECT domain_id, org_id FROM domain_registry
         WHERE domain_id = $1
         AND org_id = $2
         FOR UPDATE`,
        [domainId, auth["orgId"]]
      );

      if (rows.length === 0) {
        await client.query('ROLLBACK');
        // SECURITY: Return 404 (not 403) to prevent ID enumeration
        logger.warn({ userId: auth.userId, domainId }, 'User attempted to transfer non-existent or unauthorized domain');
        return res.status(404).json({ error: 'Domain not found' });
      }

      const domain = rows[0];

      // Double-check org_id matches
      if (domain.org_id !== auth["orgId"]) {
        await client.query('ROLLBACK');
        logger.warn({ domainOrgId: domain.org_id, userOrgId: auth["orgId"] }, 'Domain org_id does not match user org_id');
        return res.status(404).json({ error: 'Domain not found' });
      }

      // Check for existing pending transfers to prevent duplicates
      const { rows: existingTransfers } = await client.query(
        `SELECT id FROM domain_transfers
         WHERE domain_id = $1 AND status = 'pending'`,
        [domainId]
      );

      if (existingTransfers.length > 0) {
        await client.query('ROLLBACK');
        return sendError(res, 409, 'A pending transfer already exists for this domain');
      }

      // Generate transfer receipt
      const receipt = crypto.randomBytes(32).toString('hex');
      const transferId = crypto.randomUUID();

      // Record transfer initiation
      await client.query(
        `INSERT INTO domain_transfers (id, domain_id, from_user_id, to_user_id, to_org_id, receipt, status, created_at, from_org_id)
        VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW(), $7)`,
        [transferId, domainId, auth.userId, targetUserId || null, targetOrgId || null, receipt, auth["orgId"]]
      );

      await client.query('COMMIT');

      // Security audit log
      logger.info({ domainId, userId: auth.userId, orgId: auth["orgId"], transferId }, 'Domain transfer initiated');

      res.json({
        transferred: true,
        transferId,
        receipt,
        status: 'pending'
      });
    } catch (txError) {
      await client.query('ROLLBACK').catch((rollbackErr: unknown) => {
        logger.error({ error: rollbackErr }, 'Failed to rollback domain transfer transaction');
      });
      throw txError;
    } finally {
      client.release();
    }
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AuthError') return;
    logger.error({ error }, 'Failed to initiate domain transfer');

    // SECURITY FIX: P1-HIGH Issue 2 - Sanitize error messages
    const sanitized = 'Internal server error. Failed to initiate domain transfer';
    sendError(res, 500, sanitized);
  }
}
