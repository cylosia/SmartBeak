import crypto from 'crypto';
import type { NextApiRequest, NextApiResponse } from 'next';

import { getLogger } from '@kernel/logger';
import { getRedis } from '@kernel/redis';
import { pool } from '../../../lib/db';

const logger = getLogger('PaddleWebhook');

export const config = { api: { bodyParser: false } };

/**
 * Maximum allowed payload size for webhooks (10MB)
 * Matches Stripe and Clerk webhook handlers
 */
const MAX_PAYLOAD_SIZE = 10 * 1024 * 1024;

const EVENT_ID_TTL_SECONDS = 86400; // 24 hours

const FIVE_MINUTES_MS = 5 * 60 * 1000;

const ALLOWED_EVENT_TYPES = new Set([
  'subscription.created',
  'subscription.updated',
  'subscription.cancelled',
  'transaction.completed',
  'transaction.failed',
]);

/**
 * Verify Paddle webhook signature using HMAC-SHA256 on raw body.
 * Uses timing-safe comparison to prevent timing attacks.
 */
function verifySignature(rawBody: Buffer, signature: string, secret: string): boolean {
  const hash = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  try {
    const sigBuf = Buffer.from(signature, 'utf8');
    const hashBuf = Buffer.from(hash, 'utf8');
    return sigBuf.length === hashBuf.length && crypto.timingSafeEqual(sigBuf, hashBuf);
  } catch {
    return false;
  }
}

/**
 * Parse Paddle-Signature header.
 * Format: "ts=TIMESTAMP;h1=HASH"
 */
function parseSignatureHeader(header: string): { ts: string; h1: string } | null {
  const parts: Record<string, string> = {};
  for (const segment of header.split(';')) {
    const eqIndex = segment.indexOf('=');
    if (eqIndex === -1) continue;
    parts[segment.substring(0, eqIndex).trim()] = segment.substring(eqIndex + 1).trim();
  }
  if (!parts['ts'] || !parts['h1']) return null;
  return { ts: parts['ts'], h1: parts['h1'] };
}

/**
 * Read raw body from request stream with size limit.
 */
async function getRawBody(req: NextApiRequest): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalSize = 0;
    let destroyed = false;

    req.on('data', (chunk: Buffer | string) => {
      if (destroyed) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalSize += buf.length;
      if (totalSize > MAX_PAYLOAD_SIZE) {
        destroyed = true;
        req.destroy();
        reject(new Error('Payload too large'));
        return;
      }
      chunks.push(buf);
    });

    req.on('end', () => {
      if (!destroyed) resolve(Buffer.concat(chunks));
    });

    req.on('error', reject);
  });
}

/**
 * Check if event was already processed (read-only). Fail closed on Redis error.
 */
async function isAlreadyProcessed(eventId: string): Promise<boolean> {
  try {
    const redis = await getRedis();
    const key = `webhook:paddle:event:${eventId}`;
    const existing = await redis.get(key);
    return existing !== null;
  } catch (error) {
    logger.error('Redis unavailable for deduplication check - failing closed', error instanceof Error ? error : undefined, { eventId });
    throw new Error('Deduplication service unavailable');
  }
}

/**
 * Mark event as successfully processed. Called only AFTER DB writes commit.
 * P0-FIX: Separated from the pre-processing duplicate check so that a failed
 * processEvent() does not permanently mark the event as handled. Without this
 * split, a DB error after isDuplicateEvent() set the Redis key would prevent
 * Paddle from re-delivering the event, silently losing billing state updates.
 */
