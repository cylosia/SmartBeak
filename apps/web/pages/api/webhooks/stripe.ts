
import Redis from 'ioredis';
import type { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';

import { getLogger } from '@kernel/logger';
import { pool } from '../../../lib/db';
import { getStripe, getStripeWebhookSecret } from '../../../lib/stripe';

const logger = getLogger('StripeWebhook');

/**
* Stripe webhook handler
* Processes subscription lifecycle events with distributed idempotency
* 
* P1-HIGH SECURITY FIXES:
* - Issue 15: Missing signature verification retry
* - Issue 16: Missing event type allowlist
* - Issue 17: Missing request timeout
* - Issue 22: Secrets exposed in error messages
* - API Version Check: Validate Stripe API version for compatibility
*/

export const config = { api: { bodyParser: false } };

/**
* Maximum allowed payload size for webhooks (10MB)
* SECURITY FIX: P1 - Backpressure protection against memory exhaustion
*/
const MAX_PAYLOAD_SIZE = 10 * 1024 * 1024; // 10MB

// Redis client - P0-FIX: No in-memory fallback in serverless
let redis: Redis | null = null;

const EVENT_ID_TTL_SECONDS = 86400; // 24 hours

/**
* Allowed Stripe event types
* SECURITY FIX: Issue 16 - Event type allowlist
 */
const ALLOWED_EVENT_TYPES = new Set([
  'checkout.session.completed',
  'checkout.session.expired',
  'customer.created',
  'customer.updated',
  'customer.deleted',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.trial_will_end',
  'invoice.created',
  'invoice.finalized',
  'invoice.payment_failed',
  'invoice.payment_succeeded',
  'invoice.paid',
  'invoice.upcoming',
  'invoice.updated',
  'payment_intent.created',
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'payment_method.attached',
  'payment_method.detached',
  'payment_method.updated',
  'price.created',
  'price.updated',
  'product.created',
  'product.updated',
  'product.deleted',
]);

/**
* Check if event type is in allowlist
* SECURITY FIX: Issue 16 - Event type validation
 */
function isAllowedEventType(eventType: string): boolean {
  return ALLOWED_EVENT_TYPES.has(eventType);
}

/**
* Get or create Redis client
* P0-FIX: Fail fast if REDIS_URL not set (no localhost fallback in serverless)
*/
function getRedis(): Redis | null {
  if (redis) return redis;

  // P0-FIX: Fail fast if REDIS_URL not set
  const redisUrl = process.env['REDIS_URL'];
  if (!redisUrl) {
    throw new Error('REDIS_URL environment variable is required');
  }

  try {
    redis = new Redis(redisUrl, {
      retryStrategy: (times) => {
        if (times > 3) {
          logger.error('Redis connection failed after retries');
          return null; // Stop retrying
        }
        return Math.min(times * 100, 3000);
      },
      maxRetriesPerRequest: 3,
    });

    redis.on('error', (err) => {
      logger.error('Redis error', err);
    });

    return redis;
  } catch (error) {
    logger.error('Failed to create Redis client', error as Error);
    return null;
  }
}

/**
* Check if event was already processed (distributed across instances)
* P0-FIX: Fail closed - no in-memory fallback in serverless
*/
async function isDuplicateEvent(eventId: string): Promise<boolean> {
  const client = getRedis();
  if (!client) {
    // P0-FIX: Fail closed - can't verify deduplication
    logger.error('Redis unavailable, cannot verify deduplication');
    throw new Error('Service temporarily unavailable');
  }

  const key = `stripe:processed:${eventId}`;
  try {
    // NX = only set if not exists, EX = expire time
    const result = await client.set(key, '1', 'EX', EVENT_ID_TTL_SECONDS, 'NX');
    return result === null; // null means key already existed
  } catch (error) {
    logger.error('Redis error, cannot verify deduplication', error as Error);
    throw new Error('Service temporarily unavailable');
  }
}

/**
* Main webhook handler
*/
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // P0-FIX: getStripeWebhookSecret now throws on misconfiguration instead of returning
  // empty string, so callers don't need a falsy guard. Wrap in try/catch to surface clearly.
  let webhookSecret: string;
  try {
    webhookSecret = getStripeWebhookSecret();
  } catch (err: unknown) {
    logger.error('Stripe webhook secret not configured', err instanceof Error ? err : new Error(String(err)));
    return res.status(500).json({ error: 'Webhook misconfigured' });
  }

  // P1-FIX: req.headers[key] is string | string[] | undefined in Node.js/Next.js.
  // An attacker (or misconfigured proxy) can send multiple stripe-signature headers,
  // producing a string[] here. We must reject array values explicitly.
  const rawSig = req.headers['stripe-signature'];
  if (!rawSig || Array.isArray(rawSig)) {
    logger.warn('Invalid stripe-signature header', { type: Array.isArray(rawSig) ? 'array' : 'missing' });
    return res.status(400).json({ error: 'Missing or invalid stripe-signature header' });
  }
  const sig: string = rawSig;

  let event: Stripe.Event;

  try {
    const buf = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let totalSize = 0;
      let destroyed = false;
      req.on('data', (chunk) => {
        if (destroyed) return;
        const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        totalSize += bufferChunk.length;
        if (totalSize > MAX_PAYLOAD_SIZE) {
          destroyed = true;
          req.destroy();
          reject(new Error('Payload too large'));
          return;
        }
        chunks.push(bufferChunk);
      });
      req.on('end', () => { if (!destroyed) resolve(Buffer.concat(chunks)); });
      req.on('error', reject);
    });

    // P0-FIX: Removed verifyStripeSignatureWithRetry. webhooks.constructEvent is a pure
    // local HMAC computation — it never makes network calls and cannot throw network/timeout
    // errors. Retrying a failed cryptographic verification is semantically wrong: a failure
    // means the signature is invalid (possible forgery) or the payload was mutated, not a
    // transient error. Retry logic also blunts alerting by emitting 3 warning logs before one error.
    // The Stripe SDK's constructEvent already enforces replay protection via the `t=` timestamp
    // claim in the stripe-signature header (5-minute tolerance window), so a separate manual
    // timestamp check (previously at lines 259-273) is both redundant and harmful — it rejected
    // all legitimate Stripe retries delivered more than 5 minutes after initial failure.
    try {
      event = getStripe().webhooks.constructEvent(buf, sig, webhookSecret);
    } catch (sigErr: unknown) {
      const error = sigErr instanceof Error ? sigErr : new Error(String(sigErr));
      logger.warn('Webhook signature verification failed', { message: error.message });
      return res.status(400).json({ error: 'Webhook signature verification failed' });
    }
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    if (error.message === 'Payload too large') {
      return res.status(413).json({ error: 'Payload too large' });
    }
    logger.error('Failed to read webhook payload', error);
    return res.status(400).json({ error: 'Webhook payload read failed' });
  }

  // Return 200 for unknown event types to prevent Stripe from disabling the endpoint.
  // Stripe interprets 4xx as permanent failure and will eventually disable the endpoint.
  if (!isAllowedEventType(event.type)) {
    logger.info('Ignoring unhandled event type', { eventType: event.type });
    // P3-FIX: Do not echo back eventType — minimum disclosure principle.
    return res.json({ received: true });
  }

  // Log API version mismatches for observability but continue processing.
  const expectedApiVersion = '2023-10-16';
  if (event.api_version !== expectedApiVersion) {
    logger.warn('Stripe API version mismatch', {
      receivedVersion: event.api_version,
      expectedVersion: expectedApiVersion,
    });
  }

  // P1-FIX: Distributed idempotency check. Note: the Redis key is set atomically BEFORE
  // processing. If processEvent() fails, we delete the key so Stripe can retry.
  if (await isDuplicateEvent(event.id)) {
    logger.info('Event already processed, skipping', { eventId: event.id });
    return res.json({ received: true, idempotent: true });
  }

  logger.info('Received webhook event', { eventType: event.type, eventId: event.id });

  try {
    const processingTimeout = 25000; // 25 seconds (Vercel limit is 30s)
    await Promise.race([
      processEvent(event),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Event processing timeout')), processingTimeout)
      ),
    ]);

    res.json({ received: true });
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Error processing event', err, { eventType: event.type, eventId: event.id });

    // P1-FIX: Remove the Redis deduplication key on failure so Stripe can retry.
    // Without this, a transient failure marks the event as "processed" permanently,
    // causing permanent data loss (e.g., subscription never activated after DB hiccup).
    const redisClient = getRedis();
    if (redisClient) {
      await redisClient.del(`stripe:processed:${event.id}`).catch((delErr: unknown) => {
        logger.warn('Failed to remove idempotency key after processing error', {
          eventId: event.id,
          error: delErr instanceof Error ? delErr.message : String(delErr),
        });
      });
    }

    res.status(500).json({ error: 'Processing error', code: 'PROCESSING_ERROR' });
  }
}

