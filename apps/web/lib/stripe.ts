
import Stripe from 'stripe';

// Lazily-initialised singleton — avoids crashing on import in environments where
// STRIPE_SECRET_KEY is not yet available (e.g. build time, test setup).
let stripeInstance: Stripe | null = null;

/**
 * Return the Stripe secret key with format validation.
 * P2-FIX: Reads from process.env on every call — no module-level plaintext cache —
 * so we don't hold the key as an additional heap reference beyond the env store.
 */
function getStripeSecretKey(): string {
  const key = process.env['STRIPE_SECRET_KEY'];
  if (!key || key.includes('placeholder')) {
    throw new Error(
      'STRIPE_SECRET_KEY is not set or contains placeholder value. ' +
      'Please set your actual Stripe secret key from https://dashboard.stripe.com'
    );
  }
  if (!key.startsWith('sk_') && !key.startsWith('rk_')) {
    throw new Error(
      "STRIPE_SECRET_KEY appears to be invalid. " +
      "Secret keys should start with 'sk_' or 'rk_'"
    );
  }
  return key;
}

/**
 * Get or create the Stripe API client (lazy singleton).
 */
export function getStripe(): Stripe {
  if (stripeInstance) {
    return stripeInstance;
  }

  const secretKey = getStripeSecretKey();
  // P3-FIX: Removed `typescript: true` — not a valid Stripe SDK v10+ constructor option;
  // passing it causes a TypeScript type error and may produce a runtime warning.
  stripeInstance = new Stripe(secretKey, {
    apiVersion: '2023-10-16',
    appInfo: {
      name: 'SmartBeak',
      version: '1.0.0',
    },
  });

  return stripeInstance;
}

/**
 * Stripe webhook secret for verifying webhook signatures.
 *
 * P0-FIX: Now throws instead of logging a warning and returning '' when the secret
 * is absent or is a placeholder. The previous behaviour was a complete signature-bypass
 * vulnerability: constructEvent computes HMAC(secret, payload) — passing '' as the
 * secret means any payload with a matching empty-key HMAC passes verification.
 */
export function getStripeWebhookSecret(): string {
  const key = process.env['STRIPE_WEBHOOK_SECRET'];
  if (!key || key.includes('placeholder')) {
    throw new Error(
      'STRIPE_WEBHOOK_SECRET is not set or contains a placeholder value. ' +
      'Webhook signature verification cannot proceed without a valid secret.'
    );
  }
  if (!key.startsWith('whsec_')) {
    throw new Error(
      "STRIPE_WEBHOOK_SECRET appears to be invalid. " +
      "Webhook secrets should start with 'whsec_'"
    );
  }
  return key;
}

/**
 * Validates that Stripe is properly configured.
 * Call this in API routes before using Stripe.
 */
export function validateStripeConfig(): void {
  // getStripeSecretKey throws descriptively on misconfiguration.
  getStripeSecretKey();
}

