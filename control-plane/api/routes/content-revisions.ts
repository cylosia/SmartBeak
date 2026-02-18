

import { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';

import { DomainOwnershipService } from '../../services/domain-ownership';
import { getAuthContext } from '../types';
import { PostgresContentRevisionRepository } from '../../../domains/content/infra/persistence/PostgresContentRevisionRepository';
import { rateLimit } from '../../services/rate-limit';
import { requireRole } from '../../services/auth';
import { errors } from '@errors/responses';
import { ErrorCodes } from '@errors';

export async function contentRevisionRoutes(app: FastifyInstance, pool: Pool) {
  const ownership = new DomainOwnershipService(pool);

  const ParamsSchema = z.object({
  id: z.string().uuid(),
  });

  app.get('/content/:id/revisions', async (req, res) => {
  // P0-005 FIX: Rate limit per IP, not per static key 'content'.
  // rateLimit('content', 50) used a single shared bucket for ALL users,
  // allowing one user to exhaust the limit for everyone on the platform.
  await rateLimit(req.ip || 'unknown', 50, 'content.revisions');
  const ctx = getAuthContext(req);
  requireRole(ctx, ['admin','editor','viewer']);

  // Validate params
  const paramsResult = ParamsSchema.safeParse(req.params);
  if (!paramsResult.success) {
    return errors.badRequest(res, 'Invalid content ID', ErrorCodes.INVALID_PARAMS);
  }

  const { id } = paramsResult.data;

  // Check if content exists and user has access
  const { rows } = await pool.query(
    `SELECT domain_id FROM content_items
    WHERE id = $1 AND domain_id IN (
    SELECT domain_id FROM memberships m
    JOIN domain_registry dr ON dr.org_id = m.org_id
    WHERE m.user_id = $2
    )`,
    [id, ctx.userId]
  );

  if (rows.length === 0) {
    return errors.notFound(res, 'Content', ErrorCodes.CONTENT_NOT_FOUND);
  }

  await ownership.assertOrgOwnsDomain(ctx["orgId"], rows[0].domain_id);

  const repo = new PostgresContentRevisionRepository(pool);
  const revisions = await repo.listByContent(id, 20);
  return { revisions };
  });
}
