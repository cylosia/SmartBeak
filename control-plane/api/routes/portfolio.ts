import { FastifyInstance, FastifyRequest } from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';

import { generateETag, setCacheHeaders } from '../middleware/cache';
import { rateLimit } from '../../services/rate-limit';
import { requireRole, RoleAccessError } from '../../services/auth';




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

    // H2-FIX: Query only domains table (domain_confidence table does not exist yet)
    // TODO: Create domain_confidence migration and populate real data
    const { rows: domainRows } = await pool.query(
    `SELECT d["id"] as "domainId", d.name
    FROM domains d
    WHERE d.org_id = $1 AND d.status != 'inactive'`,
    [orgId]
    );

    const metrics = {
    overall: {
    score: 0,
    level: 'low' as const,
    trend: 'stable',
    },
    byDomain: domainRows,
    factors: {},
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

    // H2-FIX: Removed queries to non-existent tables (traffic_dependencies, portfolio_risks)
    // TODO: Create these tables via migrations and populate real data
    const analysis = {
    overall: {
    score: 0,
    level: 'low' as const,
    trend: 'stable',
    },
    dependencies: {},
    risks: [],
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
