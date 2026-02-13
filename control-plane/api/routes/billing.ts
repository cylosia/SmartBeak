


import { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';

import { getLogger } from '@kernel/logger';
import { createRouteErrorHandler } from '@errors';

import { BillingService } from '../../services/billing';
import { getAuthContext } from '../types';
import { rateLimit } from '../../services/rate-limit';
import { requireRole } from '../../services/auth';

const logger = getLogger('billing-routes');
const handleError = createRouteErrorHandler({ logger });

export async function billingRoutes(app: FastifyInstance, pool: Pool) {
  const billing = new BillingService(pool);

  const SubscribeSchema = z.object({
  planId: z.string().min(1).max(100),
  });

  app.post('/billing/subscribe', async (req, res) => {
  try {
    const ctx = getAuthContext(req);
    requireRole(ctx, ['owner']);
    await rateLimit('billing', 20);

    // Validate input
    const parseResult = SubscribeSchema.safeParse(req.body);
    if (!parseResult.success) {
    return res.status(400).send({
    error: 'Validation failed',
    code: 'VALIDATION_ERROR',
    details: parseResult["error"].issues
    });
    }

    const { planId } = parseResult.data;
    await billing.assignPlan(ctx["orgId"], planId);
    return res.send({ ok: true });
  } catch (error) {
    return handleError(res, error, 'subscribe to plan');
  }
  });

  app.get('/billing/plan', async (req, res) => {
  try {
    const ctx = getAuthContext(req);
    requireRole(ctx, ['owner','admin']);
    await rateLimit('billing', 50);
    const plan = await billing.getActivePlan(ctx["orgId"]);
    return res.send(plan);
  } catch (error) {
    return handleError(res, error, 'fetch billing plan');
  }
  });
}
