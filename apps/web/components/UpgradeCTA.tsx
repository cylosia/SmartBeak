
import React from 'react';
export interface UpgradeCTAProps {
  plan: string;
}

export function UpgradeCTA({ plan }: UpgradeCTAProps) {
  function goToBilling() {
    if (typeof window !== 'undefined') {
      window.location.href = '/billing/upgrade';
    }
  }

  return (
  <div style={{ border: '1px solid #ccc', padding: 12 }}>
    <h3>Upgrade your plan</h3>
    <p>
    Your current plan (<strong>{plan}</strong>) has reached its limits.
    </p>
    <button type='button' onClick={goToBilling}>
    Upgrade Plan
    </button>
  </div>
  );
}
