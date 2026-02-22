


import { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';
import Stripe from 'stripe';

import { errors } from '@errors/responses';
import { getLogger } from '@kernel/logger';
import { billingConfig } from '@config/billing';

import { BillingService } from '../../services/billing';
import { getAuthContext } from '../types';
import { rateLimit } from '../../services/rate-limit';
import { requireRole } from '../../services/auth';

const logger = getLogger('billing-routes');

export async function billingRoutes(app: FastifyInstance, pool: Pool) {
  const billing = new BillingService(pool);
  const stripe = new Stripe(billingConfig.stripeSecretKey, {
    apiVersion: billingConfig.stripeApiVersion,
  });

  const SubscribeSchema = z.object({
    planId: z.string().min(1).max(100),
  }).strict();

  const CheckoutSchema = z.object({
    priceId: z.string().min(1).max(255).startsWith('price_'),
    successUrl: z.string().url().optional(),
    cancelUrl: z.string().url().optional(),
  }).strict();

  const PortalSchema = z.object({
    returnUrl: z.string().url().optional(),
  }).strict();

  app.post('/billing/subscribe', async (req, res) => {
    await rateLimit('billing', 20);
    const ctx = getAuthContext(req);
    requireRole(ctx, ['owner']);

    const parseResult = SubscribeSchema.safeParse(req.body);
    if (!parseResult.success) {
      return errors.validationFailed(res, parseResult['error'].issues);
    }

    const { planId } = parseResult.data;
    await billing.assignPlan(ctx['orgId'], planId);
    return res.send({ ok: true });
  });

  app.get('/billing/plan', async (req, res) => {
    await rateLimit('billing', 50);
    const ctx = getAuthContext(req);
    requireRole(ctx, ['owner', 'admin']);
    const plan = await billing.getActivePlan(ctx['orgId']);
    return res.send(plan);
  });

  // POST /billing/checkout — Create a Stripe Checkout session for subscription
  app.post('/billing/checkout', async (req, res) => {
    await rateLimit('billing:checkout', 10);
    const ctx = getAuthContext(req);
    requireRole(ctx, ['owner', 'admin']);

    const parseResult = CheckoutSchema.safeParse(req.body);
    if (!parseResult.success) {
      return errors.validationFailed(res, parseResult['error'].issues);
    }

    const { priceId, successUrl, cancelUrl } = parseResult.data;
    const appOrigin = process.env['NEXT_PUBLIC_APP_URL'] || 'http://localhost:3000';

    // Validate redirect URLs against app origin to prevent open redirect
    if (successUrl && !successUrl.startsWith(appOrigin + '/') && successUrl !== appOrigin) {
      return errors.badRequest(res, 'successUrl must belong to the application origin');
    }
    if (cancelUrl && !cancelUrl.startsWith(appOrigin + '/') && cancelUrl !== appOrigin) {
      return errors.badRequest(res, 'cancelUrl must belong to the application origin');
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl || `${appOrigin}/portfolio?checkout=success`,
      cancel_url: cancelUrl || `${appOrigin}/pricing`,
      client_reference_id: ctx['orgId'],
      metadata: {
        orgId: ctx['orgId'],
        userId: ctx['userId'],
        priceId,
      },
    });

    if (!session.url) {
      return errors.internal(res, 'Failed to create checkout session URL');
    }

    logger.info('Stripe checkout created', {
      sessionId: session.id,
      userId: ctx['userId'],
      orgId: ctx['orgId'],
    });

    return res.send({
      url: session.url,
      sessionId: session.id,
    });
  });

  // POST /billing/portal — Create a Stripe Customer Portal session
  app.post('/billing/portal', async (req, res) => {
    await rateLimit('billing:portal', 20);
    const ctx = getAuthContext(req);
    requireRole(ctx, ['owner', 'admin']);

    const parseResult = PortalSchema.safeParse(req.body);
    if (!parseResult.success) {
      return errors.validationFailed(res, parseResult['error'].issues);
    }

    const { returnUrl } = parseResult.data;

    // Look up the org's Stripe customer ID from the database
    const { rows } = await pool.query(
      'SELECT stripe_customer_id FROM organizations WHERE id = $1',
      [ctx['orgId']]
    );
    const customerId = rows[0]?.stripe_customer_id as string | undefined;
    if (!customerId) {
      return errors.notFound(res, 'Billing account');
    }

    const appOrigin = process.env['NEXT_PUBLIC_APP_URL'] || 'http://localhost:3000';

    // Validate return URL against app origin
    if (returnUrl && !returnUrl.startsWith(appOrigin + '/') && returnUrl !== appOrigin) {
      return errors.badRequest(res, 'returnUrl must belong to the application origin');
    }

    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl || `${appOrigin}/billing`,
    });

    logger.info('Stripe portal session created', {
      userId: ctx['userId'],
      orgId: ctx['orgId'],
    });

    return res.send({ url: portal.url });
  });
}
