
import React, { useState } from 'react';

import { BillingProviderSelector } from '../../components/BillingProviderSelector';

// P0-SECURITY FIX: Allowlist of trusted checkout redirect domains
const TRUSTED_CHECKOUT_DOMAINS = [
  'checkout.stripe.com',
  'pay.paddle.com',
  'sandbox-checkout.paddle.com',
];

function isValidCheckoutUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    // Only allow https protocol
    if (url.protocol !== 'https:') return false;
    // Only allow trusted domains
    return TRUSTED_CHECKOUT_DOMAINS.some(
      (domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`)
    );
  } catch {
    return false;
  }
}

export default function UpgradePage() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function startCheckout(provider: string) {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/billing/${provider}/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priceId: 'price_pro', planId: 'pro' })
      });
      if (!res.ok) {
        throw new Error('Failed to create checkout session');
      }
      const data = await res.json();
      const checkoutUrl = data.url || data.checkoutUrl;

      // P0-SECURITY FIX: Validate redirect URL against allowlist
      if (!checkoutUrl || !isValidCheckoutUrl(checkoutUrl)) {
        throw new Error('Invalid checkout URL received from server');
      }

      if (typeof window !== 'undefined') {
        window.location.href = checkoutUrl;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout failed. Please try again.');
      setLoading(false);
    }
  }

  return (
    <div>
      <h1>Upgrade Plan</h1>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <BillingProviderSelector onSelect={startCheckout} />
      {loading && <p>Redirecting to checkout...</p>}
    </div>
  );
}
