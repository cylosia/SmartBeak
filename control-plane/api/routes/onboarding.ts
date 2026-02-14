

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';

import { getLogger } from '@kernel/logger';
import { OnboardingService } from '../../services/onboarding';
import { rateLimit } from '../../services/rate-limit';
import { requireRole, AuthContext } from '../../services/auth';
import { errors } from '@errors/responses';

const logger = getLogger('Onboarding');

// SECURITY FIX (H02): Validate step at route boundary with enum instead of loose string
const StepParamsSchema = z.object({
  step: z.enum(['profile', 'billing', 'team']),
});

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
    requireRole(ctx, ['owner', 'admin', 'editor']);
    // SECURITY FIX (C03): Use per-user identifier instead of global static string
    await rateLimit(`onboarding:${ctx.userId}`, 50);

    const status = await onboarding.get(ctx["orgId"]);
    return res.send(status);
  } catch (error) {
    // SECURITY FIX (H04): Use structured logger instead of console.error
    logger.error('[onboarding] Error', error instanceof Error ? error : new Error(String(error)));
    // SECURITY FIX (H01): Do not expose internal error messages to clients
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
    requireRole(ctx, ['owner', 'admin', 'editor']);
    // SECURITY FIX (C03): Use per-user identifier instead of global static string
    await rateLimit(`onboarding:step:${ctx.userId}`, 50);

    // SECURITY FIX (H02): Validate step against enum at route boundary
    const paramsResult = StepParamsSchema.safeParse(req.params);
    if (!paramsResult.success) {
    return errors.validationFailed(res, paramsResult.error.issues);
    }

    const { step } = paramsResult.data;
    await onboarding.mark(ctx["orgId"], step);
    return res.send({ ok: true });
  } catch (error) {
    // SECURITY FIX (H04): Use structured logger instead of console.error
    logger.error('[onboarding/step] Error', error instanceof Error ? error : new Error(String(error)));
    // SECURITY FIX (H01): Do not expose internal error messages to clients
    return errors.internal(res, 'Failed to mark onboarding step');
  }
  });
}
