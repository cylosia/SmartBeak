import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAuth, validateMethod, sendError } from '../../../../lib/auth';
import { getLogger } from '@kernel/logger';

const logger = getLogger('billing:checkout');

/**
 * POST /api/billing/:provider/checkout
 * Creates a checkout session for the specified billing provider
 * Supports: stripe, paddle
 */

// Valid billing providers
const VALID_PROVIDERS = ['stripe', 'paddle'];

// P0-1 FIX: Validate URLs against allowlist of trusted origins to prevent open redirect
const ALLOWED_ORIGINS = [
  process.env['NEXT_PUBLIC_APP_URL'],
  process.env['NEXT_PUBLIC_APP_DOMAIN'],
].filter(Boolean) as string[];

function isAllowedUrl(url: string): boolean {
  return ALLOWED_ORIGINS.some(origin => url.startsWith(origin));
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!validateMethod(req, res, ['POST'])) return;

  try {
  // Validate auth
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const { provider } = req.query;
  const { priceId, planId, successUrl, cancelUrl, quantity = 1 } = req.body;

  // Validate provider parameter
  if (!provider || typeof provider !== 'string') {
    return sendError(res, 400, 'provider is required');
  }

  if (!VALID_PROVIDERS.includes(provider)) {
    return sendError(res, 400, `Unsupported billing provider: ${provider}. Must be one of: ${VALID_PROVIDERS.join(', ')}`);
  }

  // Validate required fields - must have either priceId or planId
  if (!priceId && !planId) {
    return sendError(res, 400, 'priceId or planId is required');
  }

  // Validate priceId/planId format
  const idToUse = priceId || planId;
  if (idToUse) {
    if (typeof idToUse !== 'string') {
    return sendError(res, 400, 'priceId/planId must be a string');
    }
    if (idToUse.length < 1 || idToUse.length > 255) {
    return sendError(res, 400, 'priceId/planId must be between 1 and 255 characters');
    }
  }

  // Validate quantity
  if (typeof quantity !== 'number' || quantity < 1 || quantity > 100 || !Number.isInteger(quantity)) {
    return sendError(res, 400, 'quantity must be an integer between 1 and 100');
  }

  // P0-1 FIX: Validate URLs against allowlist to prevent open redirect phishing
  if (successUrl !== undefined) {
    if (typeof successUrl !== 'string' || !isAllowedUrl(successUrl)) {
    return sendError(res, 400, 'successUrl must belong to a trusted application origin');
    }
  }
  if (cancelUrl !== undefined) {
    if (typeof cancelUrl !== 'string' || !isAllowedUrl(cancelUrl)) {
    return sendError(res, 400, 'cancelUrl must belong to a trusted application origin');
    }
  }

  // P1-4 FIX: Never trust req.headers.origin for default URLs — use configured app URL only
  const appOrigin = process.env['NEXT_PUBLIC_APP_URL'] || 'http://localhost:3000';
  const defaultSuccessUrl = `${appOrigin}/portfolio?checkout=success`;
  const defaultCancelUrl = `${appOrigin}/pricing`;

  switch (provider) {
    case 'stripe': {
    // Validate Stripe configuration
    if (!process.env['STRIPE_SECRET_KEY']) {
      logger.error('Stripe is not configured');
      return sendError(res, 503, 'Stripe is not configured');
    }

    // Import Stripe dynamically to avoid loading if not needed
    const { stripe } = await import('../../../../lib/stripe');

    try {
      const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
        price: priceId || planId,
        quantity: quantity
        }
      ],
      success_url: successUrl || defaultSuccessUrl,
      cancel_url: cancelUrl || defaultCancelUrl,
      client_reference_id: auth.orgId,
      metadata: {
        orgId: auth.orgId,
        userId: auth.userId,
        planId: planId || 'pro',
        priceId: priceId || 'none',
      },
      });

      if (!session.url) {
      throw new Error('Failed to create checkout session URL');
      }

      // Security audit log for checkout creation
      logger.info('Stripe checkout created', { sessionId: session.id, userId: auth.userId, orgId: auth.orgId, priceId: priceId || planId });

      return res.status(200).json({
      url: session.url,
      sessionId: session.id,
      provider: 'stripe',
      });
    } catch (stripeError: unknown) {
      logger.error('Stripe error', { error: stripeError });

      if (stripeError instanceof Error && 'type' in stripeError && (stripeError as Record<string, unknown>)['type'] === 'StripeInvalidRequestError') {
      // P1-13 FIX: Do not leak Stripe error details (may contain API key prefixes, config info)
      return sendError(res, 400, 'Invalid payment request. Please check your plan selection.');
      }

      throw stripeError;
    }
    }

    case 'paddle': {
    // Validate Paddle configuration
    if (!process.env['PADDLE_API_KEY']) {
      logger.error('Paddle is not configured');
      return sendError(res, 503, 'Paddle is not configured');
    }

    // Validate Paddle vendor ID
    if (!process.env['PADDLE_VENDOR_ID']) {
      logger.error('Paddle vendor ID is not configured');
      return sendError(res, 503, 'Paddle is not fully configured');
    }

    // For Paddle, we return the checkout URL configuration
    // Actual Paddle checkout is typically handled via their SDK or redirect
    const paddleProductId = priceId || planId;

    try {
      const paddleCheckoutUrl = new URL('https://checkout.paddle.com');
      paddleCheckoutUrl.searchParams.set('product', paddleProductId);
      paddleCheckoutUrl.searchParams.set('quantity', quantity.toString());
      paddleCheckoutUrl.searchParams.set('passthrough', JSON.stringify({
      orgId: auth.orgId,
      userId: auth.userId,
      planId: planId || 'pro',
      }));
      paddleCheckoutUrl.searchParams.set('success_url', successUrl || defaultSuccessUrl);
      paddleCheckoutUrl.searchParams.set('cancel_url', cancelUrl || defaultCancelUrl);

      // Security audit log for checkout creation
      logger.info('Paddle checkout created', { userId: auth.userId, orgId: auth.orgId, productId: paddleProductId });

      return res.status(200).json({
      url: paddleCheckoutUrl.toString(),
      checkoutUrl: paddleCheckoutUrl.toString(),
      provider: 'paddle',
      });
    } catch (paddleError: unknown) {
      logger.error('Paddle error', { error: paddleError });
      throw paddleError;
    }
    }

    default:
    // This should never happen due to earlier validation
    return sendError(res, 400, `Unsupported billing provider: ${provider}`);
  }
  } catch (error: unknown) {
  if (error instanceof Error && error.name === 'AuthError') return;

  logger.error('Checkout error', { error });

  const errorMessage = process.env['NODE_ENV'] === 'development' && error instanceof Error
    ? error.message
    : 'Internal server error. Failed to create checkout session';

  sendError(res, 500, errorMessage);
  }
}
