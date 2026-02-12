
import Stripe from 'stripe';

import { getDb } from '../db';
import { getRedis } from '@kernel/redis';
import { sanitizeErrorMessage } from '../../../../packages/security/logger';
import { getLogger } from '../../../../packages/kernel/logger';

const logger = getLogger('StripeWebhook');

// P1-FIX: Lazy-initialize Stripe client. Previously the module threw at import time
// if STRIPE_SECRET_KEY was missing, crashing the entire process even if billing
// routes weren't needed for a particular deployment or test run.
let _stripe: Stripe | undefined;
function getStripe(): Stripe {
  if (!_stripe) {
    const stripeKey = process.env['STRIPE_SECRET_KEY'];
    if (!stripeKey) {
      throw new Error('STRIPE_SECRET_KEY environment variable is required');
    }
    _stripe = new Stripe(stripeKey, {
      apiVersion: '2023-10-16'
    });
  }
  return _stripe;
}

/**
 * Allowed Stripe event types for this webhook handler
 * SECURITY FIX: Issue 16 - Event type allowlist
 */
const ALLOWED_EVENT_TYPES = new Set([
  'checkout.session.completed',
  'checkout.session.expired',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.trial_will_end',
  'invoice.payment_failed',
  'invoice.payment_succeeded',
]);

/**
 * Check if event type is in allowlist
 * SECURITY FIX: Issue 16 - Event type validation
 */
function isAllowedEventType(eventType: string): boolean {
  return ALLOWED_EVENT_TYPES.has(eventType);
}

/**
 * Check if a Stripe event has already been processed
 * P0-FIX: Redis-based deduplication to prevent duplicate processing
 * @param eventId - The Stripe event ID
 * @returns true if duplicate (already processed), false if new
 */
async function isDuplicateEvent(eventId: string): Promise<boolean> {
  try {
    const redis = await getRedis();
    const key = `webhook:stripe:event:${eventId}`;
    // NX = only set if not exists, EX = expire time (24 hours)
    const result = await redis.set(key, '1', 'EX', 86400, 'NX');
    return result === null; // null means key already existed
  } catch (error) {
    // F13-FIX: Fail CLOSED on Redis failure. Previously failed open which allowed
    // duplicate processing of financial webhooks (double charges, duplicate plan upgrades).
    // Stripe retries with exponential backoff, so throwing here returns 500 and Stripe
    // will redeliver. Processing a charge twice is worse than delaying it.
    logger.error('Redis unavailable for deduplication - failing closed', error instanceof Error ? error : undefined, { eventId });
    throw new Error('Deduplication service unavailable');
  }
}

/**
 * Maximum retries for signature verification
 * SECURITY FIX: Issue 15 - Signature verification retry
 */
const MAX_SIGNATURE_RETRIES = 3;
const SIGNATURE_RETRY_DELAY_MS = 1000;

/**
 * Delay function for retry logic
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Verify Stripe webhook signature with retry logic
 * SECURITY FIX: Issue 15 - Retry with exponential backoff for transient failures
 */
async function verifyStripeSignatureWithRetry(
  payload: Buffer,
  signature: string,
  secret: string,
  retries: number = MAX_SIGNATURE_RETRIES
): Promise<Stripe.Event | null> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const event = getStripe().webhooks.constructEvent(payload, signature, secret);
      return event;
    } catch (error) {
      const err = error as { message?: string };
      
      // Only retry on transient errors
      const isRetryable = err["message"]?.includes('network') || 
                          err["message"]?.includes('timeout') ||
                          err["message"]?.includes('ECONNRESET');
      
      if (attempt < retries && isRetryable) {
        const backoffDelay = SIGNATURE_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        logger.warn('Signature verification attempt failed, retrying', {
          attempt,
          maxRetries: retries,
          delayMs: backoffDelay
        });
        await delay(backoffDelay);
      } else {
        logger.error('Signature verification failed after all retries', error instanceof Error ? error : undefined);
        return null;
      }
    }
  }
  return null;
}

/**
 * SECURITY FIX: Verify that the orgId belongs to the Stripe customer
 * Prevents org ID spoofing in webhook events
 * @param orgId - Organization ID
 * @param stripeCustomerId - Stripe customer ID
 * @returns Whether org belongs to customer
 */
async function verifyOrgBelongsToCustomer(
  orgId: string,
  stripeCustomerId: string
): Promise<boolean> {
  const db = await getDb();
  const org = await db('orgs')
    .where({
      id: orgId,
      stripe_customer_id: stripeCustomerId
    })
    .select('id')
    .first();
  return !!org;
}

/**
 * Handle raw Stripe webhook payload
 * @param payload - Raw request body
 * @param sig - Stripe signature header
 * @returns Promise that resolves when webhook is processed
 */
