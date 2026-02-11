
import React from 'react';
export function ContentRoiPanel({ roi }: any) {
  return (
  <div>
    <h3>Content ROI & Payback</h3>
    <ul>
    <li>Estimated Monthly Revenue: ${roi.monthly_revenue_estimate}</li>
    <li>
      Payback Period:{' '}
      {roi.payback_months !== null
      ? roi.payback_months + ' months'
      : 'N/A'}
    </li>
    <li>Estimated 12-Month ROI: {roi.roi_12mo}%</li>
    </ul>
    <p style={{ fontSize: '0.85em', color: '#555' }}>
    These estimates are advisory and based on assumptions you provide.
    </p>
  </div>
  );
}
