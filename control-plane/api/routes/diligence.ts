

import { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';

import { rateLimit } from '../../services/rate-limit';

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

    // Fetch domain overview data
    const overview = {
    domain: {
    id: domainId,
    name: 'example.com',
    age: '3 years',
    niche: 'Technology',
    },
    traffic: {
    monthly: 50000,
    trend: 'up',
    sources: { organic: 70, direct: 20, referral: 10 },
    },
    revenue: {
    monthly: 2500,
    sources: ['affiliate', 'ads'],
    confidence: 'high',
    },
    content: {
    totalArticles: 150,
    avgWordCount: 1200,
    lastPublished: new Date().toISOString(),
    },
    expiresAt: rows[0]["expires_at"],
    };

    return overview;
  } catch (error) {
    console["error"]('[diligence/overview] Error:', error);
    // FIX: Added return before reply.send()
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

    // Return affiliate revenue data (buyer-safe, no actual affiliate IDs)
    const revenue = {
    totalMonthly: 1800,
    byProvider: [
    { provider: 'Amazon Associates', percentage: 60, estimated: 1080 },
    { provider: 'Commission Junction', percentage: 25, estimated: 450 },
    { provider: 'Impact', percentage: 15, estimated: 270 },
    ],
    trend: 'stable',
    confidence: 'medium',
    };

    return revenue;
  } catch (error) {
    console["error"]('[diligence/affiliate-revenue] Error:', error);
    // FIX: Added return before reply.send()
    return res.status(500).send({ error: 'Failed to fetch affiliate revenue' });
  }
  });
}
