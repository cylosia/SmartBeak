

import { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';

import { DomainOwnershipService } from '../../services/domain-ownership';
import { getAuthContext } from '../types';
import { rateLimit } from '../../services/rate-limit';
import { requireRole } from '../../services/auth';
import { errors } from '@errors/responses';
import { ErrorCodes } from '@errors';

export async function domainOwnershipRoutes(app: FastifyInstance, pool: Pool) {
  const svc = new DomainOwnershipService(pool);

  // DO-6-FIX (P3): Added .strict() to reject extra request properties per CLAUDE.md
  const TransferParamsSchema = z.object({
    id: z.string().uuid(),
  }).strict();

  const TransferBodySchema = z.object({
    fromOrg: z.string().uuid(),
    toOrg: z.string().uuid(),
  }).strict();

  app.post('/domains/:id/transfer', async (req, res) => {
    const ctx = getAuthContext(req);
    requireRole(ctx, ['owner']);

    // DO-1-FIX (P0): Was rateLimit('domain', 10) — shared global key.
    // Any authenticated user could exhaust the limit for ALL orgs with 10 requests,
    // blocking all domain transfers system-wide (trivial DoS on M&A operations).
    // Now keyed per org with a dedicated namespace.
    rateLimit(ctx['orgId'], 10, 'domain-transfer');

    // Validate params
    const paramsResult = TransferParamsSchema.safeParse(req.params);
    if (!paramsResult.success) {
      return errors.badRequest(res, 'Invalid domain ID', ErrorCodes.INVALID_PARAMS);
    }

    // DO-7-FIX (P3): Pass Zod issue details for machine-readable client errors
    const bodyResult = TransferBodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      return errors.validationFailed(res, bodyResult.error.issues);
    }

    const { id } = paramsResult.data;
    const { fromOrg, toOrg } = bodyResult.data;

    if (fromOrg !== ctx['orgId']) {
      return errors.forbidden(res, 'Forbidden: Source organization mismatch');
    }

    // P2-SELF-TRANSFER-FIX: Reject transfers where source and destination are the
    // same org. Without this check the transfer succeeds as a no-op but still
    // creates a spurious audit log entry in domain_transfer_log, polluting the
    // audit trail and making it impossible to distinguish real ownership changes.
    if (fromOrg === toOrg) {
      return errors.badRequest(res, 'Cannot transfer domain to the same organization');
    }

    await svc.transferDomain(id, fromOrg, toOrg);
    return { ok: true, transferred: true };
  });
}
