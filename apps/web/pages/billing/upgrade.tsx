
import React, { useState } from 'react';

import { BillingProviderSelector } from '../../components/BillingProviderSelector';

// Allowlist of trusted checkout redirect domains — exact match only.
// endsWith() was removed: it permitted evil.checkout.stripe.com to pass.
const TRUSTED_CHECKOUT_HOSTNAMES = new Set([
  'checkout.stripe.com',
  'pay.paddle.com',
  'sandbox-checkout.paddle.com',
]);

function isValidCheckoutUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:') return false;
    return TRUSTED_CHECKOUT_HOSTNAMES.has(url.hostname);
  } catch {
    return false;
  }
}

// Allowlist of accepted billing providers.
// The provider value is interpolated into the fetch URL, so any unlisted
// value would be a path-traversal vector.
const VALID_PROVIDERS = ['stripe', 'paddle'] as const;
type BillingProvider = typeof VALID_PROVIDERS[number];

export default function UpgradePage() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function startCheckout(provider: string) {
    // Reject unlisted providers before the value touches the URL.
    if (!(VALID_PROVIDERS as readonly string[]).includes(provider)) {
      setError('Invalid payment provider selected.');
      return;
    }
    const validProvider = provider as BillingProvider;

    setError(null);
    setLoading(true);

    // Unique key per checkout attempt so the server can deduplicate network
    // retries without creating duplicate sessions or charges.
    const idempotencyKey = crypto.randomUUID();

    // Hard timeout so the user is never left on a frozen "Redirecting…" screen.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);

    try {
      // priceId is intentionally omitted: the server must resolve the canonical
      // Stripe/Paddle price ID from planId using its own database record.
      // Allowing clients to supply priceId would let them self-select free plans.
      const res = await fetch(`/billing/${validProvider}/checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({ planId: 'pro' }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        throw new Error('Failed to create checkout session');
      }
      const data = await res.json();
      const checkoutUrl = data.url || data.checkoutUrl;

      if (!checkoutUrl || !isValidCheckoutUrl(checkoutUrl)) {
        throw new Error('Invalid checkout URL received from server');
      }

      if (typeof window !== 'undefined') {
        window.location.href = checkoutUrl;
      }
    } catch (err) {
      clearTimeout(timeoutId);
      // Never surface raw server error messages to the UI.
      setError('Checkout failed. Please try again.');
      setLoading(false);
    }
  }

  return (
    <div>
      <h1>Upgrade Plan</h1>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <BillingProviderSelector onSelect={(provider: string) => void startCheckout(provider)} />
      {loading && <p>Redirecting to checkout...</p>}
    </div>
  );
}
