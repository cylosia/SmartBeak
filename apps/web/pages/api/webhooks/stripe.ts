
import Redis from 'ioredis';
import type { NextApiRequest, NextApiResponse } from 'next';

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
 * Verify Stripe signature with retry logic
 * SECURITY FIX: Issue 15 - Signature verification retry
 */
async function verifyStripeSignatureWithRetry(
  payload: Buffer,
  signature: string,
  secret: string,
  maxRetries: number = 3
): Promise<Stripe.Event | null> {
  const stripeClient = getStripe();
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const event = stripeClient.webhooks.constructEvent(payload, signature, secret);
      return event;
    } catch (error) {
      // Only retry on specific errors
      const err = error as { message?: string };
      const isRetryable = err.message?.includes('network') || 
                          err.message?.includes('timeout') ||
                          err.message?.includes('ECONNRESET');
      
      if (attempt < maxRetries && isRetryable) {
        const delay = Math.pow(2, attempt) * 100; // Exponential backoff
        logger.warn('Signature verification attempt failed, retrying', { attempt, delayMs: delay });
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        logger.error('Signature verification failed after all retries', error as Error);
        return null;
      }
    }
  }
  
  return null;
}

import Stripe from 'stripe';

/**
* Main webhook handler
*/
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const webhookSecret = getStripeWebhookSecret();
  if (!webhookSecret) {
    logger.error('STRIPE_WEBHOOK_SECRET not configured');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  const sig = req.headers['stripe-signature'] as string;
  if (!sig) {
    return res.status(400).json({ error: 'Missing stripe-signature header' });
  }

  let event: Stripe.Event;

  try {
    const buf = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let totalSize = 0;
      req.on('data', (chunk) => {
        const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        totalSize += bufferChunk.length;
        if (totalSize > MAX_PAYLOAD_SIZE) {
          res.status(413).json({ error: 'Payload too large' });
          req.destroy();
          return;
        }
        chunks.push(bufferChunk);
      });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });

    // SECURITY FIX: Issue 15 - Verify signature with retry logic
    const verifiedEvent = await Promise.race([
      verifyStripeSignatureWithRetry(buf, sig, webhookSecret),
      new Promise<null>((_, reject) => 
        setTimeout(() => reject(new Error('Signature verification timeout')), 10000)
      ),
    ]);
    
    if (!verifiedEvent) {
      return res.status(400).json({ error: 'Webhook signature verification failed' });
    }
    
    event = verifiedEvent;
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error('Signature verification failed', error);
    return res.status(400).json({
      error: 'Webhook signature verification failed',
    });
  }

  // SECURITY FIX (Finding 12): Return 200 for unknown event types to prevent Stripe
  // from disabling the webhook endpoint. Stripe interprets 4xx as permanent failure
  // and will eventually disable the endpoint after repeated failures.
  if (!isAllowedEventType(event.type)) {
    logger.info('Ignoring unhandled event type', { eventType: event.type });
    return res.json({ received: true, ignored: true, eventType: event.type });
  }

  // P1-HIGH FIX: Validate Stripe API version for compatibility
  const expectedApiVersion = '2023-10-16';
  if (event.api_version !== expectedApiVersion) {
    logger.warn('API version mismatch', { 
      receivedVersion: event.api_version, 
      expectedVersion: expectedApiVersion 
    });
    // Continue processing but log warning - can be changed to reject if strict version control is needed
  }

  // P1-FIX: Timestamp validation to prevent replay attacks
  // Stripe includes 'created' timestamp in event (Unix timestamp)
  const eventCreated = event["created"] as number;
  const now = Math.floor(Date.now() / 1000);
  const maxAge = 5 * 60; // 5 minutes
  
  if (!eventCreated || isNaN(eventCreated)) {
    logger.warn('Event missing created timestamp');
    return res.status(400).json({ error: 'Invalid event timestamp' });
  }
  
  if (now - eventCreated > maxAge) {
    logger.warn('Event too old', { ageSeconds: now - eventCreated, maxAge });
    return res.status(400).json({ error: 'Event timestamp too old' });
  }

  // Distributed idempotency check
  if (await isDuplicateEvent(event["id"])) {
    logger.info('Event already processed, skipping', { eventId: event["id"] });
    return res.json({ received: true, idempotent: true });
  }

  logger.info('Received webhook event', { eventType: event.type, eventId: event["id"] });

  try {
    // SECURITY FIX: Issue 17 - Add timeout for event processing
    const processingTimeout = 25000; // 25 seconds (Vercel limit is 30s)
    
    await Promise.race([
      processEvent(event),
      new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Event processing timeout')), processingTimeout)
      ),
    ]);

    res.json({ received: true, type: event.type });
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Error processing event', err, { eventType: event.type, eventId: event["id"] });
    
    // SECURITY FIX: Don't expose internal errors
    res.status(500).json({
      error: 'Processing error',
      code: 'PROCESSING_ERROR',
    });
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

  const orgId = session.metadata?.["orgId"];
  if (!orgId) {
    throw new Error('Checkout session missing orgId metadata');
  }

  // F20-FIX: Verify orgId belongs to the Stripe customer before processing.
  // Without this check, an attacker who controls checkout metadata can upgrade
  // any arbitrary org to a paid plan. The Fastify handler had this check but
  // this Next.js handler did not.
  const customerId = session.customer as string;
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

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: existing } = await client.query(
      'SELECT 1 FROM subscriptions WHERE stripe_subscription_id = $1',
      [session.subscription]
    );

    if (existing.length > 0) {
      logger.info('Subscription already exists, skipping', { subscriptionId: session.subscription });
      await client.query('COMMIT');
      return;
    }

    const stripeClient = getStripe();
    const subscription = await stripeClient.subscriptions.retrieve(session.subscription as string);

    await client.query(
      `INSERT INTO subscriptions (
        id, org_id, stripe_customer_id, stripe_subscription_id,
        status, plan_id, current_period_start, current_period_end,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())`,
      [
        subscription["id"],
        orgId,
        session.customer,
        subscription["id"],
        subscription.status,
        subscription.items.data[0]?.price["id"],
        new Date(subscription.current_period_start * 1000),
        new Date(subscription.current_period_end * 1000),
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
    logger.info('Subscription activated', { orgId, subscriptionId: subscription["id"] });
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
  logger.info('Subscription created', { subscriptionId: subscription["id"] });

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

    const orgId = orgRows[0].id;

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
        subscription.items.data[0]?.price?.id,
        new Date(subscription.current_period_start * 1000),
        new Date(subscription.current_period_end * 1000),
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
    subscriptionId: subscription["id"], 
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
        subscription["id"],
        subscription.status,
        new Date(subscription.current_period_start * 1000),
        new Date(subscription.current_period_end * 1000),
      ]
    );

    const orgStatus = subscription.status === 'active' ? 'active' :
              subscription.status === 'past_due' ? 'past_due' :
              subscription.status;

    await client.query(
      `UPDATE organizations
      SET subscription_status = $2,
        updated_at = NOW()
      WHERE id = (SELECT org_id FROM subscriptions WHERE stripe_subscription_id = $1)`,
      [subscription["id"], orgStatus]
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
  logger.info('Subscription cancelled', { subscriptionId: subscription["id"] });

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

    const { rows } = await client.query(
      `UPDATE organizations
      SET subscription_status = 'cancelled',
        read_only_until = NOW() + INTERVAL '7 days',
        updated_at = NOW()
      WHERE id = (SELECT org_id FROM subscriptions WHERE stripe_subscription_id = $1)
      RETURNING id`,
      [subscription.id]
    );

    if (rows.length > 0) {
      logger.info('Org set to read-only mode (7 day grace)', { orgId: rows[0]["id"] });
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
  logger.info('Payment failed', { invoiceId: invoice["id"] });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT s.org_id, o.name
      FROM subscriptions s
      JOIN organizations o ON o["id"] = s.org_id
      WHERE s.stripe_customer_id = $1`,
      [invoice.customer]
    );

    if (rows.length === 0) {
      logger.warn('No subscription found for customer', { customerId: invoice.customer });
      await client.query('COMMIT');
      return;
    }

    const orgId = rows[0].org_id;

    await client.query(
      `UPDATE organizations
      SET subscription_status = 'past_due',
        read_only_mode = true,
        payment_failed_at = NOW(),
        updated_at = NOW()
      WHERE id = $1`,
      [orgId]
    );

    await client.query(
      `INSERT INTO alerts (id, severity, category, title, message, metadata, created_at)
      VALUES ($1, 'critical', 'billing', 'Payment Failed', 'Payment failed for organization', $2, NOW())`,
      [
        `payment-failed-${invoice["id"]}`,
        JSON.stringify({
          orgId,
          invoiceId: invoice["id"],
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
  logger.info('Payment succeeded', { invoiceId: invoice["id"] });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE organizations
      SET subscription_status = 'active',
        read_only_mode = false,
        payment_failed_at = NULL,
        updated_at = NOW()
      WHERE id = (SELECT org_id FROM subscriptions WHERE stripe_customer_id = $1)
      AND read_only_mode = true`,
      [invoice.customer]
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
