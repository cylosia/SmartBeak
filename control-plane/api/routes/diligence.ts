

import { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';
import { getLogger } from '@kernel/logger';

import { rateLimit } from '../../services/rate-limit';

// H14-FIX: Use structured logger instead of console.error
const logger = getLogger('diligence-routes');

const TokenParamSchema = z.object({
  token: z.string().min(10).max(100).regex(/^[a-zA-Z0-9_-]+$/)
});

export async function diligenceRoutes(app: FastifyInstance, pool: Pool) {
  // GET /diligence/:token/overview - Get diligence overview for buyer
  app.get('/diligence/:token/overview', async (req, res) => {
  await rateLimit('diligence', 30);
  const { token } = TokenParamSchema.parse(req.params);

  try {
    // Validate token and get domain info
    const { rows } = await pool.query(
    'SELECT domain_id, expires_at FROM diligence_tokens WHERE token = $1 AND expires_at > NOW()',
    [token]
    );

    if (rows.length === 0) {
    return res.status(404).send({ error: 'Invalid or expired diligence token' });
    }

    const domainId = rows[0].domain_id;

    // H09-FIX: Fetch real domain data from DB instead of returning hardcoded mock values.
    // Previously returned fabricated metrics (name: 'example.com', monthly: 50000, etc.)
    const { rows: domainRows } = await pool.query(
    `SELECT d.id, d.name, d.created_at,
      dr.domain_type, dr.revenue_confidence
    FROM domains d
    LEFT JOIN domain_registry dr ON d.id = dr.id
    WHERE d.id = $1`,
    [domainId]
    );

    if (domainRows.length === 0) {
    return res.status(404).send({ error: 'Domain not found' });
    }

    const domain = domainRows[0];

    // Fetch content stats
    const { rows: contentStats } = await pool.query(
    `SELECT COUNT(*) as total_articles,
      AVG(CHAR_LENGTH(body)) as avg_content_length,
      MAX(published_at) as last_published
    FROM content_items WHERE domain_id = $1 AND status = 'published'`,
    [domainId]
    );

    const stats = contentStats[0] ?? {};

    const overview = {
    domain: {
    id: domain.id,
    name: domain.name,
    createdAt: domain.created_at,
    type: domain.domain_type,
    },
    content: {
    totalArticles: parseInt(stats.total_articles || '0', 10),
    avgContentLength: parseInt(stats.avg_content_length || '0', 10),
    lastPublished: stats.last_published,
    },
    revenueConfidence: domain.revenue_confidence,
    expiresAt: rows[0].expires_at,
    };

    return overview;
  } catch (error) {
    logger.error('Diligence overview error', error instanceof Error ? error : new Error(String(error)));
    return res.status(500).send({ error: 'Failed to fetch diligence overview' });
  }
  });

  // GET /diligence/:token/affiliate-revenue - Get affiliate revenue breakdown
  app.get('/diligence/:token/affiliate-revenue', async (req, res) => {
  await rateLimit('diligence', 30);
  const { token } = TokenParamSchema.parse(req.params);

  try {
    // Validate token
    const { rows } = await pool.query(
    'SELECT domain_id FROM diligence_tokens WHERE token = $1 AND expires_at > NOW()',
    [token]
    );

    if (rows.length === 0) {
    return res.status(404).send({ error: 'Invalid or expired diligence token' });
    }

    const domainId = rows[0].domain_id;

    // H09-FIX: Fetch real affiliate revenue data instead of hardcoded values
    const { rows: revenueRows } = await pool.query(
    `SELECT provider_name, percentage, estimated_monthly
    FROM affiliate_revenue_breakdown
    WHERE domain_id = $1
    ORDER BY percentage DESC`,
    [domainId]
    );

    const totalMonthly = revenueRows.reduce(
    (sum: number, r: { estimated_monthly: number }) => sum + (r.estimated_monthly || 0), 0
    );

    return {
    totalMonthly,
    byProvider: revenueRows.map((r: { provider_name: string; percentage: number; estimated_monthly: number }) => ({
    provider: r.provider_name,
    percentage: r.percentage,
    estimated: r.estimated_monthly,
    })),
    };
  } catch (error) {
    logger.error('Diligence affiliate-revenue error', error instanceof Error ? error : new Error(String(error)));
    return res.status(500).send({ error: 'Failed to fetch affiliate revenue' });
  }
  });
}
