

import { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';

import { AnalyticsReadModel } from '../../services/analytics-read-model';
import { getAuthContext } from '../types';
import { rateLimit } from '../../services/rate-limit';
import { requireRole } from '../../services/auth';
import { errors } from '@errors/responses';
import { ErrorCodes } from '@errors';

export async function analyticsRoutes(app: FastifyInstance, pool: Pool) {
  const rm = new AnalyticsReadModel(pool);

  const ParamsSchema = z.object({
  id: z.string().uuid(),
  });

  app.get('/analytics/content/:id', async (req, res) => {
  // SECURITY FIX: Rate limit BEFORE auth to prevent DoS
  await rateLimit('analytics', 50);
  const ctx = getAuthContext(req);
  requireRole(ctx, ['admin','editor','viewer']);

  // Validate params
  const paramsResult = ParamsSchema.safeParse(req.params);
  if (!paramsResult.success) {
    return errors.badRequest(res, 'Invalid content ID', ErrorCodes.INVALID_PARAMS);
  }

  const { id } = paramsResult.data;

  // SECURITY FIX: Verify content ownership before returning stats
  const { rows } = await pool.query(
    'SELECT 1 FROM content c JOIN domains d ON c.domain_id = d.id WHERE c.id = $1 AND d.org_id = $2',
    [id, ctx["orgId"]]
  );
  if (rows.length === 0) {
    return errors.notFound(res, 'Content', ErrorCodes.CONTENT_NOT_FOUND);
  }

  return rm.getContentStats(id);
  });
}
