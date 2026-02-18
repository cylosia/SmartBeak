import crypto from 'crypto';
import type { NextApiRequest, NextApiResponse } from 'next';

import { requireAuth, validateMethod, requireOrgAdmin, sendError } from '../../../lib/auth';
import { withTransaction } from '../../../lib/db';
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
      logger.warn('Non-admin user attempted to transfer domain', { userId: auth.userId });
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

    // Generate transfer receipt before transaction to avoid holding lock longer than needed
    const receipt = crypto.randomBytes(32).toString('hex');
    const transferId = crypto.randomUUID();

    // P0-1 FIX: Wrap ownership check + insert in a single transaction with SELECT FOR UPDATE
    // to eliminate the TOCTOU race between the verification and the insert.
    await withTransaction(async (client) => {
      // Lock the domain row for the duration of this transaction.
      // Any concurrent transfer attempt for the same domain will block here.
      const { rows } = await client.query(
        `SELECT domain_id, org_id FROM domain_registry
         WHERE domain_id = $1
         AND org_id = $2
         FOR UPDATE`,
        [domainId, auth['orgId']]
      );

      if (rows.length === 0) {
        // SECURITY: Return 404 (not 403) to prevent ID enumeration.
        // Throw so the transaction rolls back cleanly.
        const err = Object.assign(new Error('Domain not found'), { statusCode: 404 });
        throw err;
      }

      await client.query(
        `INSERT INTO domain_transfers (id, domain_id, from_user_id, to_user_id, to_org_id, receipt, status, created_at, from_org_id)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW(), $7)`,
        [transferId, domainId, auth.userId, targetUserId || null, targetOrgId || null, receipt, auth['orgId']]
      );
    });

    // Security audit log
    logger.info('Domain transfer initiated', { domainId, userId: auth.userId, orgId: auth['orgId'], transferId });

    res.json({
      transferred: true,
      transferId,
      receipt,
      status: 'pending'
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AuthError') return;

    // Surface 404 thrown from inside the transaction
    if (error instanceof Error && (error as Error & { statusCode?: number })['statusCode'] === 404) {
      logger.warn('User attempted to transfer non-existent or unauthorized domain', { userId: (req.body as Record<string, unknown>)?.['domainId'] });
      return res.status(404).json({ error: 'Domain not found' });
    }

    logger.error('Failed to initiate domain transfer', error instanceof Error ? error : undefined, { error: String(error) });

    // SECURITY FIX: P1-HIGH Issue 2 - Sanitize error messages
    sendError(res, 500, 'Internal server error. Failed to initiate domain transfer');
  }
}
