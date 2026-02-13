
// Lifecycle stats type

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';

import { getLogger } from '@kernel/logger';
import { MediaLifecycleService } from '../../services/media-lifecycle';
import { requireRole, AuthContext } from '../../services/auth';

// P1-10 FIX: Use structured logger instead of console["error"]
const logger = getLogger('media-lifecycle');

export interface LifecycleStats {
  hot: number;
  coldCandidates: number;
}

// P3-7 FIX: Include page and limit in Zod schema instead of manual parseInt
const QuerySchema = z.object({
  days: z.coerce.number().min(0).max(365).optional().default(30),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});

export type AuthenticatedRequest = FastifyRequest & {
  auth?: AuthContext | undefined;
};

/**
* Media lifecycle routes
* P0-2 FIX: Removed unsafe `as unknown as IMediaLifecycleService` cast.
* P1-11 FIX: Use MediaLifecycleService directly (now has getHotCount).
* P2-1 FIX: Use countColdCandidates() instead of loading all IDs to count.
*/
export async function mediaLifecycleRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  const svc = new MediaLifecycleService(pool);

  app.get('/admin/media/lifecycle', async (
  req: FastifyRequest,
  res: FastifyReply
  ): Promise<void> => {
  try {
    const { auth: ctx } = req as AuthenticatedRequest;
    if (!ctx) {
    return res.status(401).send({ error: 'Unauthorized' });
    }
    requireRole(ctx, ['owner', 'admin']);

    // Validate query params (P3-7 FIX: pagination now in Zod schema)
    const queryResult = QuerySchema.safeParse(req.query);
    if (!queryResult.success) {
    return res.status(400).send({
    error: 'Validation failed',
    code: 'VALIDATION_ERROR',
    details: queryResult["error"].issues
    });
    }

    const { days, page, limit } = queryResult.data;

    let hot: number;
    let coldCandidates: number;

    try {
    // P0-2 FIX: Call getHotCount() directly (now exists on service)
    // P2-1 FIX: Use countColdCandidates() instead of loading all IDs
    hot = await svc.getHotCount();
    coldCandidates = await svc.countColdCandidates(days);
    } catch (serviceError) {
    // P1-10 FIX: Use structured logger
    logger.error('[media-lifecycle] Service error:', serviceError instanceof Error ? serviceError : new Error(String(serviceError)));
    return res.status(503).send({
    error: 'Service temporarily unavailable',
    code: 'SERVICE_UNAVAILABLE'
    });
    }

    const result: LifecycleStats = {
      hot,
      coldCandidates
    };

    return res.send({
    ...result,
    pagination: {
    page,
    limit,
    }
    });
  } catch (error) {
    // P1-10 FIX: Use structured logger
    logger.error('[media-lifecycle] Unexpected error:', error instanceof Error ? error : new Error(String(error)));
    // P1-1 FIX: Do not leak internal error details to clients
    return res.status(500).send({
    error: 'Internal server error',
    code: 'INTERNAL_ERROR'
    });
  }
  });
}
