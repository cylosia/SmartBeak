


import { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';

import { errors } from '@errors/responses';

import { BillingService } from '../../services/billing';
import { getAuthContext } from '../types';
import { rateLimit } from '../../services/rate-limit';
import { requireRole } from '../../services/auth';

export async function billingRoutes(app: FastifyInstance, pool: Pool) {
  const billing = new BillingService(pool);

  const SubscribeSchema = z.object({
  planId: z.string().min(1).max(100),
  }).strict();

  app.post('/billing/subscribe', async (req, res) => {
    // H5-FIX: Rate limit BEFORE auth — throttles unauthenticated DoS attempts
    // before any auth infrastructure is touched.
    await rateLimit('billing', 20);
    const ctx = getAuthContext(req);
    requireRole(ctx, ['owner']);

    // Validate input
    const parseResult = SubscribeSchema.safeParse(req.body);
    if (!parseResult.success) {
    return errors.validationFailed(res, parseResult["error"].issues);
    }

    const { planId } = parseResult.data;
    await billing.assignPlan(ctx["orgId"], planId);
    return res.send({ ok: true });
  });

  app.get('/billing/plan', async (req, res) => {
    // H5-FIX: Rate limit before auth.
    await rateLimit('billing', 50);
    const ctx = getAuthContext(req);
    requireRole(ctx, ['owner','admin']);
    const plan = await billing.getActivePlan(ctx["orgId"]);
    return res.send(plan);
  });
}
