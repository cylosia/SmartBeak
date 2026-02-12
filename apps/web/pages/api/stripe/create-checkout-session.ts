import { stripe, validateStripeConfig } from '../../../lib/stripe';
import { requireAuth, validateMethod } from '../../../lib/auth';
import { getLogger } from '@kernel/logger';

/**
 * POST /api/stripe/create-checkout-session
 * Creates a Stripe Checkout session for subscription
 * Requires authentication
 */
import type { NextApiRequest, NextApiResponse } from 'next';

const logger = getLogger('StripeCheckout');

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!validateMethod(req, res, ['POST']))
    return;
  try {
    // Validate Stripe is configured
    validateStripeConfig();
    // P0-3 FIX: Check auth return value — if auth fails, requireAuth sends
    // a response but execution continues. Must return early.
    const auth = await requireAuth(req, res);
    if (!auth) return;
    const { priceId, successUrl, cancelUrl } = req.body;
    // Validate required fields
    if (!priceId) {
      return res.status(400).json({ error: 'priceId is required' });
    }
    // Validate price ID format (should start with price_)
    if (!priceId.startsWith('price_')) {
      return res.status(400).json({
        error: "Invalid priceId format. Should start with 'price_'"
      });
    }
    // P1-4 FIX: Never trust req.headers.origin — use configured app URL only
    const origin = process.env['NEXT_PUBLIC_APP_URL'] || 'http://localhost:3000';
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1
        }
      ],
      success_url: successUrl || `${origin}/portfolio?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl || `${origin}/pricing`,
      // Enable customer creation if needed
      // Customer_creation: 'always',
      // Or use existing customer
      // Customer: customerId,
      // Collect tax if configured
      // Automatic_tax: { enabled: true },
    });
    if (!session.url) {
      throw new Error('Failed to create checkout session URL');
    }
    res.status(200).json({
      url: session.url,
      sessionId: session["id"],
    });
  }
  catch (error) {
    if (error instanceof Error && error.name === 'AuthError')
      return;
    logger.error({ error }, 'Checkout session creation failed');
    if (error instanceof Error && 'type' in error && error.type === 'StripeInvalidRequestError') {
      // P1-13 FIX: Do not leak Stripe error details to client
      return res.status(400).json({
        error: 'Invalid payment request. Please check your plan selection.',
      });
    }
    if (error instanceof Error && error.message === 'Stripe is not properly configured') {
      return res.status(503).json({ error: 'Payment service not configured' });
    }
    res.status(500).json({
      error: 'Failed to create checkout session'
    });
  }
}
