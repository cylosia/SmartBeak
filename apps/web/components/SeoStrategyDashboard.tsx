
import React from 'react';
export interface SeoStrategyDashboardProps {
  features?: string[];
  lifecycle?: string;
  score?: number;
}

export function SeoStrategyDashboard({ features = [], lifecycle = '', score = 0 }: SeoStrategyDashboardProps) {
  return (
  <div>
    <h2>SEO Strategy</h2>

    <h3>SERP Opportunities</h3>
    <ul>{features.map((feature) => <li key={feature}>{feature}</li>)}</ul>

    <h3>Recommended Actions</h3>
    <p>{lifecycle}</p>

    <h3>Buyer SEO Completeness</h3>
    <strong aria-label={`SEO Score: ${score} out of 100`}>{score} / 100</strong>
  </div>
  );
}
