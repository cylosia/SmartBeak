
import React from 'react';
export interface AttributionSummary {
  impressions?: number;
  clicks?: number;
  views?: number;
}

export interface MediaAttributionSummaryProps {
  summary?: AttributionSummary;
}

export function MediaAttributionSummary({ summary }: MediaAttributionSummaryProps) {
  // FIX(D-01): Render an explicit loading state instead of null — returning
  // null silently made it impossible for the parent to distinguish "data is
  // still loading" from "data loaded but there is no attribution summary",
  // which prevents proper skeleton/error UI in the consuming page.
  if (!summary) {
    return (
      <div>
        <h2>Cross-Platform Attribution</h2>
        <p aria-live='polite'>Loading attribution data…</p>
      </div>
    );
  }

  return (
  <div>
    <h2>Cross-Platform Attribution</h2>
    <ul>
    <li>Total Impressions: {summary.impressions ?? 0}</li>
    <li>Total Clicks: {summary.clicks ?? 0}</li>
    <li>Total Views: {summary.views ?? 0}</li>
    </ul>
  </div>
  );
}
