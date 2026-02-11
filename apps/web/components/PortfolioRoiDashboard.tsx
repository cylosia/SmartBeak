
import React from 'react';
export interface PortfolioRoi {
  total_production_cost?: number;
  total_monthly_revenue?: number;
  avg_payback_months?: number | null;
  roi_12mo?: number;
}

export interface RoiSummary {
  total_content_items?: number;
  portfolio_roi?: PortfolioRoi;
}

export interface PortfolioRoiDashboardProps {
  summary?: RoiSummary;
}

export function PortfolioRoiDashboard({ summary }: PortfolioRoiDashboardProps) {
  if (!summary) {
  return null;
  }

  const portfolioRoi = summary.portfolio_roi;

  return (
  <div>
    <h2>Portfolio ROI</h2>
    <ul>
    <li>Total Content Items: {summary.total_content_items ?? 0}</li>
    <li>Total Production Cost: ${portfolioRoi?.total_production_cost ?? 0}</li>
    <li>Estimated Monthly Revenue: ${portfolioRoi?.total_monthly_revenue ?? 0}</li>
    <li>
      Avg Payback:{' '}
      {portfolioRoi?.avg_payback_months !== null && portfolioRoi?.avg_payback_months !== undefined
      ? portfolioRoi.avg_payback_months + ' months'
      : 'N/A'}
    </li>
    <li>Estimated 12-Month ROI: {portfolioRoi?.roi_12mo ?? 0}%</li>
    </ul>
  </div>
  );
}
