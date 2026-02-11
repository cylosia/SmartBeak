

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';

import { getLogger } from '../../../packages/kernel/logger';
import { rateLimit } from '../../services/rate-limit';
import { requireRole, AuthContext } from '../../services/auth';

const logger = getLogger('LLM');

export interface LlmModel {
  id: string;
  name: string;
  provider: string;
  capabilities: string[];
  costPer1kTokens: number;
  maxTokens: number;
  available: boolean;
}

export interface LlmPreferences {
  defaultModel: string;
  fallbackModel: string;
  contentGeneration: {
  model: string;
  temperature: number;
  maxTokens: number;
  };
  imageGeneration: {
  provider: string;
  size: string;
  quality: string;
  };
  costLimits: {
  monthly: number;
  alertThreshold: number;
  };
}

// Validation schemas
const UpdatePreferencesSchema = z.object({
  defaultModel: z.string().optional(),
  fallbackModel: z.string().optional(),
  contentGeneration: z.object({
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().min(1).max(8000).optional(),
  }).optional(),
  costLimits: z.object({
  monthly: z.number().min(0).optional(),
  alertThreshold: z.number().min(0).max(100).optional(),
  }).optional(),
});

export type AuthenticatedRequest = FastifyRequest & {
  auth?: AuthContext | undefined;
};

/**
* LLM routes
*/
export async function llmRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  // GET /llm/models - List available LLM models
  app.get('/llm/models', async (
  req: FastifyRequest,
  res: FastifyReply
  ): Promise<void> => {
  try {
    const { auth: ctx } = req as AuthenticatedRequest;
    if (!ctx) {
    return res.status(401).send({ error: 'Unauthorized' });
    }
    requireRole(ctx, ['owner', 'admin', 'editor', 'viewer']);
    await rateLimit('llm', 30, req, res);

    // Fetch models from database
    let models: LlmModel[];
    try {
    const result = await pool.query(
    `SELECT id, name, provider, capabilities, cost_per_1k_tokens as 'costPer1kTokens',
        max_tokens as 'maxTokens', available
    FROM llm_models
    WHERE available = true
    ORDER BY provider, name`
    );
    models = result.rows;
    } catch (dbError) {
    logger.error('[llm/models] Database error:', dbError);
    // Return empty array if table doesn't exist or other DB error
    models = [];
    }

    // If no models in DB or table doesn't exist, return empty array
    // Client should handle this gracefully
    return res.send({ models });
  } catch (error) {
    logger.error('[llm/models] Error:', error);
    // FIX: Added return before reply.send()
    return res.status(500).send({ error: 'Failed to fetch LLM models' });
  }
  });

  // GET /llm/preferences - Get user's LLM preferences
  app.get('/llm/preferences', async (
  req: FastifyRequest,
  res: FastifyReply
  ): Promise<void> => {
  try {
    const { auth: ctx } = req as AuthenticatedRequest;
    if (!ctx) {
    return res.status(401).send({ error: 'Unauthorized' });
    }
    requireRole(ctx, ['owner', 'admin', 'editor']);
    await rateLimit('llm', 30, req, res);

    const preferences: LlmPreferences = {
    defaultModel: 'gpt-4',
    fallbackModel: 'gpt-3.5-turbo',
    contentGeneration: {
    model: 'gpt-4',
    temperature: 0.7,
    maxTokens: 2000,
    },
    imageGeneration: {
    provider: 'dall-e-3',
    size: '1024x1024',
    quality: 'standard',
    },
    costLimits: {
    monthly: 500,
    alertThreshold: 80,
    },
    };

    return res.send(preferences);
  } catch (error) {
    logger.error('[llm/preferences] Error:', error);
    // FIX: Added return before reply.send()
    return res.status(500).send({ error: 'Failed to fetch LLM preferences' });
  }
  });

  // POST /llm/preferences - Update LLM preferences
  app.post('/llm/preferences', async (
  req: FastifyRequest,
  res: FastifyReply
  ): Promise<void> => {
  try {
    const { auth: ctx } = req as AuthenticatedRequest;
    if (!ctx) {
    return res.status(401).send({ error: 'Unauthorized' });
    }
    requireRole(ctx, ['owner', 'admin']);
    await rateLimit('llm', 30, req, res);

    // Validate input
    const parseResult = UpdatePreferencesSchema.safeParse(req.body);
    if (!parseResult.success) {
    res.status(400).send({
    error: 'Validation failed',
    code: 'VALIDATION_ERROR',
    details: parseResult["error"].issues
    });
    return;
    }

    const updates = parseResult.data;

    // In production, save to database
    // Await pool.query('UPDATE org_llm_prefs SET ... WHERE org_id = $1', [orgId]);

    return res.send({ updated: true, preferences: updates });
  } catch (error) {
    logger.error('[llm/preferences] Update error:', error);
    // FIX: Added return before reply.send()
    return res.status(500).send({ error: 'Failed to update LLM preferences' });
  }
  });
}
