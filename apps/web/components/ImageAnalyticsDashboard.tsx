
import React from 'react';
export function ImageAnalyticsDashboard({ rows }: any) {
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
      {rows.map((r: any, i: number) => (
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
