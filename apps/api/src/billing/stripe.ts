import Stripe from 'stripe';
import crypto from 'crypto';
import { getLogger } from '../../../../packages/kernel/logger';

/**
* MEDIUM FIX M1, M2, M3: Enhanced Stripe integration
* - Input validation
* - Error handling with retry logic
* - Idempotency key support
* - Proper logging
*/

const logger = getLogger('StripeBilling');

const MAX_ORG_ID_LENGTH = 100;
const MAX_PRICE_ID_LENGTH = 100;

// Validate environment variable exists
const stripeSecretKey = process.env['STRIPE_SECRET_KEY'];
if (!stripeSecretKey) {
  throw new Error(
  'STRIPE_SECRET_KEY environment variable is required. ' +
  'Please set it to your Stripe secret key from https://dashboard.stripe.com'
  );
}

const stripe = new Stripe(stripeSecretKey, {
  apiVersion: '2023-10-16'
});

// Get app URL with validation
function getAppUrl(): string {
  const url = process.env['APP_URL'] || process.env['NEXT_PUBLIC_APP_URL'];
  if (!url) {
  throw new Error(
    'APP_URL or NEXT_PUBLIC_APP_URL environment variable is required. ' +
    'Please set it to your application URL (e.g., https://app.example.com)'
  );
  }

  try {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`Invalid app URL protocol: ${parsed.protocol}`);
  }
  return url;
  } catch {
  throw new Error(`Invalid app URL format: ${url}`);
  }
}

/**
* MEDIUM FIX M3: Validate orgId
*/
function validateOrgId(orgId: string): void {
  if (!orgId || typeof orgId !== 'string') {
  throw new Error('Invalid orgId: must be a non-empty string');
  }
  if (orgId.length > MAX_ORG_ID_LENGTH) {
  throw new Error(`Invalid orgId: exceeds maximum length of ${MAX_ORG_ID_LENGTH}`);
  }
}

/**
* MEDIUM FIX M3: Validate priceId
*/
function validatePriceId(priceId: string): void {
  if (!priceId || typeof priceId !== 'string') {
  throw new Error('Invalid priceId: must be a non-empty string');
  }
  if (priceId.length > MAX_PRICE_ID_LENGTH) {
  throw new Error(`Invalid priceId: exceeds maximum length of ${MAX_PRICE_ID_LENGTH}`);
  }
  if (!/^price_[a-zA-Z0-9]+$/.test(priceId)) {
  throw new Error('Invalid priceId: must be a valid Stripe price ID (price_xxx)');
  }
}

/**
* MEDIUM FIX M2: Retry configuration
*/
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

/**
* MEDIUM FIX M2: Sleep helper
*/
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
* MEDIUM FIX M2: Execute with retry
*/
async function withRetry<T>(fn: () => Promise<T>, operationName: string): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
  try {
    return await fn();
  } catch (error) {
    lastError = error instanceof Error ? error : new Error(String(error));

      logger.warn(
        `${operationName} failed (attempt ${attempt + 1}/${MAX_RETRIES})`,
        { error: lastError, operation: operationName, attempt: attempt + 1, maxRetries: MAX_RETRIES }
      );

    // Don't retry on the last attempt
    if (attempt < MAX_RETRIES - 1) {
    await sleep(RETRY_DELAY_MS * Math.pow(2, attempt));
    }
  }
  }

  throw lastError || new Error(`${operationName} failed after ${MAX_RETRIES} attempts`);
}

/**
* Stripe Checkout Session result
*/
export interface CheckoutSessionResult {
  id: string;
  url: string | null;
}

/**
* Create a Stripe checkout session for subscription
* @param orgId - Organization ID
* @param priceId - Stripe price ID
* @returns Checkout session with ID and URL
*/
export async function createStripeCheckoutSession(
  orgId: string,
  priceId: string
): Promise<CheckoutSessionResult> {
  validateOrgId(orgId);
  validatePriceId(priceId);

  const appUrl = getAppUrl();

  // P0-FIX: Use cryptographically secure random UUID for idempotency key
  // Date.now() can collide within same millisecond causing double-charges
  const idempotencyKey = `checkout_${orgId}_${priceId}_${crypto.randomUUID()}`;

  // P0-FIX: Pass idempotencyKey to Stripe API to prevent double-charges on retry
  return withRetry(() =>
  stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${appUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/billing/cancel`,
    metadata: { orgId },
    client_reference_id: orgId,
  }, {
    idempotencyKey,  // P0-FIX: Was missing - now passed to prevent duplicates
  }).then(session => ({
    id: session.id,
    url: session["url"],
  })),
  'createCheckoutSession'
  );
}

/**
* Handle Stripe webhook events
* @param event - Stripe webhook event
* @returns Promise that resolves when event is processed
*/
export async function handleStripeWebhook(event: Stripe.Event): Promise<void> {
  if (!event || !event.type) {
  logger.error('Invalid webhook event: missing type', undefined, { eventType: String(event) });
  return;
  }

  logger.info('Received webhook', { eventType: event.type });

  try {
  switch (event.type) {
    case 'checkout.session.completed': {
    const session = event.data.object as Stripe.Checkout.Session;
        logger.info('Checkout completed', {
          sessionId: session.id,
          customer: session.customer,
          orgId: session.metadata?.['orgId']
        });
    // Implementation handled in apps/web/pages/api/webhooks/stripe.ts
    break;
    }

    case 'customer.subscription.updated': {
    const subscription = event.data.object as Stripe.Subscription;
    logger.info('Subscription updated', {
          subscriptionId: subscription.id,
          status: subscription.status,
          customer: subscription.customer
        });
    // Update subscription status in database
    break;
    }

    case 'customer.subscription.deleted': {
    const subscription = event.data.object as Stripe.Subscription;
    logger.info('Subscription deleted', {
          subscriptionId: subscription.id,
          customer: subscription.customer
        });
    // Handle cancellation
    break;
    }

    case 'invoice.payment_failed': {
    const invoice = event.data.object as Stripe.Invoice;
    logger.info('Payment failed', {
          invoiceId: invoice.id,
          customer: invoice.customer,
          attemptCount: invoice.attempt_count
        });
    // Set organization to read-only mode
    break;
    }

    default:
        logger.info('Unhandled event type', { eventType: event.type });
  }
  } catch (error) {
    logger.error(`Error handling webhook ${event.type}`, error instanceof Error ? error : undefined, { eventType: event.type });
  throw error;
  }
}

export { stripe };
