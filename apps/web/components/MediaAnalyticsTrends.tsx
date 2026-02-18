
import React from 'react';
export type Point = { date: string; value: number };

export function MediaAnalyticsTrends({
  title,
  series
}: {
  title: string;
  series: Point[];
}) {
  return (
  <div>
    <h3>{title}</h3>
    <svg width='400' height='120'>
    {series.map((p, i) => (
      // FIX(P2): key uses composite `${date}-${index}` to avoid duplicate key
      // warnings when multiple points share the same date. cy is clamped to
      // [0, 100]: without clamping, p.value > 100 gives cy < 0 (above SVG
      // viewport) and p.value < 0 gives cy > 100 (below the visible area).
      <circle
      key={`${p.date}-${i}`}
      cx={i * 40 + 20}
      cy={Math.max(0, Math.min(100, 100 - p.value))}
      r={4}
      fill='blue'
      />
    ))}
    </svg>
  </div>
  );
}
