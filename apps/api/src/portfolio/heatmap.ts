export type HeatmapPoint = {
  content_id: string;
  traffic: number;
  roi_12mo: number;
  freshness_days: number;
};

export function buildHeatmap(points: HeatmapPoint[]) {
  // FIX: Handle empty input array
  if (!Array.isArray(points) || points.length === 0) {
  return [];
  }

  // FIX: Safely calculate averages to avoid division by zero
  const avgTraffic = points.length > 0
  ? points.reduce((sum, p) => sum + (p.traffic || 0), 0) / points.length
  : 0;
  const avgRoi = points.length > 0
  ? points.reduce((sum, p) => sum + (p.roi_12mo || 0), 0) / points.length
  : 0;

  return points.map(p => {
  let quadrant = 'invest';

  // FIX: Use safe comparisons with null/undefined handling
  const traffic = p.traffic ?? 0;
  const roi = p.roi_12mo ?? 0;
  const freshness = p.freshness_days ?? 0;

  // Dynamic thresholds based on averages to avoid hardcoded magic numbers
  if (traffic < Math.max(100, avgTraffic * 0.5) && roi < 0) quadrant = 'prune';
  else if (traffic > Math.min(1000, avgTraffic * 1.5) && roi > Math.max(50, avgRoi * 1.2)) quadrant = 'double_down';
  else if (freshness > 365) quadrant = 'refresh';

  return {
    ...p,
  };
  });
}
