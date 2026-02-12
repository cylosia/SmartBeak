import crypto from 'crypto';
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';

import { requireAuth, validateMethod, requireOrgAdmin, sendError } from '../../../lib/auth';
import { getPoolInstance } from '../../../lib/db';
import { rateLimit } from '../../../lib/rate-limit';
import { getLogger } from '@kernel/logger';

const logger = getLogger('DomainTransfer');

/**
* POST /api/domains/transfer
* Initiate domain ownership transfer
* SECURITY FIX: P0-3 - Wrapped in transaction with SELECT FOR UPDATE to prevent TOCTOU race
* SECURITY FIX: P1-HIGH Issue 4 - IDOR in Content Access
* Verifies org_id matches for all domain access
*/

// P2-8 FIX: Zod schema for request body validation (replaces manual checks)
const TransferRequestSchema = z.object({
  domainId: z.string().uuid('domainId must be a valid UUID'),
  targetUserId: z.string().uuid('targetUserId must be a valid UUID').optional(),
  targetOrgId: z.string().uuid('targetOrgId must be a valid UUID').optional(),
}).strict().refine(
  data => data.targetUserId || data.targetOrgId,
  { message: 'targetUserId or targetOrgId is required' }
);

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

    // P2-8 FIX: Validate request body with Zod schema
    const parseResult = TransferRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendError(res, 400, parseResult.error.issues[0]?.message ?? 'Invalid request body');
    }

    const { domainId, targetUserId, targetOrgId } = parseResult.data;

    // P0-3 FIX: Wrap ownership check and transfer INSERT in a single transaction
    // with SELECT ... FOR UPDATE to prevent TOCTOU race condition
    const pool = await getPoolInstance();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // SELECT ... FOR UPDATE acquires a row lock, preventing concurrent transfers
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

      // Generate transfer receipt
      const receipt = crypto.randomBytes(32).toString('hex');
      const transferId = crypto.randomUUID();

      // Record transfer initiation within same transaction
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
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        logger.error({ error: rollbackError }, 'Failed to rollback domain transfer transaction');
      }
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
