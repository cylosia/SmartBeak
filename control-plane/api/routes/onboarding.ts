

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';

import { getLogger } from '@kernel/logger';
import { OnboardingService } from '../../services/onboarding';
import { rateLimit } from '../../services/rate-limit';
import { requireRole, AuthContext, RoleAccessError } from '../../services/auth';
import { errors } from '@errors/responses';

const logger = getLogger('Onboarding');

// Step enum must match VALID_STEPS in onboarding.ts and DB column names in the migration
const StepParamsSchema = z.object({
  step: z.enum(['step_create_domain', 'step_create_content', 'step_publish_content']),
}).strict();

export type AuthenticatedRequest = FastifyRequest & {
  auth?: AuthContext | undefined;
};

/**
* Onboarding routes
*/
export async function onboardingRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  const onboarding = new OnboardingService(pool);

  /**
  * @openapi
  * /onboarding:
  *   get:
  *     summary: Get onboarding status
  *     tags: [Onboarding]
  *     security:
  *       - bearerAuth: []
  *     responses:
  *       200:
  *         description: Onboarding status retrieved
  *       403:
  *         description: Forbidden
  */
  app.get('/onboarding', async (
  req: FastifyRequest,
  res: FastifyReply
  ): Promise<void> => {
  try {
    const { auth: ctx } = req as AuthenticatedRequest;
    if (!ctx) {
    return errors.unauthorized(res);
    }
      // P1-2: Rate limit BEFORE role check so all callers consume quota
      await rateLimit(`onboarding:${ctx.userId}`, 50);
      requireRole(ctx, ['owner', 'admin', 'editor']);

      const status = await onboarding.get(ctx.orgId);
      return res.send(status);
    } catch (error) {
      // P1-3: Discriminate role and rate-limit errors before falling through to 500
      if (error instanceof RoleAccessError) return errors.forbidden(res, 'Insufficient permissions');
      if (error instanceof Error && error.message === 'Rate limit exceeded') {
        return errors.rateLimited(res, 60);
      }
      logger.error('[onboarding] Error', error instanceof Error ? error : new Error(String(error)));
      return errors.internal(res, 'Failed to fetch onboarding status');
    }
  });

  /**
  * @openapi
  * /onboarding/step/{step}:
  *   post:
  *     summary: Mark onboarding step as complete
  *     tags: [Onboarding]
  *     security:
  *       - bearerAuth: []
  *     parameters:
  *       - name: step
  *         in: path
  *         required: true
  *         schema:
  *           type: string
  *           enum: [profile, billing, team]
  *     responses:
  *       200:
  *         description: Step marked as complete
  *       400:
  *         description: Invalid step
  *       403:
  *         description: Forbidden
  */
  app.post('/onboarding/step/:step', async (
  req: FastifyRequest,
  res: FastifyReply
  ): Promise<void> => {
  try {
    const { auth: ctx } = req as AuthenticatedRequest;
    if (!ctx) {
    return errors.unauthorized(res);
    }
      // P1-2: Rate limit BEFORE role check
      await rateLimit(`onboarding:step:${ctx.userId}`, 50);
      requireRole(ctx, ['owner', 'admin', 'editor']);

      // Validate step against enum at route boundary
      const paramsResult = StepParamsSchema.safeParse(req.params);
      if (!paramsResult.success) {
        return errors.validationFailed(res, paramsResult.error.issues);
      }

      const { step } = paramsResult.data;
      await onboarding.mark(ctx.orgId, step);
      return res.send({ ok: true });
    } catch (error) {
      // P1-3: Discriminate role and rate-limit errors before falling through to 500
      if (error instanceof RoleAccessError) return errors.forbidden(res, 'Insufficient permissions');
      if (error instanceof Error && error.message === 'Rate limit exceeded') {
        return errors.rateLimited(res, 60);
      }
      logger.error('[onboarding/step] Error', error instanceof Error ? error : new Error(String(error)));
      return errors.internal(res, 'Failed to mark onboarding step');
    }
  });
}
