
// Lifecycle stats type

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';

import { getLogger } from '@kernel/logger';
import { MediaLifecycleService } from '../../services/media-lifecycle';
import { requireRole, RoleAccessError, AuthContext } from '../../services/auth';
import { checkRateLimitAsync } from '../../services/rate-limit';
import { errors } from '@errors/responses';

const logger = getLogger('media-lifecycle');

export interface LifecycleStats {
  hot: number;
  coldCandidates: number;
}

// P2-1 FIX: Add .strict() to reject extra properties
// P2-3 FIX: Removed unused pagination params from GET endpoint that doesn't paginate
const QuerySchema = z.object({
  days: z.coerce.number().min(0).max(365).optional().default(30),
}).strict();

export type AuthenticatedRequest = FastifyRequest & {
  auth?: AuthContext | undefined;
};

/**
* Media lifecycle routes
* P0-3 FIX: Catch RoleAccessError and return 403 instead of 500.
* P2-22 FIX: Add rate limiting to admin endpoints.
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
        return errors.unauthorized(res);
      }
      requireRole(ctx, ['owner', 'admin']);
      // FIX(P0): Use checkRateLimitAsync to avoid double-send (same issue as media.ts)
      const rlResult = await checkRateLimitAsync(`admin:media:${ctx.userId}`, 'admin.media');
      if (!rlResult.allowed) {
        return res.status(429).send({ error: 'Too many requests', retryAfter: Math.ceil((rlResult.resetTime - Date.now()) / 1000) });
      }

      const queryResult = QuerySchema.safeParse(req.query);
      if (!queryResult.success) {
        return errors.validationFailed(res, queryResult['error'].issues);
      }

      const { days } = queryResult.data;

      let hot: number;
      let coldCandidates: number;

      try {
        // FIX(P0): Pass orgId — getHotCount now requires tenant scoping
        hot = await svc.getHotCount(ctx.orgId);
        coldCandidates = await svc.countColdCandidates(days);
      } catch (serviceError) {
        logger.error('[media-lifecycle] Service error:', serviceError instanceof Error ? serviceError : new Error(String(serviceError)));
        return errors.serviceUnavailable(res);
      }

      const result: LifecycleStats = {
        hot,
        coldCandidates
      };

      return res.send(result);
    } catch (error) {
      // P0-3 FIX: Surface RoleAccessError as 403 instead of masking as 500
      if (error instanceof RoleAccessError) {
        return errors.forbidden(res, error.message);
      }
      logger.error('[media-lifecycle] Unexpected error:', error instanceof Error ? error : new Error(String(error)));
      return errors.internal(res);
    }
  });
}
