
// Lifecycle stats type

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';

import { MediaLifecycleService } from '../../services/media-lifecycle';
import { rateLimit } from '../../services/rate-limit';
import { requireRole, AuthContext } from '../../services/auth';

export interface LifecycleStats {
  hot: number;
  coldCandidates: number;
}

// Query schema
const QuerySchema = z.object({
  days: z.coerce.number().min(0).max(365).optional().default(30),
});

export type AuthenticatedRequest = FastifyRequest & {
  auth?: AuthContext | undefined;
};

// Define interface for MediaLifecycleService
interface IMediaLifecycleService {
  findColdCandidates(days: number): Promise<string[]>;
  getHotCount(): Promise<number>;
}

/**
* Media lifecycle routes
* Add proper types and error handling
*/
export async function mediaLifecycleRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  const svc = new MediaLifecycleService(pool) as unknown as IMediaLifecycleService;

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
    await rateLimit('admin', 30, req, res);

    // Validate query params
    const queryResult = QuerySchema.safeParse(req.query);
    if (!queryResult.success) {
    res.status(400).send({
    error: 'Validation failed',
    code: 'VALIDATION_ERROR',
    details: queryResult["error"].issues
    });
    return;
    }

    const { days } = queryResult.data;

    // Parse pagination params
    const page = Math.max(1, parseInt((req.query as Record<string, string>)?.["page"] || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt((req.query as Record<string, string>)?.["limit"] || '50', 10)));

    let hot: number;
    let coldCandidates: number;

    try {
    // Use getHotCount and findColdCandidates separately to avoid double call
    hot = await svc.getHotCount();
    coldCandidates = (await svc.findColdCandidates(days)).length;
    } catch (serviceError) {
    console["error"]('[media-lifecycle] Service error:', serviceError);
    res.status(503).send({
    error: 'Service temporarily unavailable',
    message: 'Unable to fetch lifecycle data. Please try again later.'
    });
    return;
    }

    const result: LifecycleStats = {
      hot,
      coldCandidates
    };

    return res.send({
    ...result,
    pagination: {
    }
    });
  } catch (error) {
    console["error"]('[media-lifecycle] Unexpected error:', error);
    // Added return before reply.send()
    return res.status(500).send({
    error: 'Internal server error',
    message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
  });
}
