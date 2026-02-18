
import React from 'react';
export type Point = { date: string; value: number };

// FIX(C-02): Accept series as optional so callers can pass undefined while
// data is loading rather than casting to a non-null type.
export function MediaAnalyticsTrends({
  title,
  series
}: {
  title: string;
  series?: Point[];
}) {
  // FIX(C-02): Explicit loading/empty states — returning null silently made it
  // impossible for the parent to distinguish "not yet fetched" from "no data".
  if (!series || series.length === 0) {
    return (
      <div>
        <h3>{title}</h3>
        <p>No trend data available.</p>
      </div>
    );
  }

  // FIX(C-01): Dynamic width prevents clipping when there are more than
  // 10 data points (fixed width=400 only fits ~10 points at 40px spacing).
  const svgWidth = Math.max(400, series.length * 40);
  // FIX(C-04): titleId links <title> to the SVG via aria-labelledby so
  // screen readers announce the chart purpose (WCAG 2.1 SC 1.1.1).
  const titleId = `trends-title-${title.replace(/\s+/g, '-').toLowerCase()}`;

  return (
  <div>
    <h3>{title}</h3>
    {/* FIX(C-01): viewBox + width="100%" makes the SVG scale with its
        container instead of overflowing on narrow viewports. */}
    {/* FIX(C-04): role="img" + aria-labelledby exposes chart semantics to
        assistive technology; <title> provides the accessible name. */}
    <svg
      role='img'
      aria-labelledby={titleId}
      viewBox={`0 0 ${svgWidth} 120`}
      width='100%'
      height='120'
      preserveAspectRatio='xMidYMid meet'
    >
      <title id={titleId}>{title} trend chart</title>
    {series.map((p, i) => {
      // FIX(C-03): Guard against NaN — p.value may be NaN if the server
      // returns null/undefined for a metric. SVG treats cy="NaN" as cy="0"
      // (top of chart) silently, producing misleading visual output.
      const safeValue = Number.isFinite(p.value) ? p.value : 0;
      return (
        <circle
          key={`${p.date}-${i}`}
          cx={i * 40 + 20}
          cy={Math.max(0, Math.min(100, 100 - safeValue))}
          r={4}
          fill='blue'
        />
      );
    })}
    </svg>
  </div>
  );
}
