export type ContentRoiInput = {
  production_cost_usd: number;
  monthly_traffic: number;
  conversion_rate: number;
  revenue_per_conversion: number;
};

export type ContentRoiOutput = {
  monthly_revenue: number;
  payback_months: number | null;
  // null when production_cost_usd is 0 (ROI is undefined/infinite for free content)
  roi_12mo: number | null;
};

export function computeContentRoi(input: ContentRoiInput): ContentRoiOutput {
  // P0-003 FIX: conversion_rate is a percentage (0–100) from the Zod schema.
  // Divide by 100 before multiplying. Without this, a 5% conversion rate
  // produces 100× the correct revenue (5 × traffic instead of 0.05 × traffic).
  const monthly_revenue =
  input.monthly_traffic *
  (input.conversion_rate / 100) *
  input.revenue_per_conversion;

  // FIX: Division by zero protection
  const payback_months =
  monthly_revenue > 0
    ? input.production_cost_usd / monthly_revenue
    : null;

  // P2-028 FIX: Return null for zero-cost content instead of 0.
  // A return of 0% ROI for zero-cost content is misleading (the ROI is
  // actually infinite/undefined). Callers must handle null.
  const roi_12mo =
  input.production_cost_usd > 0
    ? ((monthly_revenue * 12 - input.production_cost_usd) /
      input.production_cost_usd) *
    100
    : null;

  return {
  monthly_revenue: Math.round(monthly_revenue * 100) / 100,
  payback_months:
    payback_months !== null
    ? Math.round(payback_months * 10) / 10
    : null,
  roi_12mo: roi_12mo !== null ? Math.round(roi_12mo) : null,
  };
}
