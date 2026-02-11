
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
      <circle
      key={p.date}
      cx={i * 40 + 20}
      cy={100 - p.value}
      r={4}
      fill='blue'
      />
    ))}
    </svg>
  </div>
  );
}
