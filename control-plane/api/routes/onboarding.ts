

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';

import { getLogger } from '@kernel/logger';
import { OnboardingService } from '../../services/onboarding';
import { rateLimit } from '../../services/rate-limit';
import { requireRole, AuthError } from '../../services/auth';
import { errors } from '@errors/responses';
import type { AuthenticatedRequest } from '../types';

const logger = getLogger('Onboarding');

// SECURITY FIX (H02): Validate step at route boundary with enum instead of loose string
const StepParamsSchema = z.object({
  step: z.enum(['profile', 'billing', 'team']),
});

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
    // SECURITY FIX (order): Rate-limit before role check so that callers with
    // insufficient roles still consume quota.  The previous order let any
    // authenticated-but-wrong-role user probe authorization state without ever
    // being rate-limited, enabling unlimited auth-enumeration requests.
    await rateLimit(`onboarding:${ctx.userId}`, 50);
    requireRole(ctx, ['owner', 'admin', 'editor']);

    const status = await onboarding.get(ctx["orgId"]);
    return res.send(status);
  } catch (error) {
    // Auth errors (requireRole throws RoleAccessError with statusCode 403) must
    // produce the correct HTTP status — not 500 — so clients receive 403 and
    // callers are not misled by spurious server-error alerts.
    if (error instanceof AuthError) {
      return error.statusCode === 403
        ? errors.forbidden(res)
        : errors.unauthorized(res);
    }
    // rateLimit() throws a plain Error('Rate limit exceeded') when exceeded.
    if (error instanceof Error && error.message === 'Rate limit exceeded') {
      return errors.rateLimited(res, 60);
    }
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
    // SECURITY FIX (order): Rate-limit before role check (see GET /onboarding for rationale).
    await rateLimit(`onboarding:step:${ctx.userId}`, 50);
    requireRole(ctx, ['owner', 'admin', 'editor']);

    // SECURITY FIX (H02): Validate step against enum at route boundary
    const paramsResult = StepParamsSchema.safeParse(req.params);
    if (!paramsResult.success) {
    return errors.validationFailed(res, paramsResult.error.issues);
    }

    const { step } = paramsResult.data;
    await onboarding.mark(ctx["orgId"], step);
    return res.send({ ok: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return error.statusCode === 403
        ? errors.forbidden(res)
        : errors.unauthorized(res);
    }
    if (error instanceof Error && error.message === 'Rate limit exceeded') {
      return errors.rateLimited(res, 60);
    }
    // SECURITY FIX (H04): Use structured logger instead of console.error
    logger.error('[onboarding/step] Error', error instanceof Error ? error : new Error(String(error)));
    // SECURITY FIX (H01): Do not expose internal error messages to clients
    return errors.internal(res, 'Failed to mark onboarding step');
  }
  });
}
