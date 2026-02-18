
import React from 'react';
export type PlanType = 'free' | 'pro' | 'agency';

export interface PricingLimits {
  free: number;
  pro: number;
  agency: number;
}

export interface PricingOverviewProps {
  plan?: PlanType;
  wordpressSites?: number;
}

const limits: PricingLimits = {
  free: 0,
  pro: 1,
  agency: 10
};

export function PricingOverview({ plan = 'free', wordpressSites = 0 }: PricingOverviewProps) {
  const siteLimit = limits[plan] ?? 0;

  return (
  <div>
    <h2>Your Plan</h2>
    <p>Plan: {plan}</p>
    <p>
    WordPress sites: {wordpressSites} / {siteLimit}
    </p>

    {wordpressSites >= siteLimit && (
    // P2-FIX: Add role="alert" + aria-live so screen readers announce the
    // limit warning without requiring focus. Color alone is insufficient for
    // users who cannot perceive orange (WCAG 2.1 SC 1.4.1).
    <div role='alert' aria-live='polite' style={{ color: 'orange' }}>
      Upgrade to add more WordPress sites
    </div>
    )}
  </div>
  );
}
