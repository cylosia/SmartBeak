


import { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';

import { getLogger } from '@kernel/logger';

import { PostgresSeoRepository } from '../../../domains/seo/infra/persistence/PostgresSeoRepository';
import { rateLimit } from '../../services/rate-limit';
import { requireRole } from '../../services/auth';
import { getAuthContext } from '../types';
import { UpdateSeo } from '../../../domains/seo/application/handlers/UpdateSeo';
import { errors } from '@errors/responses';
import { ErrorCodes } from '@errors';

const logger = getLogger('seo-routes');

async function verifyContentOwnership(userId: string, contentId: string, pool: Pool): Promise<boolean> {
  const result = await pool.query(
  `SELECT 1 FROM content_items c
  JOIN domains d ON c.domain_id = d.id
  JOIN memberships m ON m.org_id = d.org_id
  WHERE c.id = $1 AND m.user_id = $2
  LIMIT 1`,
  [contentId, userId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function seoRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  // P2-FIX: Added .strict() — without it, extra body fields are silently ignored,
  // masking client bugs and potential injection via unexpected properties.
  const UpdateSeoSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(500),
  }).strict();

  const ParamsSchema = z.object({
  id: z.string().uuid(),
  });

  app.post('/seo/:id', async (req, res) => {
  try {
    await rateLimit('seo', 50);
    const ctx = getAuthContext(req);
    requireRole(ctx, ['admin', 'editor']);

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

    // P0-FIX: Discard the internal domain event object. Returning it to the client
    // leaks internal domain structure (entity IDs, aggregate state, event metadata).
    // Route handlers must only expose public API surface.
    await handler.execute(id, title, description);
    return res.send({ ok: true });
  } catch (error) {
    logger.error('[seo] Route error', error instanceof Error ? error : new Error(String(error)));
    return errors.internal(res);
  }
  });
}
