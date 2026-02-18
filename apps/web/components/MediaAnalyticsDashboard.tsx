
import React from 'react';
export type MediaMetrics = {
  platform: string;
  metrics: Record<string, number>;
};

// FIX(B-02): Accept data as optional so the parent can pass the raw TanStack
// Query result without casting. Renders explicit loading/empty states so the
// caller can distinguish "not yet fetched" from "fetched but empty".
export function MediaAnalyticsDashboard({ data }: { data?: MediaMetrics[] }) {
  if (!data) {
    return (
      <div>
        <h2>Media Analytics</h2>
        <p aria-live="polite">Loading analytics…</p>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div>
        <h2>Media Analytics</h2>
        <p>No analytics data available.</p>
      </div>
    );
  }

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
      {/* FIX(B-01): Include platformIdx in the Fragment key — duplicate platform
          strings caused React to silently deduplicate the Fragment and drop
          entire rows of financial metrics data with no warning. */}
      {data.map((d, platformIdx) => (
      <React.Fragment key={`${d.platform}-${platformIdx}`}>
        {Object.entries(d.metrics).map(([k, v], index) => (
        <tr key={`${d.platform}-${k}`}>
          {/* FIX(B-04): Math.max(1,...) prevents rowSpan={0} when metrics={}
              — HTML spec treats rowspan="0" as "span all remaining rows",
              which produces inconsistent table layout across browsers. */}
          {index === 0 && (
            <th scope='row' rowSpan={Math.max(1, Object.keys(d.metrics).length)}>
              {d.platform}
            </th>
          )}
          <td>{k}</td>
          {/* FIX(B-03): With noUncheckedIndexedAccess, v is number|undefined.
              Render 0 instead of an empty cell when the value is absent. */}
          <td>{v ?? 0}</td>
        </tr>
        ))}
      </React.Fragment>
      ))}
    </tbody>
    </table>
  </div>
  );
}
