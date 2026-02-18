import { getDb } from '../db';
import crypto from 'crypto';
import { getRedis } from '@kernel/redis';
import { getLogger } from '@kernel/logger';
import { getBusinessKpis, getSloTracker } from '@packages/monitoring';

/**
 * P0-FIX: Verify Paddle webhook signature using raw body
 * Previous implementation used sorted keys which is INCORRECT and allows forgery
 * 
 * Paddle signs the raw request body, not a sorted key representation.
 * Using sorted keys breaks signature verification and allows attackers
 * to forge webhooks by sending events with different key ordering.
 * 
 * @param rawBody - Raw request body buffer (NOT parsed JSON)
 * @param signature - Signature from Paddle-Signature header
 * @param secret - Webhook secret from Paddle dashboard
 */

const logger = getLogger('PaddleWebhook');

function verifyPaddleSignature(rawBody: Buffer, signature: string, secret: string): boolean {
  // P0-FIX: Use raw body for HMAC calculation (not sorted keys)
  const hash = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  try {
    const sigBuf = Buffer.from(signature, 'utf8');
    const hashBuf = Buffer.from(hash, 'utf8');
    return sigBuf.length === hashBuf.length && crypto.timingSafeEqual(sigBuf, hashBuf);
  }
  catch {
    return false;
  }
}

/**
 * P0-FIX: Check if webhook event was already processed (idempotency)
 * Prevents replay attacks and duplicate processing on redeploys
 */
async function isDuplicateEvent(eventId: string): Promise<boolean> {
  try {
    const redis = await getRedis();
    const key = `webhook:paddle:event:${eventId}`;
    // P0-FIX: Atomic SET NX (set if not exists) replaces the previous non-atomic
    // GET + SETEX pattern. Under concurrent delivery (Paddle retries on 5xx) two
    // workers could both pass the GET check before either sets the key, causing
    // double plan upgrades. SET NX is a single atomic Redis command: it sets the
    // key and returns OK only if the key did not exist, null if it already existed.
    const result = await redis.set(key, '1', 'EX', 86400, 'NX');
    // result === null  → key already existed → duplicate event
    // result === 'OK'  → key was freshly set → first time seeing this event
    return result === null;
  } catch (error) {
    // P0-FIX: Fail CLOSED on Redis failure — match Stripe's behavior.
    // Previously failed open ("return false"), allowing duplicate processing of
    // financial webhooks during Redis downtime. Paddle retries with exponential
    // backoff, so throwing here returns 500 and Paddle will redeliver later.
    // Processing a payment twice (double plan upgrade, duplicate audit entries)
    // is worse than delaying it.
    logger.error('Redis unavailable for deduplication - failing closed', error instanceof Error ? error : undefined, { eventId });
    throw new Error('Deduplication service unavailable');
  }
}

/**
 * P0-FIX: Handle Paddle webhook with proper security
 * - Raw body signature verification (prevents forgery)
 * - Event deduplication (prevents replay attacks)
 * - Event type allowlist (prevents unhandled event processing)
 */
