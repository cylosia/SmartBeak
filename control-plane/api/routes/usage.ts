

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Pool } from 'pg';

import { rateLimit } from '../../services/rate-limit';
import { requireRole, AuthContext } from '../../services/auth';
import { UsageService } from '../../services/usage';

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
    console["error"]('[usage] Service error:', serviceError);
    return res.status(503).send({
    error: 'Service temporarily unavailable',
    message: 'Unable to fetch usage data. Please try again later.'
    });
    }

    return res.send(stats);
  } catch (error) {
    // P1-FIX: Log full error server-side but never expose raw error messages to clients
    console["error"]('[usage] Unexpected error:', error);
    return res.status(500).send({
    error: 'Internal server error'
    });
  }
  });
}
