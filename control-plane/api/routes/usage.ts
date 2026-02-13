

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Pool } from 'pg';

import { getLogger } from '@kernel/logger';
import { createRouteErrorHandler } from '@errors';
import { rateLimit } from '../../services/rate-limit';
import { requireRole, AuthContext } from '../../services/auth';
import { UsageService } from '../../services/usage';

const logger = getLogger('usage-routes');
const handleError = createRouteErrorHandler({ logger });

export interface UsageStats {
  orgId: string;
  period: string;
  totalRequests: number;
  totalTokens: number;
  costEstimate: number;
}

export type AuthenticatedRequest = FastifyRequest & {
  auth?: AuthContext | undefined;
};

/**
* Usage routes
*/
export async function usageRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  const usage = new UsageService(pool);

  /**
  * @openapi
  * /usage:
  *   get:
  *     summary: Get organization usage statistics
  *     tags: [Usage]
  *     security:
  *       - bearerAuth: []
  *     responses:
  *       200:
  *         description: Usage statistics retrieved
  *       403:
  *         description: Forbidden
  */
  app.get('/usage', async (
  req: FastifyRequest,
  res: FastifyReply
  ): Promise<void> => {
  try {
    const { auth: ctx } = req as AuthenticatedRequest;
    if (!ctx) {
    return res.status(401).send({ error: 'Unauthorized' });
    }
    requireRole(ctx, ['owner', 'admin']);
    // P1-FIX: Scope rate limit to org to prevent one user exhausting limit for all
    await rateLimit(`usage:${ctx["orgId"]}`, 50);

    let stats: UsageStats;
    try {
    stats = await usage.getUsage(ctx["orgId"]) as unknown as UsageStats;
    } catch (serviceError) {
    logger.error('[usage] Service error', serviceError instanceof Error ? serviceError : new Error(String(serviceError)));
    return res.status(503).send({
    error: 'Usage service temporarily unavailable',
    code: 'SERVICE_UNAVAILABLE',
    });
    }

    return res.send(stats);
  } catch (error) {
    return handleError(res, error, 'fetch usage statistics');
  }
  });
}
