
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
  if (!summary) {
  return null;
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
