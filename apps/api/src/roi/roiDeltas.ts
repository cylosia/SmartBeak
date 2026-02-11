export type RoiDelta = {
  content_id: string;
  estimated_monthly_revenue: number;
  actual_monthly_revenue: number;
  delta: number;
  delta_pct: number | null;
};

export function computeRoiDelta(input: {
  content_id: string;
  estimated_monthly_revenue: number;
  actual_monthly_revenue: number;
}): RoiDelta {
  const delta = input.actual_monthly_revenue - input.estimated_monthly_revenue;
  const delta_pct =
  input.estimated_monthly_revenue > 0
    ? (delta / input.estimated_monthly_revenue) * 100
    : null;

  return {
  content_id: input.content_id,
  estimated_monthly_revenue: input.estimated_monthly_revenue,
  actual_monthly_revenue: input.actual_monthly_revenue,
  delta: Math.round(delta * 100) / 100,
  delta_pct:
    delta_pct !== null ? Math.round(delta_pct * 10) / 10 : null
  };
}
