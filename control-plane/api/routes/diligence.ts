

import { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';
import { getLogger } from '@kernel/logger';

import { rateLimit } from '../../services/rate-limit';
import { getClientIp } from '@kernel/ip-utils';
import { errors } from '@errors/responses';

// H14-FIX: Use structured logger instead of console.error
const logger = getLogger('diligence-routes');

const TokenParamSchema = z.object({
  token: z.string().min(10).max(100).regex(/^[a-zA-Z0-9_-]+$/)
});

export async function diligenceRoutes(app: FastifyInstance, pool: Pool) {
  // GET /diligence/:token/overview - Get diligence overview for buyer
  app.get('/diligence/:token/overview', async (req, res) => {
  try {
    // C1-FIX: parse and rateLimit moved inside try so Zod/Redis errors
    // return a structured 400 instead of crashing the process.
    const tokenResult = TokenParamSchema.safeParse(req.params);
    if (!tokenResult.success) {
      return errors.badRequest(res, 'Invalid token format');
    }
    const { token } = tokenResult.data;
    // RD-1-FIX P1: Use kernelGetClientIp instead of hand-rolled x-forwarded-for parsing.
    // The hand-rolled version lacked spoofing protection: an attacker could set
    // X-Forwarded-For: <victim-ip> to exhaust the victim's rate limit bucket.
    // @kernel/ip-utils validates the header against trusted proxy ranges.
    const clientIp = getClientIp(req);
    await rateLimit(`diligence:${clientIp}`, 30);
    // Validate token and get domain info
    const { rows } = await pool.query(
    'SELECT domain_id, expires_at FROM diligence_tokens WHERE token = $1 AND expires_at > NOW()',
    [token]
    );

    if (rows.length === 0) {
    return errors.notFound(res, 'Diligence token');
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
    return errors.notFound(res, 'Domain');
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
    // P1-FLOAT-FIX: AVG() returns a float — parseInt() silently truncated the decimal
    // (e.g. 1234.7 → 1234), under-reporting average content length in due-diligence
    // reports. parseFloat preserves the precision returned by the database.
    avgContentLength: parseFloat(stats.avg_content_length || '0'),
    lastPublished: stats.last_published,
    },
    revenueConfidence: domain.revenue_confidence,
    expiresAt: rows[0].expires_at,
    };

    return overview;
  } catch (error) {
    logger.error('Diligence overview error', error instanceof Error ? error : new Error(String(error)));
    return errors.internal(res, 'Failed to fetch diligence overview');
  }
  });

  // GET /diligence/:token/affiliate-revenue - Get affiliate revenue breakdown
  app.get('/diligence/:token/affiliate-revenue', async (req, res) => {
  try {
    // C1-FIX: parse and rateLimit moved inside try so Zod/Redis errors return 400.
    const tokenResult = TokenParamSchema.safeParse(req.params);
    if (!tokenResult.success) {
      return errors.badRequest(res, 'Invalid token format');
    }
    const { token } = tokenResult.data;
    // RD-1-FIX P1: Use kernelGetClientIp (see overview handler for rationale).
    const clientIp = getClientIp(req);
    await rateLimit(`diligence:${clientIp}`, 30);
    // Validate token
    const { rows } = await pool.query(
    'SELECT domain_id FROM diligence_tokens WHERE token = $1 AND expires_at > NOW()',
    [token]
    );

    if (rows.length === 0) {
    return errors.notFound(res, 'Diligence token');
    }

    const domainId = rows[0].domain_id;

    // H09-FIX: Fetch real affiliate revenue data instead of hardcoded values
    // P1-3 FIX: Add LIMIT to prevent unbounded result sets (OOM risk)
    const { rows: revenueRows } = await pool.query(
    `SELECT provider_name, percentage, estimated_monthly
    FROM affiliate_revenue_breakdown
    WHERE domain_id = $1
    ORDER BY percentage DESC
    LIMIT 1000`,
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
    return errors.internal(res, 'Failed to fetch affiliate revenue');
  }
  });
}
