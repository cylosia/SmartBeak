
import React from 'react';
export function DeliverabilityAdvisoryPanel({ advisories }: any) {
  return (
  <aside>
    <h4>Deliverability Checks</h4>
    {advisories.map((a: any, i: number) => (
    <div key={i} style={{ marginBottom: 8 }}>
      <strong>{a.level === 'warning' ? '⚠' : 'ℹ'} {a.message}</strong>
      {a.recommendation && <div>{a.recommendation}</div>}
    </div>
    ))}
  </aside>
  );
}
