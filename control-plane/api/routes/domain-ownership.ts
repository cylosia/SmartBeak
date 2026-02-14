

import { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';

import { DomainOwnershipService } from '../../services/domain-ownership';
import { getAuthContext } from '../types';
import { rateLimit } from '../../services/rate-limit';
import { requireRole } from '../../services/auth';
import { errors, sendError } from '@errors/responses';
import { ErrorCodes } from '@errors';

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
    return errors.badRequest(res, 'Invalid domain ID', ErrorCodes.INVALID_PARAMS);
  }

  // Validate body
  const bodyResult = TransferBodySchema.safeParse(req.body);
  if (!bodyResult.success) {
    // M18-FIX: Map to user-friendly messages instead of leaking Zod internals
    return errors.badRequest(res, 'Validation failed: fromOrg and toOrg must be valid UUIDs');
  }

  const { id } = paramsResult.data;
  const { fromOrg, toOrg } = bodyResult.data;

  if (fromOrg !== ctx["orgId"]) {
    return errors.forbidden(res, 'Forbidden: Source organization mismatch');
  }

  // P2-11 FIX: Add error handling to prevent internal details leaking via Fastify default handler
  try {
    await svc.transferDomain(id, fromOrg, toOrg);
    return { ok: true, transferred: true };
  } catch (error) {
    const domainError = error as { code?: string; message?: string };
    if (domainError.code === 'DOMAIN_NOT_FOUND') {
    return errors.notFound(res, 'Domain', ErrorCodes.DOMAIN_NOT_FOUND);
    }
    if (domainError.code === 'DOMAIN_NOT_OWNED') {
    return errors.forbidden(res, 'Domain not owned by source organization', ErrorCodes.DOMAIN_NOT_OWNED);
    }
    return errors.internal(res, 'Failed to transfer domain');
  }
  });
}
