export function detectContentDecay(metrics: {
  impressions_30d: number;
  impressions_prev_30d: number;
}): boolean {
  if (metrics.impressions_prev_30d === 0) return false;
  const drop =
  (metrics.impressions_prev_30d - metrics.impressions_30d) /
  metrics.impressions_prev_30d;
  return drop > 0.25;
}
