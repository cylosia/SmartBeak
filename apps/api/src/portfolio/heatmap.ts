// P2-AUDIT-FIX: Added Quadrant union type (was untyped string) and explicit return type.
export type Quadrant = 'invest' | 'prune' | 'double_down' | 'refresh';

import type { ContentId } from '@kernel/branded';

export type HeatmapPoint = {
  // P2-FIX: Use branded ContentId instead of plain string to prevent accidental
  // mixing of OrgId, DomainId, or arbitrary strings at compile time.
  content_id: ContentId;
  traffic: number;
  roi_12mo: number;
  freshness_days: number;
};

export type HeatmapResult = HeatmapPoint & { quadrant: Quadrant };

export function buildHeatmap(points: HeatmapPoint[]): HeatmapResult[] {
  // FIX: Handle empty input array
  if (!Array.isArray(points) || points.length === 0) {
    return [];
  }

  // P2-DATA-INTEGRITY-FIX: Use Number.isFinite() guards instead of || or ??.
  // Previously: || treated 0 and NaN as falsy (inconsistent with ?? on lines 28-30).
  // Now: Number.isFinite() consistently rejects NaN, Infinity, null, and undefined,
  // preventing silent misclassification of corrupted data into 'invest' quadrant.
  const safeNum = (v: number): number => Number.isFinite(v) ? v : 0;
  const avgTraffic = points.reduce((sum, p) => sum + safeNum(p.traffic), 0) / points.length;
  const avgRoi = points.reduce((sum, p) => sum + safeNum(p.roi_12mo), 0) / points.length;

  // P3-FIX: Warn when all points have identical metrics — classification is
  // meaningless in this case and callers should be aware of the degenerate input.
  const allIdentical = points.every(
    p => safeNum(p.traffic) === safeNum(points[0]!.traffic) &&
         safeNum(p.roi_12mo) === safeNum(points[0]!.roi_12mo) &&
         safeNum(p.freshness_days) === safeNum(points[0]!.freshness_days)
  );
  if (allIdentical && points.length > 1) {
    // Cannot import getLogger here (kernel circular dep risk); use console.warn
    // which is acceptable in a pure computation module with no side effects.
    // Callers that need structured logging should check for uniform output.
    console.warn('[buildHeatmap] All points have identical metrics — all will classify as "invest"');
  }

  return points.map(p => {
    let quadrant: Quadrant = 'invest';

    // P2-DATA-INTEGRITY-FIX: Use consistent Number.isFinite() guards for all numeric fields
    const traffic = safeNum(p.traffic);
    const roi = safeNum(p.roi_12mo);
    const freshness = safeNum(p.freshness_days);

    // P1-FIX: Freshness check MUST run FIRST (independent of other signals).
    // The previous else-if chain caused content >365 days old with low traffic/negative
    // ROI to be classified as 'prune' (eligible for deletion) instead of 'refresh'
    // (candidate for update). A deletion action on stale content is irreversible;
    // the freshness signal must take precedence over the prune signal.
    if (freshness > 365) {
      quadrant = 'refresh';
    } else if (traffic < Math.max(100, avgTraffic * 0.5) && roi < 0) {
      quadrant = 'prune';
    } else if (traffic > Math.min(1000, avgTraffic * 1.5) && roi > Math.max(50, avgRoi * 1.2)) {
      quadrant = 'double_down';
    }

    // P2-FIX: Explicit field selection instead of { ...p, quadrant }.
    // Spreading the runtime object would leak any undeclared DB columns (e.g.,
    // internal_batch_id, org_id, deleted_at) that the database layer adds beyond
    // the HeatmapPoint type contract, exposing them in API responses.
    return {
      content_id: p.content_id,
      traffic: p.traffic,
      roi_12mo: p.roi_12mo,
      freshness_days: p.freshness_days,
      quadrant,
    };
  });
}
