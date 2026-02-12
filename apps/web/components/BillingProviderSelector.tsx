
import React from 'react';

interface BillingProviderSelectorProps {
  onSelect: (provider: 'stripe' | 'paddle') => void;
}

export function BillingProviderSelector({ onSelect }: BillingProviderSelectorProps) {
  return (
  <div>
    <button onClick={() => onSelect('stripe')}>Pay with Stripe</button>
    <button onClick={() => onSelect('paddle')}>Pay with Paddle</button>
  </div>
  );
}
