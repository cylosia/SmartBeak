

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Pool } from 'pg';

import { getLogger } from '@kernel/logger';
import { PlanningOverviewService } from '../../../domains/planning/application/PlanningOverviewService';
import { rateLimit } from '../../services/rate-limit';
import { requireRole, AuthContext } from '../../services/auth';
import { errors } from '@errors/responses';
import { ErrorCodes } from '@errors';

const logger = getLogger('planning-routes');

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
    return errors.unauthorized(res);
    }
    requireRole(ctx, ['owner','admin','editor','viewer']);
    await rateLimit('planning', 50);

    if (!ctx["domainId"]) {
    return errors.badRequest(res, 'Domain ID is required', ErrorCodes.REQUIRED_FIELD);
    }

    const result = await svc.overview(ctx["domainId"]);
    return res.send(result);
  } catch (error: unknown) {
    logger.error('[planning/overview] Error', error instanceof Error ? error : new Error(String(error)));
    return errors.internal(res, 'Failed to retrieve planning overview');
  }
  });
}
