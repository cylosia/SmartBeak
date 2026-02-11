
import React from 'react';

import { BillingProviderSelector } from '../../components/BillingProviderSelector';
export default function UpgradePage() {
  async function startCheckout(provider: string) {
  const res = await fetch(`/billing/${provider}/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ priceId: 'price_pro', planId: 'pro' })
  });
  const data = await res.json();
  if (typeof window !== 'undefined') {
    window.location.href = data.url || data.checkoutUrl;
  }
  }

  return (
  <div>
    <h1>Upgrade Plan</h1>
    <BillingProviderSelector onSelect={startCheckout} />
  </div>
  );
}
