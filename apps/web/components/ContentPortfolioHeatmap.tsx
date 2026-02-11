
import React from 'react';
const colors: any = {
  invest: '#60a5fa',
  double_down: '#22c55e',
  refresh: '#f59e0b',
  prune: '#ef4444'
};

export function ContentPortfolioHeatmap({ points }: any) {
  return (
  <div>
    <h2>Content Portfolio Heatmap</h2>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
    {points.map((p: any) => (
      <div
      key={p.content_id}
      style={{
        background: colors[p.quadrant],
        padding: 12,
        color: '#fff',
        borderRadius: 6
      }}
      >
      <div>ID: {p.content_id.slice(0, 6)}</div>
      <div>Traffic: {p.traffic}</div>
      <div>ROI: {p.roi_12mo}%</div>
      <div>Freshness: {p.freshness_days}d</div>
      <strong>{p.quadrant.replace('_', ' ')}</strong>
      </div>
    ))}
    </div>
  </div>
  );
}
