

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Pool } from 'pg';

import { PlanningOverviewService } from '../../../domains/planning/application/PlanningOverviewService';
import { rateLimit } from '../../services/rate-limit';
import { requireRole, AuthContext } from '../../services/auth';

export type AuthenticatedRequest = FastifyRequest & {
  auth?: AuthContext | undefined;
};

export async function planningRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  const svc = new PlanningOverviewService(pool);

  /**
  * @openapi
  * /planning/overview:
  *   get:
  *     summary: Get planning overview
  *     tags: [Planning]
  *     security:
  *       - bearerAuth: []
  *     responses:
  *       200:
  *         description: Planning overview retrieved
  *       403:
  *         description: Forbidden
  *
  */
  app.get('/planning/overview', async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const { auth: ctx } = req as AuthenticatedRequest;
    if (!ctx) {
    return res.status(401).send({ error: 'Unauthorized' });
    }
    requireRole(ctx, ['owner','admin','editor','viewer']);
    await rateLimit('planning', 50);

    if (!ctx["domainId"]) {
    return res.status(400).send({
    error: 'Domain ID is required',
    code: 'DOMAIN_REQUIRED',
    });
    }

    const result = await svc.overview(ctx["domainId"]);
    return res.send(result);
  } catch (error: unknown) {
    console["error"]('[planning/overview] Error:', error);
    res.status(500).send({
    error: 'Failed to retrieve planning overview',
    message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
  });
}
