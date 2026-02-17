


import { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';

import { getLogger } from '@kernel/logger';
import { getErrorMessage } from '@errors';
import { errors } from '@errors/responses';

import { BillingService } from '../../services/billing';
import { getAuthContext } from '../types';
import { rateLimit } from '../../services/rate-limit';
import { requireRole } from '../../services/auth';

const logger = getLogger('billing-routes');

export async function billingRoutes(app: FastifyInstance, pool: Pool) {
  const billing = new BillingService(pool);

  const SubscribeSchema = z.object({
  planId: z.string().min(1).max(100),
  });

  app.post('/billing/subscribe', async (req, res) => {
  try {
    const ctx = getAuthContext(req);
    requireRole(ctx, ['owner']);
    await rateLimit('billing', 20, req, res);

    // Validate input
    const parseResult = SubscribeSchema.safeParse(req.body);
    if (!parseResult.success) {
    return errors.validationFailed(res, parseResult["error"].issues);
    }

    const { planId } = parseResult.data;
    await billing.assignPlan(ctx["orgId"], planId);
    return res.send({ ok: true });
  } catch (error: unknown) {
    logger.error('[billing/subscribe] Error', new Error(getErrorMessage(error)));
    // SECURITY FIX (Finding 7): Don't leak any error details to clients
    return errors.internal(res);
  }
  });

  app.get('/billing/plan', async (req, res) => {
  try {
    const ctx = getAuthContext(req);
    requireRole(ctx, ['owner','admin']);
    await rateLimit('billing', 50, req, res);
    const plan = await billing.getActivePlan(ctx["orgId"]);
    return res.send(plan);
  } catch (error: unknown) {
    logger.error('[billing/plan] Error', new Error(getErrorMessage(error)));
    // SECURITY FIX (Finding 7): Don't leak raw error messages to clients
    return errors.internal(res);
  }
  });
}
