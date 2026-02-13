
import Stripe from 'stripe';

import { getLogger } from '@kernel/logger';

const logger = getLogger('stripe');

/**
* Stripe configuration
* Server-side only - never expose secret keys to client
* P0-FIX: Deferred validation to prevent crash on module load
*/

// P0-FIX: Cache for lazy initialization
let stripeInstance: Stripe | null = null;
let stripeSecretKeyCache: string | null = null;

/**
* Get Stripe secret key with deferred validation
* P0-FIX: Validation happens on first use, not module load
*/
function getStripeSecretKey(): string {
  if (stripeSecretKeyCache) {
  return stripeSecretKeyCache;
  }

  const key = process.env['STRIPE_SECRET_KEY'];
  if (!key || key.includes('placeholder')) {
  throw new Error(
    'STRIPE_SECRET_KEY is not set or contains placeholder value. ' +
    'Please set your actual Stripe secret key from https://dashboard.stripe.com'
  );
  }
  // Validate key format
  if (!key.startsWith('sk_') && !key.startsWith('rk_')) {
  throw new Error(
    "STRIPE_SECRET_KEY appears to be invalid. " +
    "Secret keys should start with 'sk_' or 'rk_'"
  );
  }
  stripeSecretKeyCache = key;
  return stripeSecretKeyCache;
}

/**
* Get or create Stripe API client
* P0-FIX: Lazy initialization
*/
export function getStripe(): Stripe {
  if (stripeInstance) {
  return stripeInstance;
  }

  const secretKey = getStripeSecretKey();
  stripeInstance = new Stripe(secretKey, {
  apiVersion: '2023-10-16',
  typescript: true,
  // Add app info for Stripe dashboard
  appInfo: {
    name: 'SmartBeak',
    version: '1.0.0',
  },
  });

  return stripeInstance;
}

/**
 * P0-FIX: Export stripe as a lazy-initialized proxy for backward compatibility
 * Uses a Proxy that forwards all property access to the actual Stripe instance
 * This avoids unsafe type casting while maintaining the same API
 */
export const stripe: Stripe = new Proxy({} as Stripe, {
  get(_target, prop: string | symbol) {
    if (typeof prop !== 'string') {
      return undefined;
    }
    
    const client = getStripe();
    const value = client[prop as keyof Stripe];
    
    // If the value is a function, bind it to the Stripe client
    if (typeof value === 'function') {
      return value.bind(client);
    }
    
    return value;
  }
});

/**
* Stripe webhook secret for verifying webhook signatures
* P0-FIX: Deferred validation
*/
export function getStripeWebhookSecret(): string {
  const key = process.env['STRIPE_WEBHOOK_SECRET'];
  if (!key || key.includes('placeholder')) {
  logger.warn('STRIPE_WEBHOOK_SECRET is not set. Webhook verification will fail.');
  return '';
  }
  // Validate webhook secret format
  if (!key.startsWith('whsec_')) {
  throw new Error(
    "STRIPE_WEBHOOK_SECRET appears to be invalid. " +
    "Webhook secrets should start with 'whsec_'"
  );
  }
  return key;
}

/**
* Backward compatible export
* @deprecated Use getStripeWebhookSecret() instead
*/
export const STRIPE_WEBHOOK_SECRET = process.env['STRIPE_WEBHOOK_SECRET'] || '';

/**
* Validates that Stripe is properly configured
* Call this in API routes before using Stripe
*/
export function validateStripeConfig(): void {
  const secretKey = getStripeSecretKey();
  if (!secretKey || secretKey.includes('placeholder')) {
  throw new Error('Stripe is not properly configured');
  }
}
