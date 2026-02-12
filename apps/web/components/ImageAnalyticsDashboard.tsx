
import React from 'react';

interface ImageAnalyticsRow {
  platform: string;
  ctr: number | string;
  impressions: number | string;
}

interface ImageAnalyticsDashboardProps {
  rows: ImageAnalyticsRow[];
}

export function ImageAnalyticsDashboard({ rows }: ImageAnalyticsDashboardProps) {
  return (
  <div>
    <h2>Image Performance</h2>
    <table>
    <thead>
      <tr>
      <th>Platform</th>
      <th>CTR %</th>
      <th>Impressions</th>
      </tr>
    </thead>
    <tbody>
      {rows.map((r: ImageAnalyticsRow, i: number) => (
      <tr key={i}>
        <td>{r.platform}</td>
        <td>{r.ctr}</td>
        <td>{r.impressions}</td>
      </tr>
      ))}
    </tbody>
    </table>
  </div>
  );
}
