
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
    <div style={{ color: 'orange' }}>
      Upgrade to add more WordPress sites
    </div>
    )}
  </div>
  );
}
