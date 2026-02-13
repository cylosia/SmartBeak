
import React from 'react';

interface Advisory {
  level: string;
  message: string;
  recommendation?: string;
}

interface DeliverabilityAdvisoryPanelProps {
  advisories: Advisory[];
}

export function DeliverabilityAdvisoryPanel({ advisories }: DeliverabilityAdvisoryPanelProps) {
  return (
  <aside>
    <h4>Deliverability Checks</h4>
    {advisories.map((a: Advisory, i: number) => (
    <div key={`${a.level}-${a.message}`} style={{ marginBottom: 8 }}>
      <strong>{a.level === 'warning' ? '⚠' : 'ℹ'} {a.message}</strong>
      {a.recommendation && <div>{a.recommendation}</div>}
    </div>
    ))}
  </aside>
  );
}
