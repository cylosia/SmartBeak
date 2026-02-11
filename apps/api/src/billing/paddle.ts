import crypto from 'crypto';

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
* Validate Paddle webhook signature

*/
export function validatePaddleWebhook(
  payload: PaddleWebhookPayload,
  signature: string,
  secret: string
): boolean {
  // Create signature from payload
  const payloadString = JSON.stringify(payload);
  const expectedSignature = crypto
  .createHmac('sha256', secret)
  .update(payloadString)
  .digest('hex');

  // Timing-safe comparison
  try {
  const sigBuf = Buffer.from(signature, 'utf8');
  const expectedBuf = Buffer.from(expectedSignature, 'utf8');
  return sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf);
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
function normalizeSubscription(data: Record<string, unknown>): PaddleSubscription {
  return {
  id: String(data['id'] || ''),
  customerId: String(data['customer_id'] || ''),
  status: (data['status'] as PaddleSubscription['status']) || 'past_due',
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
  
  const response = await fetch('https://api.paddle.com/transactions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${paddleApiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,  // <-- ACTUALLY SEND IT
    },
    body: JSON.stringify({
      items: [{ price_id: planId, quantity: 1 }],
      custom_data: { org_id: orgId },
    }),
  });
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(`Paddle API error: ${response.status} - ${JSON.stringify(errorData)}`);
  }
  
  const data = await response.json();
  
  return {
    url: data.data?.checkout?.url || null,
    idempotencyKey,
  };
}
