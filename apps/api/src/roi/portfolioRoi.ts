/**
* Portfolio ROI Calculation
* Computes aggregate ROI metrics across a portfolio of content
*/

export interface PortfolioRow {
  production_cost_usd: number;
  monthly_revenue_estimate: number;
}

export interface PortfolioRoi {
  total_production_cost: number;
  total_monthly_revenue: number;
  avg_payback_months: number | null;
  roi_12mo: number;
}

/**
* Compute portfolio ROI from content rows

*
* @param rows - Array of portfolio data rows
* @returns Computed portfolio ROI metrics
*/
export function computePortfolioRoi(rows: PortfolioRow[]): PortfolioRoi {
  // Handle empty array
  if (!Array.isArray(rows) || rows.length === 0) {
  return {
    total_production_cost: 0,
    total_monthly_revenue: 0,
    avg_payback_months: null,
    roi_12mo: 0,
  };
  }

  const totalCost = rows.reduce((sum, r) => sum + (r.production_cost_usd || 0), 0);
  const totalMonthlyRevenue = rows.reduce(
  (sum, r) => sum + (r.monthly_revenue_estimate || 0),
  0
  );

  const avgPayback =
  totalMonthlyRevenue > 0
    ? totalCost / totalMonthlyRevenue
    : null;

  const roi12Mo =
  totalCost > 0
    ? ((totalMonthlyRevenue * 12 - totalCost) / totalCost) * 100
    : 0;

  return {
  total_production_cost: Math.round(totalCost * 100) / 100,
  total_monthly_revenue: Math.round(totalMonthlyRevenue * 100) / 100,
  avg_payback_months:
    avgPayback !== null ? Math.round(avgPayback * 10) / 10 : null,
  roi_12mo: Math.round(roi12Mo)
  };
}
