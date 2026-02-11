export type ContentRoiInput = {
  production_cost_usd: number;
  monthly_traffic: number;
  conversion_rate: number;
  revenue_per_conversion: number;
};

export type ContentRoiOutput = {
  monthly_revenue: number;
  payback_months: number | null;
  roi_12mo: number;
};

export function computeContentRoi(input: ContentRoiInput): ContentRoiOutput {
  const monthly_revenue =
  input.monthly_traffic *
  input.conversion_rate *
  input.revenue_per_conversion;

  // FIX: Division by zero protection
  const payback_months =
  monthly_revenue > 0
    ? input.production_cost_usd / monthly_revenue
    : null;

  // FIX: Division by zero protection - return 0 ROI if no production cost
  const roi_12mo =
  input.production_cost_usd > 0
    ? ((monthly_revenue * 12 - input.production_cost_usd) /
      input.production_cost_usd) *
    100
    : 0;

  return {
  monthly_revenue: Math.round(monthly_revenue * 100) / 100,
  payback_months:
    payback_months !== null
    ? Math.round(payback_months * 10) / 10
    : null,
  roi_12mo: Math.round(roi_12mo)
  };
}
