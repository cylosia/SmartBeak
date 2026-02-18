import Stripe from 'stripe';
import { getLogger } from '@kernel/logger';

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
 * Returns true if this Stripe error is worth retrying.
 * P1-FIX: Previously withRetry retried ALL errors including card_declined and auth failures,
 * wasting time (3× delays) and triggering Stripe's fraud-detection for repeated declines.
 * Non-transient errors will not succeed on retry and must surface immediately to the caller.
 */
function isRetryableStripeError(error: unknown): boolean {
  // Non-Stripe errors (JS TypeError, network timeout) — retry
  if (!(error instanceof Stripe.errors.StripeError)) return true;

  switch (error.type) {
    case 'StripeConnectionError':    // Network connectivity — retry
    case 'StripeAPIError':           // Stripe 5xx server error — retry
    case 'StripeRateLimitError':     // Rate limited — retry with backoff
      return true;
    case 'StripeCardError':          // Card declined — retry won't help
    case 'StripeInvalidRequestError': // Bad request params — retry won't help
    case 'StripeAuthenticationError': // Wrong API key — config error
    case 'StripePermissionError':    // Insufficient permissions — config error
    case 'StripeIdempotencyError':   // Idempotency key reuse with different params
      return false;
    default:
      // P2-FIX: Changed from `return true` (retry) to `return false` (don't retry).
      // "Unknown Stripe error subtypes" includes new error codes added by Stripe after
      // this code was written. Retrying unknown errors risks:
      //   1. Re-triggering fraud-detection alerts on repeated failed charge attempts
      //   2. Amplifying billing operations (charges, refunds) that should only run once
      //   3. Wasting 3× delay budget on errors that retrying cannot fix
      // The conservative safe default for financial operations is: don't retry unknown
      // errors. The Stripe SDK already handles well-known transient errors above.
      return false;
  }
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

    // P1-FIX: Don't retry non-transient Stripe errors (card declines, bad params, auth)
    if (!isRetryableStripeError(error)) {
      throw lastError;
    }

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

  // P1-FIX: Use a time-bucketed deterministic idempotency key.
  // The previous `randomUUID()` generated a new key on every call, completely defeating
  // idempotency: a network timeout followed by an app-level retry would produce two
  // checkout sessions (and potentially two charges). A time-bucketed key (1-hour window)
  // ensures retries within the same window hit the Stripe idempotency cache and return
  // the same session, while allowing a new session after the hour expires.
  const hourBucket = Math.floor(Date.now() / 3_600_000);
  const idempotencyKey = `checkout_${orgId}_${priceId}_${hourBucket}`;

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
  // P3-FIX: Removed dead `if (!event || !event.type)` guard — event is typed as
  // Stripe.Event which always has a `type: string` field; the guard can never be true.
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