export async function handlePaddleWebhook(
  rawBody: Buffer, 
  signature: string,
  eventId: string
): Promise<void> {
  // Validate environment variable
  const secret = process.env['PADDLE_WEBHOOK_SECRET'];
  if (!secret) {
    throw new Error('PADDLE_WEBHOOK_SECRET not configured');
  }

  // P0-FIX: Verify signature BEFORE parsing payload
  // Prevents org_id spoofing in unverified webhooks
  if (!verifyPaddleSignature(rawBody, signature, secret)) {
    throw new Error('Invalid Paddle signature');
  }

  // Parse payload AFTER verification
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    throw new Error('Invalid JSON payload');
  }

  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid payload: expected object');
  }

  // P0-FIX: Validate event timestamp to prevent replay attacks
  const occurredAt = payload['occurred_at'];
  if (!occurredAt || typeof occurredAt !== 'string') {
    throw new Error('Missing occurred_at timestamp');
  }

  const eventTime = new Date(occurredAt).getTime();
  const now = Date.now();
  const fiveMinutes = 5 * 60 * 1000;

  if (isNaN(eventTime)) {
    throw new Error('Invalid occurred_at timestamp format');
  }

  if (Math.abs(now - eventTime) > fiveMinutes) {
    throw new Error(`Event timestamp too old or in future: ${occurredAt}`);
  }

  // P0-FIX: Event deduplication - prevent replay attacks
  if (await isDuplicateEvent(eventId)) {
    logger.info('Duplicate event ignored', { eventId });
    try { getBusinessKpis().recordWebhookDuplicate('paddle'); } catch { /* not initialized */ }
    return;
  }

  const event_type = payload['event_type'];
  if (!event_type || typeof event_type !== 'string') {
    throw new Error('Invalid payload: missing or invalid event_type');
  }

  // P0-FIX: Event type allowlist - only process expected events
  const ALLOWED_EVENT_TYPES = new Set([
    'subscription.created',
    'subscription.updated',
    'subscription.cancelled',
    'transaction.completed',
    'transaction.failed',
  ]);
  
  if (!ALLOWED_EVENT_TYPES.has(event_type)) {
    logger.warn('Unhandled event type', { eventType: event_type });
    return;
  }

  // P0-FIX: Extract org_id from verified payload
  const org_id = payload['org_id'];
  if (!org_id || typeof org_id !== 'string') {
    throw new Error('Invalid payload: missing or invalid org_id');
  }

  // P0-FIX: Cross-reference org_id with Paddle customer_id to prevent privilege
  // escalation. org_id is attacker-controlled custom_data; without this check any
  // Paddle account holder can upgrade any org by crafting a webhook with a spoofed
  // org_id. We verify the org's stored paddle_customer_id matches the payload.
  const paddleCustomerId = typeof payload['customer_id'] === 'string'
    ? payload['customer_id']
    : (payload['customer'] as { id?: string } | undefined)?.id;

  if (paddleCustomerId) {
    const db = await getDb();
    const { rows: orgRows } = await db.raw(
      'SELECT 1 FROM orgs WHERE id = ? AND paddle_customer_id = ?',
      [org_id, paddleCustomerId]
    );
    if (!orgRows || orgRows.length === 0) {
      logger.warn('org_id/paddle_customer_id mismatch — rejecting webhook', { orgId: org_id, paddleCustomerId });
      throw new Error('org_id does not match Paddle customer record');
    }
  }

  logger.info('Processing event', { eventType: event_type, orgId: org_id });

  try {
  if (event_type === 'subscription.created' || event_type === 'subscription.updated') {
    if (payload['customer'] && typeof payload['customer'] !== 'object') {
      throw new Error('Invalid customer data in payload');
    }

    // P1-FIX: For subscription.updated, inspect the new status before upgrading.
    // Previously all subscription.updated events were treated as upgrades.
    // A subscription.updated event can also represent a pause, downgrade, or
    // failed payment — in those cases we must not upgrade the org to pro.
    const subscriptionStatus = typeof payload['status'] === 'string' ? payload['status'] : null;
    const isActiveSubscription = event_type === 'subscription.created' || subscriptionStatus === 'active';

    if (!isActiveSubscription) {
      logger.info('subscription.updated with non-active status — not upgrading', { orgId: org_id, status: subscriptionStatus });
      return;
    }

    const db = await getDb();

    // P0-FIX: Wrap check-and-update in a transaction to prevent race conditions
    // from concurrent webhook deliveries creating duplicate audit entries or
    // racing on the plan upgrade. Previously this was 3 separate queries with
    // no transaction (SELECT + UPDATE + INSERT), unlike the subscription.cancelled
    // path which correctly used a transaction.
    await db.transaction(async (trx) => {
      const existingSub = await trx('orgs')
        .where({ id: org_id })
        .select('plan', 'plan_status')
        .first();

      if (existingSub?.plan === 'pro' && existingSub?.plan_status === 'active') {
        logger.info('Org already has active pro plan, skipping', { orgId: org_id });
        return;
      }

      await trx('orgs')
        .where({ id: org_id })
        .update({ plan: 'pro', plan_status: 'active' });

      await trx('audit_events').insert({
        org_id,
        actor_type: 'system',
        action: 'billing_plan_upgraded',
        metadata: JSON.stringify({
          provider: 'paddle',
          event_type,
          subscription_id: payload['subscription_id'],
          customer_email: (payload['customer'] as { email?: string } | undefined)?.email,
          event_id: eventId,
        })
      });

      logger.info('Org upgraded to pro plan', { orgId: org_id });
    });
  }

  if (event_type === 'subscription.cancelled') {
    const db = await getDb();
    
    // P1-HIGH FIX: Wrap check-and-update in transaction with SELECT FOR UPDATE
    // Prevents race condition when multiple subscriptions cancel simultaneously
    await db.transaction(async (trx) => {
      // Lock the subscription row to prevent concurrent modifications
      const { rows } = await trx.raw(
        `SELECT * FROM paddle_subscriptions 
         WHERE org_id = ? 
         AND status = 'active'
         AND subscription_id != ?
         FOR UPDATE`,
        [org_id, payload['subscription_id'] as string]
      );
      
      if (rows.length === 0) {
        // No other active subscriptions, downgrade
        await trx('orgs')
          .where({ id: org_id })
          .update({ plan: 'free', plan_status: 'cancelled' });
        
        logger.info('Org plan cancelled (no other active subscriptions)', { orgId: org_id });
      } else {
        logger.info('Org has other active subscriptions, keeping pro plan', { orgId: org_id });
      }
      
      await trx('audit_events').insert({
        org_id,
        actor_type: 'system',
        action: 'billing_plan_cancelled',
        metadata: JSON.stringify({
          provider: 'paddle',
          subscription_id: payload['subscription_id'],
          event_id: eventId,
          remaining_active_subscriptions: rows.length,
        })
      });
    });
  }

  try {
    getBusinessKpis().recordWebhookProcessed('paddle');
    getSloTracker().recordSuccess('slo.webhook.processing_rate');
  } catch { /* not initialized */ }
  } catch (error) {
    try {
      getBusinessKpis().recordWebhookFailed('paddle');
      getSloTracker().recordFailure('slo.webhook.processing_rate');
    } catch { /* not initialized */ }
    throw error;
  }
}

export interface PaddleSubscriptionPayload {
  org_id: string;
  event_type: string;
  subscription_id?: string;
  customer?: {
    id: string;
    email: string;
  };
}
