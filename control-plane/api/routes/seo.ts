


import { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';

import { getLogger } from '@kernel/logger';
import { createRouteErrorHandler } from '@errors';

import { PostgresSeoRepository } from '../../../domains/seo/infra/persistence/PostgresSeoRepository';
import { rateLimit } from '../../services/rate-limit';
import { requireRole, type AuthContext } from '../../services/auth';
import { UpdateSeo } from '../../../domains/seo/application/handlers/UpdateSeo';
import { errors } from '@errors/responses';
import { ErrorCodes } from '@errors';

const logger = getLogger('seo-routes');
const handleError = createRouteErrorHandler({ logger });

async function verifyContentOwnership(userId: string, contentId: string, pool: Pool): Promise<boolean> {
  const result = await pool.query(
  `SELECT 1 FROM contents c
  JOIN memberships m ON m.org_id = c.org_id
  WHERE c["id"] = $1 AND m.user_id = $2
  LIMIT 1`,
  [contentId, userId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function seoRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  const UpdateSeoSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(500),
  });

  const ParamsSchema = z.object({
  id: z.string().uuid(),
  });

  app.post('/seo/:id', async (req, res) => {
  try {
    const ctx = req.auth as AuthContext;
    if (!ctx) {
    return errors.unauthorized(res);
    }
    requireRole(ctx, ['admin', 'editor']);
    await rateLimit('content', 50);

    // Validate params
    const paramsResult = ParamsSchema.safeParse(req.params);
    if (!paramsResult.success) {
    return errors.badRequest(res, 'Invalid content ID', ErrorCodes.INVALID_PARAMS);
    }

    // Validate body
    const bodyResult = UpdateSeoSchema.safeParse(req.body);
    if (!bodyResult.success) {
    return errors.validationFailed(res, bodyResult["error"].issues);
    }

    const { id } = paramsResult.data;
    const { title, description } = bodyResult.data;

    const isAuthorized = await verifyContentOwnership(ctx.userId, id, pool);
    if (!isAuthorized) {
    return errors.notFound(res, 'Content');
    }

    const repo = new PostgresSeoRepository(pool);
    const handler = new UpdateSeo(repo);

    const event = await handler.execute(id, title, description);
    return { ok: true, event };
  } catch (error) {
    logger["error"]('Route error:', error instanceof Error ? error : new Error(String(error)));
    return errors.internal(res);
    return handleError(res, error, 'update SEO metadata');
  }
  });
}
