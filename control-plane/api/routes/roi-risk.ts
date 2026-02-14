

import { FastifyInstance } from 'fastify';
import { Pool } from 'pg';

import { getLogger } from '@kernel/logger';
import { rateLimit } from '../../services/rate-limit';
import { requireRole, RoleAccessError, type AuthContext } from '../../services/auth';
import { errors } from '@errors/responses';

const logger = getLogger('ROIRisk');

async function verifyAssetOwnership(orgId: string, assetId: string, pool: Pool): Promise<boolean> {
  const result = await pool.query('SELECT 1 FROM assets WHERE id = $1 AND org_id = $2', [assetId, orgId]);
  return (result.rowCount ?? 0) > 0;
}

export async function roiRiskRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  // GET /roi-risk/:assetId - Get ROI and risk analysis for an asset
  app.get('/roi-risk/:assetId', async (req, res) => {
  try {
    const ctx = req.auth as AuthContext;
    if (!ctx) {
    return errors.unauthorized(res);
    }
    requireRole(ctx, ['owner', 'admin', 'editor', 'viewer']);
    await rateLimit('roi-risk', 50);

    const { assetId } = req.params as { assetId: string };

    const hasAccess = await verifyAssetOwnership(ctx["orgId"], assetId, pool);
    if (!hasAccess) {
    logger.warn(`[IDOR] User ${ctx.userId} attempted to access ROI/Risk for asset ${assetId} outside their org`);
    return errors.notFound(res, 'Asset');
    }

    // Fetch ROI and risk data for the asset from database
    const { rows: [assetData] } = await pool.query(
    `SELECT a["id"], a.type, a.name,
        COALESCE(ar.monthly_revenue, 0) as monthly_revenue,
        COALESCE(ar.yearly_revenue, 0) as yearly_revenue,
        COALESCE(ar.roi_percentage, 0) as roi_percentage,
        COALESCE(ar.trend, 'stable') as trend
    FROM assets a
    LEFT JOIN asset_roi ar ON a["id"] = ar.asset_id
    WHERE a["id"] = $1 AND a.org_id = $2`,
    [assetId, ctx["orgId"]]
    );

    if (!assetData) {
    return errors.notFound(res, 'Asset');
    }

    // AUDIT-FIX P1-07: Add org_id to secondary queries to prevent
    // cross-tenant data leakage through asset_risk_factors and
    // asset_recommendations tables.
    const [riskFactorsResult, recommendationsResult] = await Promise.all([
    pool.query(
    `SELECT arf.name, arf.level, arf.score
    FROM asset_risk_factors arf
    JOIN assets a ON a.id = arf.asset_id
    WHERE arf.asset_id = $1 AND a.org_id = $2`,
    [assetId, ctx["orgId"]]
    ),
    pool.query(
    `SELECT ar.recommendation as text
    FROM asset_recommendations ar
    JOIN assets a ON a.id = ar.asset_id
    WHERE ar.asset_id = $1 AND a.org_id = $2
    ORDER BY ar.priority DESC`,
    [assetId, ctx["orgId"]]
    )
    ]);

    const riskFactors = riskFactorsResult.rows;
    const recommendations = recommendationsResult.rows;

    // AUDIT-FIX P1-09: Use Number() instead of parseFloat() to avoid
    // passing non-string values and to properly handle null/undefined.
    const avgRiskScore = riskFactors.length > 0
    ? riskFactors.reduce((sum, f) => sum + (Number(f.score) || 0), 0) / riskFactors.length
    : 50;

    const analysis = {
    asset: {
    id: assetData["id"],
    type: assetData.type,
    name: assetData.name,
    },
    roi: {
    // AUDIT-FIX P1-09: Use Number() for consistent numeric coercion
    monthly: Number(assetData.monthly_revenue) || 0,
    yearly: Number(assetData.yearly_revenue) || 0,
    percentage: Number(assetData.roi_percentage) || 0,
    trend: assetData.trend,
    },
    risk: {
    score: Math.round(avgRiskScore),
    level: avgRiskScore >= 70 ? 'high' : avgRiskScore >= 40 ? 'medium' : 'low',
    factors: riskFactors.length > 0 ? riskFactors : [
    { name: 'Traffic Concentration', level: 'medium', score: 45 },
    { name: 'Revenue Diversification', level: 'low', score: 25 },
    { name: 'Content Freshness', level: 'low', score: 20 },
    ],
    },
    recommendations: recommendations.length > 0
    ? recommendations.map(r => r.text)
    : ['Diversify traffic sources', 'Update top 10 articles', 'Add affiliate partnerships'],
    };

    return analysis;
  } catch (error) {
    if (error instanceof RoleAccessError) {
    return errors.forbidden(res);
    }
    logger.error('[roi-risk] Error', error instanceof Error ? error : new Error(String(error)));
    // FIX: Added return before reply.send()
    return errors.internal(res, 'Failed to fetch ROI/Risk analysis');
  }
  });
}