export async function handleStripeWebhookRaw(
  payload: Buffer,
  sig: string
): Promise<void> {
  const webhookSecret = process.env['STRIPE_WEBHOOK_SECRET'];
  if (!webhookSecret) {
    throw new Error('STRIPE_WEBHOOK_SECRET environment variable is required');
  }
  
  // SECURITY FIX: Issue 15 - Verify signature with retry logic
  const event = await verifyStripeSignatureWithRetry(payload, sig, webhookSecret);
  
  if (!event) {
    // F39-FIX: Alert on signature verification failure. Repeated failures indicate
    // either an attacker probing the endpoint or a Stripe key rotation issue.
    logger.error('ALERT: Stripe webhook signature verification failed - possible attack or key rotation issue');
    throw new Error('Invalid Stripe signature');
  }

  // SECURITY FIX: Issue 16 - Validate event type against allowlist
  if (!isAllowedEventType(event.type)) {
    logger.warn('Rejected disallowed event type', { eventType: event.type });
    throw new Error(`Event type not allowed: ${event.type}`);
  }

  // SECURITY FIX: Issue 17 - Add timeout for event processing
  const processingTimeout = 25000;
  await Promise.race([
    processEvent(event),
    new Promise<never>((_, reject) => 
      setTimeout(() => reject(new Error('Event processing timeout')), processingTimeout)
    ),
  ]);
}

/**
 * Process Stripe event based on type
 */
async function processEvent(event: Stripe.Event): Promise<void> {
  // P0-FIX: Check for duplicate events
  if (await isDuplicateEvent(event.id)) {
    logger.info('Duplicate event ignored', { eventId: event.id, eventType: event.type });
    return;
  }

  // P1-FIX: Changed from if/if/if to switch statement. The previous pattern used
  // separate `if` blocks (not if/else if), meaning multiple blocks could theoretically
  // execute for a single event. While Stripe event types are mutually exclusive today,
  // a switch ensures only one handler runs and makes the mutual exclusivity explicit.
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const orgId = session.metadata?.['orgId'];
      const stripeCustomerId = session.customer as string | undefined;

      if (!orgId || !stripeCustomerId) return;

      // SECURITY FIX: Verify that the orgId belongs to the Stripe customer
      const isValidOrg = await verifyOrgBelongsToCustomer(orgId, stripeCustomerId);
      if (!isValidOrg) {
        const sanitizedOrgId = orgId.substring(0, 8) + '...';
        const sanitizedCustomerId = stripeCustomerId.substring(0, 8) + '...';
        logger.error('Security violation: org does not match Stripe customer', undefined, {
          orgId: sanitizedOrgId,
          customerId: sanitizedCustomerId
        });
        throw new Error('Org verification failed: orgId does not belong to Stripe customer');
      }

      const db = await getDb();
      await db.transaction(async (trx) => {
        await trx('orgs')
          .where({ id: orgId })
          .update({ plan: 'pro', plan_status: 'active' });

        await trx('audit_events').insert({
          org_id: orgId,
          actor_type: 'system',
          action: 'billing_plan_upgraded',
          metadata: JSON.stringify({ provider: 'stripe', sessionId: session.id })
        });
      });
      break;
    }

    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription;
      if (sub.cancel_at_period_end) {
        const db = await getDb();
        await db('orgs')
          .where({ stripe_customer_id: sub.customer })
          .update({ plan_status: 'canceling' });
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      const db = await getDb();
      await db('orgs')
        .where({ stripe_customer_id: sub.customer })
        .update({ plan_status: 'cancelled' });
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = invoice.customer as string;

      const db = await getDb();
      await db.transaction(async (trx) => {
        await trx('orgs')
          .where({ stripe_customer_id: customerId })
          .update({
            plan_status: 'past_due',
            read_only_mode: true,
            payment_failed_at: new Date(),
            updated_at: new Date(),
          });

        await trx('alerts').insert({
          severity: 'critical',
          category: 'billing',
          title: 'Payment Failed',
          message: `Payment failed for customer ${customerId.substring(0, 8)}...`,
          metadata: JSON.stringify({
            invoiceId: invoice.id,
            amount: invoice.amount_due,
            customerId: customerId.substring(0, 8) + '...'
          }),
          created_at: new Date(),
        });
      });

      logger.info('Payment failed - org set to read-only mode', {
        customerId: customerId.substring(0, 8) + '...'
      });
      break;
    }

    default:
      // Event type was already validated against allowlist in handleStripeWebhookRaw
      logger.info('Event type accepted but no handler implemented', { eventType: event.type });
      break;
  }
}

/**
 * Get allowed event types (for documentation/testing)
 */
export function getAllowedEventTypes(): string[] {
  return Array.from(ALLOWED_EVENT_TYPES);
}
