

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';

import { OnboardingService } from '../../services/onboarding';
import { rateLimit } from '../../services/rate-limit';
import { requireRole, AuthContext } from '../../services/auth';

const StepParamsSchema = z.object({
  step: z.string().min(1).max(100),
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
    return res.status(401).send({ error: 'Unauthorized' });
    }
    requireRole(ctx, ['owner', 'admin', 'editor']);
    await rateLimit('onboarding', 50);

    const status = await onboarding.get(ctx["orgId"]);
    return res.send(status);
  } catch (error) {
    console["error"]('[onboarding] Error:', error);
    // FIX: Added return before reply.send()
    return res.status(500).send({
    error: 'Failed to fetch onboarding status',
    message: error instanceof Error ? error.message : 'Unknown error'
    });
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
    return res.status(401).send({ error: 'Unauthorized' });
    }
    requireRole(ctx, ['owner', 'admin', 'editor']);
    await rateLimit('onboarding', 50);

    // Validate params
    const paramsResult = StepParamsSchema.safeParse(req.params);
    if (!paramsResult.success) {
    res.status(400).send({
    error: 'Validation failed',
    code: 'VALIDATION_ERROR',
    details: paramsResult["error"].issues
    });
    return;
    }

    const { step } = paramsResult.data;
    await onboarding.mark(ctx["orgId"], step as 'billing' | 'profile' | 'team');
    return res.send({ ok: true });
  } catch (error) {
    console["error"]('[onboarding/step] Error:', error);
    // FIX: Added return before reply.send()
    return res.status(500).send({
    error: 'Failed to mark onboarding step',
    message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
  });
}
