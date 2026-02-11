

import { FastifyInstance, FastifyRequest } from 'fastify';
import { Pool } from 'pg';

import { getLogger } from '../../../packages/kernel/logger';
import { rateLimit } from '../../services/rate-limit';
import { requireRole, RoleAccessError, type AuthContext } from '../../services/auth';

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
    return res.status(401).send({ error: 'Unauthorized' });
    }
    requireRole(ctx, ['owner', 'admin', 'editor', 'viewer']);
    await rateLimit('roi-risk', 50);

    const { assetId } = req.params as { assetId: string };

    const hasAccess = await verifyAssetOwnership(ctx["orgId"], assetId, pool);
    if (!hasAccess) {
    logger.warn(`[IDOR] User ${ctx.userId} attempted to access ROI/Risk for asset ${assetId} outside their org`);
    return res.status(404).send({ error: 'Asset not found' });
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
    return res.status(404).send({ error: 'Asset not found' });
    }

    const [riskFactorsResult, recommendationsResult] = await Promise.all([
    pool.query(
    `SELECT name, level, score
    FROM asset_risk_factors
    WHERE asset_id = $1`,
    [assetId]
    ),
    pool.query(
    `SELECT recommendation as text
    FROM asset_recommendations
    WHERE asset_id = $1
    ORDER BY priority DESC`,
    [assetId]
    )
    ]);

    const riskFactors = riskFactorsResult.rows;
    const recommendations = recommendationsResult.rows;

    // Calculate overall risk score
    const avgRiskScore = riskFactors.length > 0
    ? riskFactors.reduce((sum, f) => sum + parseFloat(f.score || 0), 0) / riskFactors.length
    : 50;

    const analysis = {
    asset: {
    id: assetData["id"],
    type: assetData.type,
    name: assetData.name,
    },
    roi: {
    monthly: parseFloat(assetData.monthly_revenue) || 0,
    yearly: parseFloat(assetData.yearly_revenue) || 0,
    percentage: parseFloat(assetData.roi_percentage) || 0,
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
    return res.status(403).send({ error: 'Forbidden' });
    }
    logger.error('[roi-risk] Error:', error);
    // FIX: Added return before reply.send()
    return res.status(500).send({ error: 'Failed to fetch ROI/Risk analysis' });
  }
  });
}
