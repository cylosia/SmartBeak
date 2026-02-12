
import React from 'react';

interface DomainSaleReadinessPanelProps {
  data: {
    score: number;
    seo_score: number;
    content_score: number;
    audience_score: number;
    revenue_score: number;
    risk_score: number;
    rationale: string[];
  };
}

export function DomainSaleReadinessPanel({ data }: DomainSaleReadinessPanelProps) {
  return (
  <div>
    <h2>Domain Sale Readiness</h2>
    <h1>{data.score} / 100</h1>

    <ul>
    <li>SEO: {data.seo_score}</li>
    <li>Content: {data.content_score}</li>
    <li>Audience: {data.audience_score}</li>
    <li>Revenue: {data.revenue_score}</li>
    <li>Risk: {data.risk_score}</li>
    </ul>

    <h4>Rationale</h4>
    <ul>
    {data.rationale.map((r: string, i: number) => (
      <li key={i}>{r}</li>
    ))}
    </ul>

    <p style={{ fontSize: '0.85em', color: '#555' }}>
    This score is advisory and intended for buyer readiness assessment,
    not valuation.
    </p>
  </div>
  );
}