async function markEventProcessed(eventId: string): Promise<void> {
  try {
    const redis = await getRedis();
    const key = `webhook:paddle:event:${eventId}`;
    await redis.set(key, '1', 'EX', EVENT_ID_TTL_SECONDS, 'NX');
  } catch (error) {
    // Non-fatal: log but don't throw. Worst case: event is reprocessed once.
    // The handlers are idempotent (FOR UPDATE + conditional UPDATE), so
    // reprocessing is safe.
    logger.warn('Failed to mark webhook event as processed in Redis', error instanceof Error ? error : undefined, { eventId });
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = process.env['PADDLE_WEBHOOK_SECRET'];
  if (!secret) {
    logger.error('PADDLE_WEBHOOK_SECRET not configured');
    return res.status(500).json({ error: 'Webhook not configured' });
  }

  // Extract and validate Paddle-Signature header
  const signatureHeader = req.headers['paddle-signature'];
  if (!signatureHeader || typeof signatureHeader !== 'string') {
    return res.status(400).json({ error: 'Missing Paddle-Signature header' });
  }

  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed) {
    return res.status(400).json({ error: 'Malformed Paddle-Signature header' });
  }

  // Read raw body
  let rawBody: Buffer;
  try {
    rawBody = await getRawBody(req);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    if (error.message === 'Payload too large') {
      return res.status(413).json({ error: 'Payload too large' });
    }
    logger.error('Failed to read request body', error);
    return res.status(400).json({ error: 'Failed to read request body' });
  }

  // Verify signature BEFORE parsing JSON to prevent payload spoofing
  if (!verifySignature(rawBody, parsed.h1, secret)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // Parse payload AFTER signature verification
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }

  if (!payload || typeof payload !== 'object') {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  // Validate event timestamp to prevent replay attacks
  const occurredAt = payload['occurred_at'];
  if (!occurredAt || typeof occurredAt !== 'string') {
    return res.status(400).json({ error: 'Missing event timestamp' });
  }

  const eventTime = new Date(occurredAt).getTime();
  if (isNaN(eventTime)) {
    return res.status(400).json({ error: 'Invalid event timestamp' });
  }

  if (Math.abs(Date.now() - eventTime) > FIVE_MINUTES_MS) {
    logger.warn('Event timestamp outside acceptable window', { occurredAt });
    return res.status(400).json({ error: 'Event timestamp too old or in future' });
  }

  // P0-FIX: Reject payloads without event_id. The previous fallback to the HMAC
  // signature hash (`sig:${parsed.h1}`) was dangerous: two different events signed
  // with the same secret can share an identical signature if the payload bytes are
  // the same modulo timing, causing one event to be misidentified as a duplicate of
  // the other and permanently lost. Paddle guarantees event_id on all real events.
  const eventId = payload['event_id'];
  if (!eventId || typeof eventId !== 'string') {
    logger.warn('Missing event_id in Paddle webhook payload');
    return res.status(400).json({ error: 'Missing event_id' });
  }

  // Pre-processing duplicate check (read-only Redis GET)
  try {
    if (await isAlreadyProcessed(eventId)) {
      logger.info('Duplicate event ignored', { eventId });
      return res.status(200).json({ received: true, duplicate: true });
    }
  } catch {
    return res.status(503).json({ error: 'Service temporarily unavailable' });
  }

  // Validate event type
  const eventType = payload['event_type'];
  if (!eventType || typeof eventType !== 'string') {
    return res.status(400).json({ error: 'Missing event_type' });
  }

  if (!ALLOWED_EVENT_TYPES.has(eventType)) {
    logger.info('Ignoring unhandled event type', { eventType });
    return res.status(200).json({ received: true, ignored: true });
  }

  // Validate org_id from verified payload
  const orgId = payload['org_id'];
  if (!orgId || typeof orgId !== 'string') {
    return res.status(400).json({ error: 'Missing org_id' });
  }

  // P0-FIX: Cross-reference org_id with Paddle customer_id to prevent privilege
  // escalation. org_id is attacker-controlled custom_data; without this check any
  // Paddle account holder can upgrade any org by crafting a webhook with a spoofed
  // org_id. Verify the org's stored paddle_customer_id matches this payload.
  const paddleCustomerId = typeof payload['customer_id'] === 'string'
    ? payload['customer_id']
    : (payload['customer'] as { id?: string } | undefined)?.id;

  if (paddleCustomerId) {
    const { rows: orgRows } = await pool.query(
      'SELECT 1 FROM orgs WHERE id = $1 AND paddle_customer_id = $2',
      [orgId, paddleCustomerId],
    );
    if (orgRows.length === 0) {
      logger.warn('org_id/paddle_customer_id mismatch — rejecting webhook', { orgId, paddleCustomerId });
      return res.status(400).json({ error: 'org_id does not match Paddle customer record' });
    }
  }

  logger.info('Processing Paddle webhook event', { eventType, orgId, eventId });

  try {
    await processEvent(eventType, orgId, payload, eventId);
    // P0-FIX: Mark as processed AFTER DB writes commit. If processEvent() throws,
    // we return 500 so Paddle will retry. On retry the duplicate check will return
    // false (not yet marked) and the event will be reprocessed. The handlers are
    // idempotent so reprocessing is safe.
    await markEventProcessed(eventId);
    return res.status(200).json({ received: true, type: eventType });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Error processing Paddle webhook event', err, { eventType, eventId, orgId });
    return res.status(500).json({ error: 'Processing error' });
  }
}

async function processEvent(
  eventType: string,
  orgId: string,
  payload: Record<string, unknown>,
  eventId: string,
): Promise<void> {
  if (eventType === 'subscription.created' || eventType === 'subscription.updated') {
    await handleSubscriptionChange(orgId, eventType, payload, eventId);
  } else if (eventType === 'subscription.cancelled') {
    await handleSubscriptionCancelled(orgId, payload, eventId);
  }
  // transaction.completed and transaction.failed are accepted but no DB action needed beyond dedup
}

/**
 * Handle subscription.created and subscription.updated:
 * Upgrade org to pro plan within a transaction.
 */
async function handleSubscriptionChange(
  orgId: string,
  eventType: string,
  payload: Record<string, unknown>,
  eventId: string,
): Promise<void> {
  // P1-FIX: For subscription.updated, only upgrade when status is 'active'.
  // Previously any subscription.updated (pause, downgrade, failed payment)
  // was treated identically to a new active subscription, always upgrading.
  const subscriptionStatus = typeof payload['status'] === 'string' ? payload['status'] : null;
  const isActive = eventType === 'subscription.created' || subscriptionStatus === 'active';
  if (!isActive) {
    logger.info('subscription.updated with non-active status — not upgrading', { orgId, status: subscriptionStatus });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: existing } = await client.query(
      'SELECT plan, plan_status FROM orgs WHERE id = $1 FOR UPDATE',
      [orgId],
    );

    if (existing.length > 0 && existing[0].plan === 'pro' && existing[0].plan_status === 'active') {
      logger.info('Org already has active pro plan, skipping', { orgId });
      await client.query('COMMIT');
      return;
    }

    await client.query(
      'UPDATE orgs SET plan = $1, plan_status = $2 WHERE id = $3',
      ['pro', 'active', orgId],
    );

    const customer = payload['customer'] as { email?: string } | undefined;
    await client.query(
      `INSERT INTO audit_events (org_id, actor_type, action, metadata)
       VALUES ($1, 'system', 'billing_plan_upgraded', $2)`,
      [
        orgId,
        JSON.stringify({
          provider: 'paddle',
          event_type: eventType,
          subscription_id: payload['subscription_id'],
          customer_email: customer?.email,
          event_id: eventId,
        }),
      ],
    );

    await client.query('COMMIT');
    logger.info('Org upgraded to pro plan', { orgId });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Handle subscription.cancelled:
 * Only downgrade to free if no other active subscriptions exist.
 * Uses SELECT FOR UPDATE to prevent race conditions.
 */
async function handleSubscriptionCancelled(
  orgId: string,
  payload: Record<string, unknown>,
  eventId: string,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // P2-FIX: Replace SELECT * with explicit column list to avoid fetching
    // unnecessary data (including any future sensitive columns) and to make
    // the query's intent clear to the optimizer and code reviewers.
    const { rows } = await client.query(
      `SELECT subscription_id, status FROM paddle_subscriptions
       WHERE org_id = $1
       AND status = 'active'
       AND subscription_id != $2
       FOR UPDATE`,
      [orgId, payload['subscription_id'] as string],
    );

    if (rows.length === 0) {
      await client.query(
        'UPDATE orgs SET plan = $1, plan_status = $2 WHERE id = $3',
        ['free', 'cancelled', orgId],
      );
      logger.info('Org plan cancelled (no other active subscriptions)', { orgId });
    } else {
      logger.info('Org has other active subscriptions, keeping pro plan', {
        orgId,
        remainingActive: rows.length,
      });
    }

    await client.query(
      `INSERT INTO audit_events (org_id, actor_type, action, metadata)
       VALUES ($1, 'system', 'billing_plan_cancelled', $2)`,
      [
        orgId,
        JSON.stringify({
          provider: 'paddle',
          subscription_id: payload['subscription_id'],
          event_id: eventId,
          remaining_active_subscriptions: rows.length,
        }),
      ],
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
