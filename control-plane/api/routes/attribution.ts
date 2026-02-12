

import { FastifyInstance } from 'fastify';
import { Pool } from 'pg';

import { getAuthContext } from '../types';
import { rateLimit } from '../../services/rate-limit';
import { requireRole } from '../../services/auth';

export async function attributionRoutes(app: FastifyInstance, _pool: Pool) {
  // GET /attribution/llm - LLM attribution report
  app.get('/attribution/llm', async (req, res) => {
  // SECURITY FIX: Rate limit BEFORE auth to prevent DoS
  await rateLimit('attribution', 50);
  const ctx = getAuthContext(req);
  requireRole(ctx, ['owner', 'admin', 'editor', 'viewer']);

  try {
    // Return LLM citation and attribution data
    const report = {
    citations: [
    {
    source: 'OpenAI GPT-4',
    usage: 'Content generation',
    cost: 125.5,
    tokens: 2500000,
    },
    {
    source: 'Anthropic Claude',
    usage: 'Research assistance',
    cost: 45.0,
    tokens: 900000,
    },
    ],
    totalCost: 170.5,
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
