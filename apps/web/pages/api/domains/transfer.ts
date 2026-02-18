import crypto from 'crypto';
import { z } from 'zod';
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

// Zod schema — .strict() blocks prototype-poisoned extra keys, .uuid() enforces format
const TransferBodySchema = z.object({
  domainId: z.string().uuid('domainId must be a valid UUID'),
  targetUserId: z.string().uuid('targetUserId must be a valid UUID').optional(),
  targetOrgId: z.string().uuid('targetOrgId must be a valid UUID').optional(),
}).strict().refine(
  (d) => d.targetUserId !== undefined || d.targetOrgId !== undefined,
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
      logger.warn('Non-admin user attempted to transfer domain', { userId: auth.userId });
      return;
    }

    // SECURITY FIX T-8: Enforce Content-Type before body parse
    if (!req.headers['content-type']?.includes('application/json')) {
      return sendError(res, 415, 'Content-Type must be application/json');
    }

    // SECURITY FIX T-1: Validate request body with Zod schema
    const bodyResult = TransferBodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      return sendError(res, 400, bodyResult.error.errors[0]?.message ?? 'Invalid request body');
    }

    const { domainId, targetUserId, targetOrgId } = bodyResult.data;

    // Generate transfer receipt and ID before acquiring DB connection
    const receipt = crypto.randomBytes(32).toString('hex');
    const transferId = crypto.randomUUID();

    // SECURITY FIX T-2: Wrap SELECT + INSERT in a transaction to eliminate TOCTOU race.
    // SELECT ... FOR UPDATE locks the domain row, preventing concurrent conflicting transfers.
    const pool = await getPoolInstance();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows } = await client.query(
        `SELECT domain_id FROM domain_registry
         WHERE domain_id = $1
         AND org_id = $2
         FOR UPDATE`,
        [domainId, auth['orgId']]
      );

      if (rows.length === 0) {
        await client.query('ROLLBACK');
        // SECURITY: Return 404 (not 403) to prevent ID enumeration
        logger.warn('User attempted to transfer non-existent or unauthorized domain', { userId: auth.userId, domainId });
        return res.status(404).json({ error: 'Domain not found' });
      }

      // Record transfer initiation inside the same transaction
      await client.query(
        `INSERT INTO domain_transfers (id, domain_id, from_user_id, to_user_id, to_org_id, receipt, status, created_at, from_org_id)
        VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW(), $7)`,
        [transferId, domainId, auth.userId, targetUserId ?? null, targetOrgId ?? null, receipt, auth['orgId']]
      );

      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK').catch((rollbackErr: unknown) => {
        logger.error('Failed to rollback domain transfer transaction', rollbackErr instanceof Error ? rollbackErr : new Error(String(rollbackErr)));
      });
      throw txErr;
    } finally {
      client.release();
    }

    // Security audit log — receipt is NOT logged (bearer-token equivalent)
    logger.info('Domain transfer initiated', { domainId, userId: auth.userId, orgId: auth['orgId'], transferId });

    res.json({
      transferred: true,
      transferId,
      receipt,
      status: 'pending'
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AuthError') return;
    logger.error('Failed to initiate domain transfer', error instanceof Error ? error : undefined, { error: String(error) });

    // SECURITY FIX: P1-HIGH Issue 2 - Sanitize error messages
    const sanitized = 'Internal server error. Failed to initiate domain transfer';
    sendError(res, 500, sanitized);
  }
}
