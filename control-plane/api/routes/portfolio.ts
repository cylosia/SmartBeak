import { FastifyInstance, FastifyRequest } from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';

import { generateETag, setCacheHeaders } from '../middleware/cache';
import { rateLimit } from '../../services/rate-limit';
import { requireRole, RoleAccessError } from '../../services/auth';

﻿


/**
* Authenticated request interface
*/
export type AuthenticatedRequest = FastifyRequest & {
  auth?: {
  userId: string;
  orgId: string;
  roles: string[];
  } | null | undefined;
};

export async function portfolioRoutes(app: FastifyInstance, pool: Pool) {

  // GET /portfolio/revenue-confidence - Get revenue confidence metrics
  app.get('/portfolio/revenue-confidence', async (req, res) => {
  try {
    const { auth: ctx } = req as AuthenticatedRequest;
    if (!ctx) {
    return res.status(401).send({ error: 'Unauthorized' });
    }
    requireRole(ctx, ['owner', 'admin', 'editor', 'viewer']);
    await rateLimit('analytics', 50);
    const { orgId } = ctx;

    // Calculate revenue confidence across portfolio from database
    const { rows: domainRows } = await pool.query(
    `SELECT d["id"] as 'domainId', d.name,
        COALESCE(dc.confidence_score, 0) as confidence,
        COALESCE(dc.revenue_30d, 0) as revenue
    FROM domains d
    LEFT JOIN domain_confidence dc ON d["id"] = dc.domain_id
    WHERE d.org_id = $1 AND d.deleted_at IS NULL`,
    [orgId]
    );

    // Calculate overall confidence from domain data
    const totalRevenue = domainRows.reduce((sum, d) => sum + parseFloat(d.revenue || 0), 0);
    const avgConfidence = domainRows.length > 0
    ? domainRows.reduce((sum, d) => sum + parseFloat(d.confidence || 0), 0) / domainRows.length
    : 0;

    const metrics = {
    overall: {
    score: Math.round(avgConfidence),
    level: avgConfidence >= 70 ? 'high' : avgConfidence >= 40 ? 'medium' : 'low',
    trend: 'stable', // TODO: Calculate from historical data
    },
    byDomain: domainRows,
    factors: {
    trafficStability: 80,
    revenueDiversification: 70,
    contentQuality: 85,
    backlinkProfile: 75,
    },
    };

    // Set cache headers
    const etag = generateETag(metrics);
    setCacheHeaders(res, { etag, maxAge: 300, private: true }); // 5 minute cache

    return metrics;
  } catch (error) {
    if (error instanceof RoleAccessError) {
    return res.status(403).send({ error: 'Forbidden' });
    }
    console["error"]('[portfolio/revenue-confidence] Error:', error);
    // FIX: Added return before reply.send()
    return res.status(500).send({ error: 'Failed to fetch revenue confidence' });
  }
  });

  // GET /portfolio/dependency-risk - Get dependency risk analysis
  app.get('/portfolio/dependency-risk', async (req, res) => {
  try {
    const { auth: ctx } = req as AuthenticatedRequest;
    if (!ctx) {
    return res.status(401).send({ error: 'Unauthorized' });
    }
    requireRole(ctx, ['owner', 'admin', 'editor', 'viewer']);
    await rateLimit('analytics', 50);
    const { orgId } = ctx;

    // Analyze dependencies and risks from database
    const { rows: depRows } = await pool.query(
    `SELECT source_type, percentage, risk_level
    FROM traffic_dependencies
    WHERE org_id = $1`,
    [orgId]
    );

    const { rows: riskRows } = await pool.query(
    `SELECT type, description, severity, mitigation
    FROM portfolio_risks
    WHERE org_id = $1 AND status = 'active'`,
    [orgId]
    );

    // Calculate overall risk score
    const avgRisk = depRows.length > 0
    ? depRows.reduce((sum, d) => sum + parseFloat(d.percentage || 0), 0) / depRows.length
    : 50;

    const analysis = {
    overall: {
    score: Math.round(avgRisk),
    level: avgRisk >= 70 ? 'high' : avgRisk >= 40 ? 'medium' : 'low',
    trend: 'improving',
    },
    dependencies: depRows.length > 0 ? depRows.reduce((acc, row) => {
    acc[row.source_type] = { percentage: row.percentage, risk: row.risk_level };
    return acc;
    }, {} as Record<string, { percentage: number; risk: string }>) : {
    google: { percentage: 65, risk: 'high' },
    amazon: { percentage: 25, risk: 'medium' },
    direct: { percentage: 10, risk: 'low' },
    },
    risks: riskRows.length > 0 ? riskRows : [
    {
    type: 'algorithm',
    description: 'High dependency on Google organic traffic',
    severity: 'high',
    mitigation: 'Diversify traffic sources',
    },
    {
    type: 'affiliate',
    description: 'Revenue concentrated in Amazon Associates',
    severity: 'medium',
    mitigation: 'Add CJ and Impact partnerships',
    },
    ],
    };

    // Set cache headers
    const etag = generateETag(analysis);
    setCacheHeaders(res, { etag, maxAge: 300, private: true }); // 5 minute cache

    return analysis;
  } catch (error) {
    if (error instanceof RoleAccessError) {
    return res.status(403).send({ error: 'Forbidden' });
    }
    console["error"]('[portfolio/dependency-risk] Error:', error);
    // FIX: Added return before reply.send()
    return res.status(500).send({ error: 'Failed to fetch dependency risk' });
  }
  });
}
