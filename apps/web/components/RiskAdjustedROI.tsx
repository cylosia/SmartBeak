
import React from 'react';
export interface RiskFlag {
  [key: string]: unknown;
}

export interface RoiData {
  monthly_revenue?: number;
  roi?: number;
  risk_flags?: RiskFlag[];
}

export interface RiskAdjustedROIProps {
  roi?: RoiData;
}

export function RiskAdjustedROI({ roi }: RiskAdjustedROIProps) {
  if (!roi) return null;

  return (
  <div>
    <h3>ROI</h3>
    <p>Monthly Revenue: {roi.monthly_revenue ?? 0}</p>
    <p>ROI: {roi.roi ?? 0}</p>
    <h4>Risk Flags</h4>
    <pre>{JSON.stringify(roi.risk_flags ?? [], null, 2)}</pre>
  </div>
  );
}
