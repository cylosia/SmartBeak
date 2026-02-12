

import { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';

import { DomainOwnershipService } from '../../services/domain-ownership';
import { getAuthContext } from '../types';
import { rateLimit } from '../../services/rate-limit';
import { requireRole } from '../../services/auth';

export async function domainOwnershipRoutes(app: FastifyInstance, pool: Pool) {
  const svc = new DomainOwnershipService(pool);

  const TransferParamsSchema = z.object({
  id: z.string().uuid(),
  });

  const TransferBodySchema = z.object({
  fromOrg: z.string().uuid(),
  toOrg: z.string().uuid(),
  });

  app.post('/domains/:id/transfer', async (req, res) => {
  const ctx = getAuthContext(req);
  requireRole(ctx, ['owner']);
  await rateLimit('domain', 10);

  // Validate params
  const paramsResult = TransferParamsSchema.safeParse(req.params);
  if (!paramsResult.success) {
    return res.status(400).send({
    error: 'Invalid domain ID',
    code: 'INVALID_ID',
    });
  }

  // Validate body
  const bodyResult = TransferBodySchema.safeParse(req.body);
  if (!bodyResult.success) {
    // M18-FIX: Map to user-friendly messages instead of leaking Zod internals
    return res.status(400).send({
    error: 'Validation failed: fromOrg and toOrg must be valid UUIDs',
    code: 'VALIDATION_ERROR',
    });
  }

  const { id } = paramsResult.data;
  const { fromOrg, toOrg } = bodyResult.data;

  if (fromOrg !== ctx["orgId"]) {
    return res.status(403).send({
    error: 'Forbidden: Source organization mismatch',
    code: 'ORG_MISMATCH',
    });
  }

  await svc.transferDomain(id, fromOrg, toOrg);
  return { ok: true, transferred: true };
  });
}
