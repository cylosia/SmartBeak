
import React from 'react';
export function BillingProviderSelector({ onSelect }: any) {
  return (
  <div>
    <button onClick={() => onSelect('stripe')}>Pay with Stripe</button>
    <button onClick={() => onSelect('paddle')}>Pay with Paddle</button>
  </div>
  );
}
