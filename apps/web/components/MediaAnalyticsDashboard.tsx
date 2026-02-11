
import React from 'react';
export type MediaMetrics = {
  platform: string;
  metrics: Record<string, number>;
};

export function MediaAnalyticsDashboard({ data }: { data: MediaMetrics[] }) {
  return (
  <div>
    <h2>Media Analytics</h2>
    <table>
    <caption>Media platform metrics overview</caption>
    <thead>
      <tr>
      <th scope='col'>Platform</th>
      <th scope='col'>Metric</th>
      <th scope='col'>Value</th>
      </tr>
    </thead>
    <tbody>
      {data.map(d => (
      Object.entries(d.metrics).map(([k, v], index) => (
        <tr key={`${d.platform}-${k}`}>
        {index === 0 && <th scope='row' rowSpan={Object.keys(d.metrics).length}>{d.platform}</th>}
        <td>{k}</td>
        <td>{v}</td>
        </tr>
      ))
      ))}
    </tbody>
    </table>
  </div>
  );
}
