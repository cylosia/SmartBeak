
import React from 'react';
export interface UsageForecast {
  period_days?: number;
  projected_jobs?: number;
  projected_cost_usd?: number;
}

export interface UsageForecastPanelProps {
  forecast?: UsageForecast;
}

export function UsageForecastPanel({ forecast }: UsageForecastPanelProps) {
  if (!forecast) {
  return null;
  }

  return (
  <div>
    <h3>Usage Forecast</h3>
    <p>Next {forecast.period_days ?? 0} days</p>
    <ul>
    <li>Projected jobs: {forecast.projected_jobs ?? 0}</li>
    <li>Estimated cost: ${(forecast.projected_cost_usd ?? 0).toFixed(2)}</li>
    </ul>
  </div>
  );
}
