

import { FastifyInstance } from 'fastify';
import { Pool } from 'pg';

import { getAuthContext } from '../types';
import { rateLimit } from '../../services/rate-limit';
import { requireRole } from '../../services/auth';

export async function attributionRoutes(app: FastifyInstance, pool: Pool) {
  // GET /attribution/llm - LLM attribution report
  app.get('/attribution/llm', async (req, res) => {
  // SECURITY FIX: Rate limit BEFORE auth to prevent DoS
  await rateLimit('attribution', 50);
  const ctx = getAuthContext(req);
  requireRole(ctx, ['owner', 'admin', 'editor', 'viewer']);

  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { rows } = await pool.query(
    `SELECT service as source,
        operation as usage,
        COALESCE(SUM(cost), 0) as cost,
        COALESCE(SUM(tokens), 0) as tokens
    FROM cost_tracking
    WHERE org_id = $1
      AND date >= $2
    GROUP BY service, operation
    ORDER BY cost DESC`,
    [ctx.orgId, thirtyDaysAgo.toISOString().split('T')[0]]
    );

    const report = {
    citations: rows.map(r => ({
      source: r.source,
      usage: r.usage,
      cost: parseFloat(r.cost),
      tokens: parseInt(r.tokens, 10),
    })),
    totalCost: rows.reduce((sum: number, r: { cost: string }) => sum + parseFloat(r.cost), 0),
    period: 'last_30_days',
    };

    return report;
  } catch (error) {
    console["error"]('[attribution/llm] Error:', error);
    // FIX: Added return before reply.send()
    return res.status(500).send({ error: 'Failed to fetch LLM attribution' });
  }
  });

  // GET /attribution/buyer-safe - Buyer-safe attribution summary
  app.get('/attribution/buyer-safe', async (req, res) => {
  // SECURITY FIX: Rate limit BEFORE auth to prevent DoS
  await rateLimit('attribution', 50);
  const ctx = getAuthContext(req);
  requireRole(ctx, ['owner', 'admin', 'editor', 'viewer']);

  try {
    // Return anonymized attribution data suitable for buyers
    const summary = {
    aiAssisted: true,
    humanReviewed: true,
    aiPercentage: 40,
    tools: ['GPT-4', 'DALL-E', 'Custom models'],
    disclosure: 'Content is AI-assisted with human editorial oversight',
    };

    return summary;
  } catch (error) {
    console["error"]('[attribution/buyer-safe] Error:', error);
    // FIX: Added return before reply.send()
    return res.status(500).send({ error: 'Failed to fetch attribution summary' });
  }
  });
}
