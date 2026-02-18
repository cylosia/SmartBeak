

import { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';

import { DomainOwnershipService, DomainError } from '../../services/domain-ownership';
import { getAuthContext } from '../types';
import { rateLimit } from '../../services/rate-limit';
import { requireRole } from '../../services/auth';
import { errors } from '@errors/responses';
import { ErrorCodes } from '@errors';
import { getLogger } from '@kernel/logger';

const logger = getLogger('domain-ownership-routes');

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
    try {
      const ctx = getAuthContext(req);
      requireRole(ctx, ['owner']);

      // DO-1-FIX (P0): Was rateLimit('domain', 10) — shared global key.
      // Any authenticated user could exhaust the limit for ALL orgs with 10 requests,
      // blocking all domain transfers system-wide (trivial DoS on M&A operations).
      // Now keyed per org with a dedicated namespace.
      // DO-2-FIX (P1): rateLimit throws synchronously when limit exceeded;
      // catch it to return structured 429 instead of raw Fastify 500.
      try {
        rateLimit(ctx['orgId'], 10, 'domain-transfer');
      } catch {
        return errors.rateLimited(res, 60, 'Too many transfer requests');
      }

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

      await svc.transferDomain(id, fromOrg, toOrg);
      return { ok: true, transferred: true };
    } catch (error) {
      // DO-4-FIX (P1): Use instanceof DomainError instead of unsafe `as` cast.
      // The prior `error as { code?: string }` cast would silently evaluate .code as
      // undefined for non-DomainError throws, causing ownership/not-found errors to
      // fall through to errors.internal — masking real errors as generic 500s.
      if (error instanceof DomainError) {
        if (error.code === 'DOMAIN_NOT_FOUND') {
          return errors.notFound(res, 'Domain', ErrorCodes.DOMAIN_NOT_FOUND);
        }
        if (error.code === 'DOMAIN_NOT_OWNED') {
          return errors.forbidden(res, 'Domain not owned by source organization', ErrorCodes.DOMAIN_NOT_OWNED);
        }
        // P1-LOG-FIX: Log unexpected DomainError codes so they are not silently swallowed.
        logger.error('Unexpected DomainError code during transfer', error, { code: error.code });
      } else {
        // P1-LOG-FIX: Log all non-DomainError unexpected errors. Previously these fell
        // through silently to errors.internal with no structured log entry, making
        // database errors, network failures, and pool exhaustion invisible in production.
        logger.error('Unexpected error during domain transfer', error instanceof Error ? error : new Error(String(error)));
      }
      return errors.internal(res, 'Failed to transfer domain');
    }
  });
}