/**
 * Process Stripe event with timeout protection
 */
async function processEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed': {
      await handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
      break;
    }

    case 'customer.subscription.created': {
      await handleSubscriptionCreated(event.data.object as Stripe.Subscription);
      break;
    }

    case 'customer.subscription.updated': {
      await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
      break;
    }

    case 'customer.subscription.deleted': {
      await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
      break;
    }

    case 'invoice.payment_failed': {
      await handlePaymentFailed(event.data.object as Stripe.Invoice);
      break;
    }

    case 'invoice.payment_succeeded': {
      await handlePaymentSucceeded(event.data.object as Stripe.Invoice);
      break;
    }

    // F19-FIX: Handle customer.deleted to prevent orphaned subscription records
    case 'customer.deleted': {
      await handleCustomerDeleted(event.data.object as Stripe.Customer);
      break;
    }

    default:
      logger.info('Unhandled event type', { eventType: event.type });
  }
}

async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session): Promise<void> {
  logger.info('Checkout completed', { customerId: session.customer as string });

  const orgId = session.metadata?.['orgId'];
  if (!orgId) {
    throw new Error('Checkout session missing orgId metadata');
  }

  // F20-FIX: Verify orgId belongs to the Stripe customer before processing.
  // Without this check, an attacker who controls checkout metadata can upgrade
  // any arbitrary org to a paid plan. The Fastify handler had this check but
  // this Next.js handler did not.
  // Stripe types session.customer as string | Customer | DeletedCustomer | null.
  // In webhook payloads (without explicit expand[]) it is always a string customer ID.
  // We still extract safely to defend against future API changes.
  const rawCustomer = session.customer;
  const customerId: string | null = typeof rawCustomer === 'string' ? rawCustomer
    : rawCustomer !== null && typeof rawCustomer === 'object' && 'id' in rawCustomer
      ? String((rawCustomer as { id: unknown }).id)
      : null;

  if (customerId) {
    const verifyClient = await pool.connect();
    try {
      const { rows: orgRows } = await verifyClient.query(
        'SELECT id FROM organizations WHERE id = $1 AND stripe_customer_id = $2',
        [orgId, customerId]
      );
      if (orgRows.length === 0) {
        logger.error('Security violation: orgId does not belong to Stripe customer', undefined, {
          orgId: orgId.substring(0, 8) + '...',
          customerId: customerId.substring(0, 8) + '...',
        });
        throw new Error('Org verification failed: orgId does not belong to Stripe customer');
      }
    } finally {
      verifyClient.release();
    }
  }

  // P0-FIX: Null check session.subscription before casting to string.
  // session.subscription is typed as string | Stripe.Subscription | null. In non-subscription
  // checkout modes it can be null; casting null as string produces "null" which silently
  // inserts a bad record or causes a runtime crash on subscriptions.retrieve("null").
  const subscriptionId = session.subscription;
  if (typeof subscriptionId !== 'string' || !subscriptionId) {
    throw new Error('Checkout session has no subscription ID — not a subscription mode checkout');
  }

  // P0-FIX: Fetch from Stripe BEFORE acquiring the DB connection.
  // Previously stripeClient.subscriptions.retrieve() was called while holding an open
  // DB connection inside a BEGIN transaction. A slow Stripe response (>1s is common)
  // holds the connection from the pool, causing pool exhaustion under webhook storms.
  // Additionally, if idle_in_transaction_session_timeout fires during the Stripe call,
  // PostgreSQL rolls back the transaction silently, causing COMMIT to be a no-op and
  // the subscription to never be recorded.
  const stripeClient = getStripe();
  const subscription = await stripeClient.subscriptions.retrieve(subscriptionId);

  // P2-FIX: Validate price ID — data[0]?.price?.id silently inserts NULL plan_id which
  // breaks downstream billing logic. Fail hard rather than store a NULL.
  const priceId = subscription.items.data[0]?.price?.id;
  if (!priceId) {
    throw new Error(`Subscription ${subscription.id} has no price ID in items`);
  }

  // P2-FIX: Validate period end — current_period_end is null for incomplete_expired subs;
  // null * 1000 = 0 which inserts 1970-01-01 causing immediate account lockout.
  const periodStart = subscription.current_period_start;
  const periodEnd = subscription.current_period_end;
  if (!periodEnd) {
    throw new Error(`Subscription ${subscription.id} has no current_period_end`);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: existing } = await client.query<{ id: string }>(
      'SELECT 1 FROM subscriptions WHERE stripe_subscription_id = $1',
      [subscriptionId]
    );

    if (existing.length > 0) {
      logger.info('Subscription already exists, skipping', { subscriptionId });
      await client.query('COMMIT');
      return;
    }

    await client.query(
      `INSERT INTO subscriptions (
        id, org_id, stripe_customer_id, stripe_subscription_id,
        status, plan_id, current_period_start, current_period_end,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())`,
      [
        subscription.id,
        orgId,
        session.customer,
        subscription.id,
        subscription.status,
        priceId,
        new Date(periodStart * 1000),
        new Date(periodEnd * 1000),
      ]
    );

    await client.query(
      `UPDATE organizations
      SET subscription_status = 'active',
        updated_at = NOW()
      WHERE id = $1`,
      [orgId]
    );

    await client.query('COMMIT');
    logger.info('Subscription activated', { orgId, subscriptionId: subscription.id });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// F24-FIX: Implement subscription.created handler. Previously was empty (just logged),
// meaning subscriptions created outside checkout flow (Stripe dashboard, API) had no DB record.
async function handleSubscriptionCreated(subscription: Stripe.Subscription): Promise<void> {
  logger.info('Subscription created', { subscriptionId: subscription.id });

  const customerId = subscription.customer as string;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check if subscription already exists (idempotency)
    const { rows: existing } = await client.query(
      'SELECT 1 FROM subscriptions WHERE stripe_subscription_id = $1',
      [subscription.id]
    );

    if (existing.length > 0) {
      logger.info('Subscription already exists, skipping', { subscriptionId: subscription.id });
      await client.query('COMMIT');
      return;
    }

    // Find org by Stripe customer ID
    const { rows: orgRows } = await client.query(
      'SELECT id FROM organizations WHERE stripe_customer_id = $1',
      [customerId]
    );

    if (orgRows.length === 0) {
      logger.warn('No organization found for Stripe customer', { customerId: customerId.substring(0, 8) + '...' });
      await client.query('COMMIT');
      return;
    }

    // P2-FIX: Use explicit null guard for noUncheckedIndexedAccess — orgRows[0] is typed
    // as `{ id: string } | undefined` under strictPropertyInitialization. The length check
    // above makes this unreachable, but TypeScript requires the guard for type narrowing.
    const firstOrgRow = orgRows[0];
    if (!firstOrgRow) {
      await client.query('COMMIT');
      return;
    }
    const orgId = firstOrgRow['id'] as string;

    // P2-FIX: Validate price ID and period end (same rationale as handleCheckoutSessionCompleted).
    const priceId = subscription.items.data[0]?.price?.id;
    if (!priceId) {
      throw new Error(`Subscription ${subscription.id} has no price ID in items`);
    }
    const periodEnd = subscription.current_period_end;
    if (!periodEnd) {
      throw new Error(`Subscription ${subscription.id} has no current_period_end`);
    }

    await client.query(
      `INSERT INTO subscriptions (
        id, org_id, stripe_customer_id, stripe_subscription_id,
        status, plan_id, current_period_start, current_period_end,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())`,
      [
        subscription.id,
        orgId,
        customerId,
        subscription.id,
        subscription.status,
        priceId,
        new Date(subscription.current_period_start * 1000),
        new Date(periodEnd * 1000),
      ]
    );

    await client.query('COMMIT');
    logger.info('Subscription record created', { orgId, subscriptionId: subscription.id });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
  logger.info('Subscription updated', { 
    subscriptionId: subscription.id, 
    status: subscription.status 
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE subscriptions SET
        status = $2,
        current_period_start = $3,
        current_period_end = $4,
        updated_at = NOW()
      WHERE stripe_subscription_id = $1`,
      [
        subscription.id,
        subscription.status,
        new Date(subscription.current_period_start * 1000),
        new Date(subscription.current_period_end * 1000),
      ]
    );

    const orgStatus = subscription.status === 'active' ? 'active' :
              subscription.status === 'past_due' ? 'past_due' :
              subscription.status;

    // P0-FIX: Replaced scalar subquery UPDATE with JOIN-based UPDATE.
    // The subquery `(SELECT org_id FROM subscriptions WHERE stripe_subscription_id = $1)`
    // returns NULL when no subscription row exists, causing `WHERE id = NULL` to silently
    // match zero rows (no error, no update). If multiple subscriptions matched (edge case),
    // PostgreSQL would throw "more than one row returned by subquery", crashing the handler.
    await client.query(
      `UPDATE organizations o
       SET subscription_status = $2,
           updated_at = NOW()
       FROM subscriptions s
       WHERE s.stripe_subscription_id = $1
         AND o.id = s.org_id`,
      [subscription.id, orgStatus]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
  logger.info('Subscription cancelled', { subscriptionId: subscription.id });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE subscriptions SET
        status = 'cancelled',
        cancelled_at = NOW(),
        updated_at = NOW()
      WHERE stripe_subscription_id = $1`,
      [subscription.id]
    );

    // P0-FIX: Replaced scalar subquery UPDATE with JOIN-based UPDATE (same rationale
    // as handleSubscriptionUpdated — subquery returning NULL silently matches zero rows).
    const { rows } = await client.query(
      `UPDATE organizations o
       SET subscription_status = 'cancelled',
           read_only_until = NOW() + INTERVAL '7 days',
           updated_at = NOW()
       FROM subscriptions s
       WHERE s.stripe_subscription_id = $1
         AND o.id = s.org_id
       RETURNING o.id`,
      [subscription.id]
    );

    if (rows.length > 0) {
      const firstRow = rows[0] as { id: string } | undefined;
      if (firstRow) {
        logger.info('Org set to read-only mode (7 day grace)', { orgId: firstRow['id'] });
      }
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function handlePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  logger.info('Payment failed', { invoiceId: invoice.id });

  // P1-FIX: invoice.customer is typed as string | Stripe.Customer | Stripe.DeletedCustomer | null.
  // In standard webhook payloads (no expand[]) it is always a bare customer ID string.
  // Expand or future SDK changes can return an object; extract the ID defensively.
  // Also: never log raw customer IDs — truncate for observability without PII leakage.
  const rawCustomer = invoice.customer;
  const customerId: string | null = typeof rawCustomer === 'string' ? rawCustomer
    : rawCustomer !== null && typeof rawCustomer === 'object' && 'id' in rawCustomer
      ? String((rawCustomer as { id: unknown })['id'])
      : null;

  if (!customerId) {
    logger.warn('Invoice has no customer ID, cannot process payment failure', { invoiceId: invoice.id });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT s.org_id, o.name
      FROM subscriptions s
      JOIN organizations o ON o.id = s.org_id
      WHERE s.stripe_customer_id = $1`,
      [customerId]
    );

    if (rows.length === 0) {
      logger.warn('No subscription found for customer', { customerId: customerId.substring(0, 8) + '...' });
      await client.query('COMMIT');
      return;
    }

    // P2-FIX: noUncheckedIndexedAccess — rows[0] is T | undefined; guard before accessing.
    const firstRow = rows[0] as { org_id: string } | undefined;
    if (!firstRow) {
      await client.query('COMMIT');
      return;
    }
    const orgId = firstRow['org_id'];

    await client.query(
      `UPDATE organizations
      SET subscription_status = 'past_due',
        read_only_mode = true,
        payment_failed_at = NOW(),
        updated_at = NOW()
      WHERE id = $1`,
      [orgId]
    );

    // P2-FIX: Added ON CONFLICT (id) DO NOTHING. Without this, Stripe retries of the same
    // invoice.payment_failed event hit a unique constraint violation on `payment-failed-${invoice.id}`,
    // causing the handler to throw a 500, which Stripe interprets as failure and retries again —
    // an infinite retry loop. DO NOTHING is correct: we already processed this alert.
    await client.query(
      `INSERT INTO alerts (id, severity, category, title, message, metadata, created_at)
      VALUES ($1, 'critical', 'billing', 'Payment Failed', 'Payment failed for organization', $2, NOW())
      ON CONFLICT (id) DO NOTHING`,
      [
        `payment-failed-${invoice.id}`,
        JSON.stringify({
          orgId,
          invoiceId: invoice.id,
          amount: invoice.amount_due,
          attemptCount: invoice.attempt_count
        })
      ]
    );

    await client.query('COMMIT');
    logger.info('Org set to READ-ONLY mode due to payment failure', { orgId });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function handlePaymentSucceeded(invoice: Stripe.Invoice): Promise<void> {
  logger.info('Payment succeeded', { invoiceId: invoice.id });

  // P1-FIX: Extract customer ID safely (same as handlePaymentFailed — invoice.customer
  // can be an expanded object, not just a bare string ID).
  const rawSuccessCustomer = invoice.customer;
  const successCustomerId: string | null = typeof rawSuccessCustomer === 'string' ? rawSuccessCustomer
    : rawSuccessCustomer !== null && typeof rawSuccessCustomer === 'object' && 'id' in rawSuccessCustomer
      ? String((rawSuccessCustomer as { id: unknown })['id'])
      : null;

  if (!successCustomerId) {
    logger.warn('Invoice has no customer ID, cannot process payment success', { invoiceId: invoice.id });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // P0-FIX: Replaced scalar subquery UPDATE with JOIN-based UPDATE (same rationale as
    // handleSubscriptionUpdated and handleSubscriptionDeleted). Scalar subquery returning
    // NULL causes WHERE id = NULL which silently matches zero rows.
    await client.query(
      `UPDATE organizations o
       SET subscription_status = 'active',
           read_only_mode = false,
           payment_failed_at = NULL,
           updated_at = NOW()
       FROM subscriptions s
       WHERE s.stripe_customer_id = $1
         AND o.id = s.org_id
         AND o.read_only_mode = true`,
      [successCustomerId]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// F19-FIX: Handle customer.deleted to clean up orphaned subscription records.
// Without this handler, deleting a Stripe customer leaves subscriptions in the DB
// pointing to a non-existent customer, and the org retains its active status.
async function handleCustomerDeleted(customer: Stripe.Customer): Promise<void> {
  logger.info('Customer deleted', { customerId: customer.id.substring(0, 8) + '...' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Cancel all subscriptions for this customer
    await client.query(
      `UPDATE subscriptions SET
        status = 'cancelled',
        cancelled_at = NOW(),
        updated_at = NOW()
      WHERE stripe_customer_id = $1 AND status != 'cancelled'`,
      [customer.id]
    );

    // Set org to cancelled status
    await client.query(
      `UPDATE organizations
      SET subscription_status = 'cancelled',
        stripe_customer_id = NULL,
        updated_at = NOW()
      WHERE stripe_customer_id = $1`,
      [customer.id]
    );

    await client.query('COMMIT');
    logger.info('Customer deletion cleanup completed', { customerId: customer.id.substring(0, 8) + '...' });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
