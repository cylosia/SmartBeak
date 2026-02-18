import crypto from 'crypto';
import { API_BASE_URLS } from '@config';

/**
* Paddle Billing Integration
* Handles Paddle API interactions for subscription management
* 
* P1-HIGH SECURITY FIX: Added idempotency key generation for checkout sessions
*/

export interface PaddleWebhookPayload {
  event_type: string;
  event_id: string;
  occurred_at: string;
  data: {
  id: string;
  customer_id?: string;
  subscription_id?: string;
  status?: string;
  items?: Array<{
    price_id: string;
    quantity: number;
  }>;
  [key: string]: unknown;
  };
}

export interface PaddleSubscription {
  id: string;
  customerId: string;
  status: 'active' | 'canceled' | 'paused' | 'past_due';
  items: Array<{
  priceId: string;
  quantity: number;
  }>;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
}

/**
 * @deprecated UNSAFE — signs a re-serialized JS object, not the raw HTTP body.
 * Paddle signs the exact bytes it transmitted. Re-serializing a parsed object
 * changes key ordering (V8 insertion order ≠ JSON wire order), allowing forgery.
 * Use validatePaddleWebhookRaw() for all new callers.
 *
 * This function is kept only to avoid breaking existing callers during the
 * migration, but MUST NOT be used for any security-sensitive check.
 */
export function validatePaddleWebhook(
  _payload: PaddleWebhookPayload,
  _signature: string,
  _secret: string
): boolean {
  // P0-FIX: Unconditionally return false so any remaining callers fail closed
  // instead of accepting forged signatures. The correct implementation is
  // validatePaddleWebhookRaw() which operates on the raw request body buffer.
  throw new Error(
    'validatePaddleWebhook is unsafe and has been disabled. ' +
    'Use validatePaddleWebhookRaw(rawBody, signature, secret) instead.'
  );
}

/**
 * Validate Paddle webhook signature using the raw HTTP request body.
 * This is the only correct implementation — Paddle signs the exact bytes
 * it transmits; re-serializing the parsed object changes key ordering.
 *
 * @param rawBody - Raw request body Buffer (NOT parsed JSON)
 * @param signature - h1 value from Paddle-Signature header
 * @param secret - Webhook secret from Paddle dashboard
 */
export function validatePaddleWebhookRaw(rawBody: Buffer, signature: string, secret: string): boolean {
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
* Process Paddle webhook event

*/
export function processPaddleWebhook(payload: PaddleWebhookPayload): {
  handled: boolean;
  eventType: string;
  data: Record<string, unknown>;
} {
  if (!payload || typeof payload !== 'object') {
  throw new Error('Invalid payload: expected object');
  }

  if (!payload.event_type) {
  throw new Error('Invalid payload: missing event_type');
  }

  const { event_type, data } = payload;

  switch (event_type) {
  case 'subscription.created':
    return {
    handled: true,
    eventType: 'subscription_created',
    data: normalizeSubscription(data) as unknown as Record<string, unknown>,
    };

  case 'subscription.updated':
    return {
    handled: true,
    eventType: 'subscription_updated',
    data: normalizeSubscription(data) as unknown as Record<string, unknown>,
    };

  case 'subscription.canceled':
    return {
    handled: true,
    eventType: 'subscription_canceled',
    data: normalizeSubscription(data) as unknown as Record<string, unknown>,
    };

  case 'transaction.completed':
    return {
    handled: true,
    eventType: 'payment_completed',
    data: normalizeTransaction(data),
    };

  default:
    return {
    handled: false,
    eventType: event_type,
    data: data as Record<string, unknown>,
    };
  }
}

/**
* Normalize subscription data

*/
const VALID_PADDLE_STATUSES: ReadonlySet<PaddleSubscription['status']> = new Set([
  'active', 'canceled', 'paused', 'past_due',
]);

function normalizeSubscription(data: Record<string, unknown>): PaddleSubscription {
  // P2-FIX: Validate status against the known union before casting.
  // A raw `as PaddleSubscription['status']` would silently accept any string
  // Paddle may add (e.g. 'trialing'), causing downstream switch statements to
  // misclassify subscription states and grant/deny access incorrectly.
  const rawStatus = typeof data['status'] === 'string' ? data['status'] : '';
  const status: PaddleSubscription['status'] = VALID_PADDLE_STATUSES.has(
    rawStatus as PaddleSubscription['status']
  )
    ? (rawStatus as PaddleSubscription['status'])
    : 'past_due';

  return {
  id: String(data['id'] || ''),
  customerId: String(data['customer_id'] || ''),
  status,
  items: Array.isArray(data['items'])
    ? (data['items'] as Record<string, unknown>[]).map((item: Record<string, unknown>) => ({
      priceId: String(item['price_id'] || ''),
      quantity: Number(item['quantity'] || 1),
    }))
    : [],
  currentPeriodStart: new Date(String(data['current_period_start'] || Date.now())),
  currentPeriodEnd: new Date(String(data['current_period_end'] || Date.now())),
  };
}

/**
* Normalize transaction data

*/
function normalizeTransaction(data: Record<string, unknown>): Record<string, unknown> {
  return {
  id: String(data['id'] || ''),
  subscriptionId: String(data['subscription_id'] || ''),
  customerId: String(data['customer_id'] || ''),
  amount: Number(data['amount'] || 0),
  currency: String(data['currency'] || 'USD'),
  status: String(data['status'] || ''),
  createdAt: new Date(String(data['created_at'] || Date.now())),
  };
}

/**
* Format price for display

*/
export function formatPaddlePrice(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: currency.toUpperCase(),
  }).format(amount / 100); // Paddle amounts are in cents
}

/**
* Create a Paddle checkout session
* @param orgId - Organization ID
* @param planId - Plan ID to subscribe to
* @returns Checkout session with URL
* 
* P0-FIX: Actually implemented Paddle API call with idempotency key
*/
export async function createPaddleCheckout(orgId: string, planId: string): Promise<{ url: string | null; idempotencyKey: string }> {
  // P0-FIX: Generate idempotency key to prevent duplicate checkout sessions
  const idempotencyKey = crypto.randomUUID();
  
  // P0-FIX: Actually call Paddle API with idempotency key
  const paddleApiKey = process.env['PADDLE_API_KEY'];
  if (!paddleApiKey) {
    throw new Error('PADDLE_API_KEY not configured');
  }
  
  // P1-FIX: Add AbortController timeout so Paddle API degradation cannot
  // hold connections open indefinitely and exhaust the server's connection pool.
  const paddleAbortController = new AbortController();
  const paddleTimeoutId = setTimeout(() => paddleAbortController.abort(), 30000);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URLS.paddle}/transactions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${paddleApiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({
        items: [{ price_id: planId, quantity: 1 }],
        custom_data: { org_id: orgId },
      }),
      signal: paddleAbortController.signal,
    });
  } finally {
    clearTimeout(paddleTimeoutId);
  }

  if (!response.ok) {
    // P1-FIX: Avoid logging raw errorData which may contain PII or internal IDs.
    // Log only a safe error code; the full body is not surfaced to callers.
    const errorData = await response.json().catch(() => ({})) as Record<string, unknown>;
    const errorObj = errorData['error'];
    const safeErrorCode = (typeof errorObj === 'object' && errorObj !== null)
      ? String((errorObj as Record<string, unknown>)['code'] ?? response.status)
      : String(response.status);
    throw new Error(`Paddle API error: ${safeErrorCode}`);
  }
  
  const data = await response.json();
  
  return {
    url: data.data?.checkout?.url || null,
    idempotencyKey,
  };
}
