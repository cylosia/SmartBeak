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
    // P0-001 FIX: Validate priceId against an explicit server-side allowlist.
    // Only checking startsWith('price_') allowed any Stripe price ID in the
    // account — including free-trial prices — enabling billing fraud.
    const ALLOWED_PRICE_IDS = (process.env['ALLOWED_STRIPE_PRICE_IDS'] || '')
      .split(',')
      .map(id => id.trim())
      .filter(Boolean);
    if (ALLOWED_PRICE_IDS.length > 0 && !ALLOWED_PRICE_IDS.includes(priceId as string)) {
      return res.status(400).json({ error: 'Invalid plan selection' });
    }
    if (!priceId.startsWith('price_')) {
      return res.status(400).json({
        error: "Invalid priceId format. Should start with 'price_'"
      });
    }
    // P1-4 FIX: Never trust req.headers.origin — use configured app URL only
    const origin = process.env['NEXT_PUBLIC_APP_URL'] || 'http://localhost:3000';
    // P1-012 FIX: Validate successUrl/cancelUrl to prevent open redirect.
    // Also add client_reference_id and metadata so the checkout.session.completed
    // webhook can attribute the payment to the correct org.
    const allowedOrigins = [process.env['NEXT_PUBLIC_APP_URL']].filter(Boolean) as string[];
    function isAllowedCheckoutUrl(url: string | undefined): boolean {
      if (!url) return true; // allow undefined (we'll use defaults)
      if (allowedOrigins.length === 0) return false;
      try {
        const parsed = new URL(url);
        return allowedOrigins.some(o => parsed.origin === o);
      } catch { return false; }
    }
    if (!isAllowedCheckoutUrl(successUrl as string | undefined)) {
      return res.status(400).json({ error: 'successUrl must be on an allowed origin' });
    }
    if (!isAllowedCheckoutUrl(cancelUrl as string | undefined)) {
      return res.status(400).json({ error: 'cancelUrl must be on an allowed origin' });
    }
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
      // P1-012 FIX: Attach org/user identity so the webhook can provision the
      // correct subscription. Without this, completed payments are unattributable.
      client_reference_id: auth.orgId,
      metadata: {
        orgId: auth.orgId,
        userId: auth.userId,
        priceId: priceId as string,
      },
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
    logger.error('Checkout session creation failed', error instanceof Error ? error : undefined);
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
