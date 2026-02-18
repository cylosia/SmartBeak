// P3-FIX: Imports must come before exports (import/first ESLint rule).
import { getLogger } from '@kernel/logger';
import type { ContentId } from '@kernel/branded';

// P2-AUDIT-FIX: Added Quadrant union type (was untyped string) and explicit return type.
export type Quadrant = 'invest' | 'prune' | 'double_down' | 'refresh';

const logger = getLogger('buildHeatmap');

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
  // P2-FIX: Replaced console.warn with structured logger per CLAUDE.md convention
  // ("Never use console.log"). The circular-dep claim in the previous comment was
  // incorrect — @kernel/logger does not import from this module.
  const allIdentical = points.every(
    p => safeNum(p.traffic) === safeNum(points[0]!.traffic) &&
         safeNum(p.roi_12mo) === safeNum(points[0]!.roi_12mo) &&
         safeNum(p.freshness_days) === safeNum(points[0]!.freshness_days)
  );
  if (allIdentical && points.length > 1) {
    logger.warn('All points have identical metrics — all will classify as invest', { pointCount: points.length });
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
    //
    // P1-DATA-FIX: Non-finite freshness_days (NaN, null from pipeline gaps) was
    // previously coerced to 0 by safeNum, silently preventing stale content from
    // being classified as 'refresh'. Now logged as a warning and treated as 'refresh'
    // (the safe default) since we cannot distinguish "0 days old" from "unknown age".
    if (!Number.isFinite(p.freshness_days)) {
      logger.warn('Point has non-finite freshness_days; classifying as refresh (safe default)', {
        content_id: p.content_id,
        freshness_days: p.freshness_days,
      });
      return {
        content_id: p.content_id,
        traffic: p.traffic,
        roi_12mo: p.roi_12mo,
        freshness_days: p.freshness_days,
        quadrant: 'refresh' as Quadrant,
      };
    }

    if (freshness > 365) {
      quadrant = 'refresh';
    } else if (traffic < avgTraffic * 0.5 && roi < 0) {
      // P1-BUG-FIX: Removed Math.max(100, avgTraffic * 0.5) absolute floor on
      // the prune threshold. When avgTraffic is low (e.g. 50), the floor of 100
      // caused content with traffic=80 (60% ABOVE average) to be pruned.
      // Prune is the most destructive action (irreversible content deletion), so
      // the threshold must be purely relative to portfolio performance, not absolute.
      quadrant = 'prune';
    } else if (traffic > avgTraffic * 1.5 && roi > Math.max(50, avgRoi * 1.2)) {
      // P2-BUG-FIX: Removed Math.min(1000, avgTraffic * 1.5) absolute cap on the
      // double_down threshold. When avgTraffic > 667, the cap prevented ANY content
      // from being classified as double_down regardless of relative performance.
      // High-performing content in large portfolios was systematically undervalued.
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
