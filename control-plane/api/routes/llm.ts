

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';

import { getLogger } from '../../../packages/kernel/logger';
import { rateLimit } from '../../services/rate-limit';
import { requireRole, AuthContext } from '../../services/auth';
import { getContainer } from '../../services/container';

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

// P1-FIX: Add .strict() to reject unknown properties
const UpdatePreferencesSchema = z.object({
  defaultModel: z.string().optional(),
  fallbackModel: z.string().optional(),
  contentGeneration: z.object({
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().min(1).max(8000).optional(),
  }).strict().optional(),
  costLimits: z.object({
  monthly: z.number().min(0).optional(),
  alertThreshold: z.number().min(0).max(100).optional(),
  }).strict().optional(),
}).strict();

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
    // P1-FIX: Rate limit now enforced; catch rejection for 429 already sent
    try {
      await rateLimit('llm', 30, req, res);
    } catch (_e) {
      logger.warn('LLM rate limit exceeded', { route: req.url });
      return;
    }

    // P0-FIX: Fixed SQL aliases (double quotes for PG identifiers) + org_id filter
    let models: LlmModel[] = [];
    try {
    const result = await pool.query(
      `SELECT id, name, provider, capabilities, cost_per_1k_tokens as "costPer1kTokens",
          max_tokens as "maxTokens", available
      FROM llm_models
      WHERE available = true AND org_id = $1
      ORDER BY provider, name`,
      [ctx.orgId]
    );
    models = result.rows;
    } catch (dbError) {
    logger.error('[llm/models] Database error', dbError instanceof Error ? dbError : new Error(String(dbError)));
    // Return empty array if table doesn't exist or other DB error
    models = [];
    }

    return res.send({ models });
  } catch (error) {
    logger.error('[llm/models] Error', error instanceof Error ? error : new Error(String(error)));
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
    try {
      await rateLimit('llm', 30, req, res);
    } catch (_e) {
      logger.warn('LLM rate limit exceeded', { route: req.url });
      return;
    }

    const defaults: LlmPreferences = {
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

    let preferences = defaults;
    try {
    const { rows } = await pool.query(
      `SELECT preferences FROM org_llm_prefs WHERE org_id = $1`,
      [ctx.orgId]
    );
    if (rows.length > 0 && rows[0].preferences) {
      const stored = rows[0].preferences;
      preferences = { ...defaults, ...stored };
      if (stored.contentGeneration) {
      preferences.contentGeneration = { ...defaults.contentGeneration, ...stored.contentGeneration };
      }
      if (stored.imageGeneration) {
      preferences.imageGeneration = { ...defaults.imageGeneration, ...stored.imageGeneration };
      }
      if (stored.costLimits) {
      preferences.costLimits = { ...defaults.costLimits, ...stored.costLimits };
      }
    }
    } catch (dbError) {
    logger.error('[llm/preferences] Database error, using defaults', dbError instanceof Error ? dbError : new Error(String(dbError)));
    }

    return res.send(preferences);
  } catch (error) {
    logger.error('[llm/preferences] Error', error instanceof Error ? error : new Error(String(error)));
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
    try {
      await rateLimit('llm', 30, req, res);
    } catch (_e) {
      logger.warn('LLM rate limit exceeded', { route: req.url });
      return;
    }

    // Validate input
    const parseResult = UpdatePreferencesSchema.safeParse(req.body);
    if (!parseResult.success) {
    // P3-FIX: Sanitize validation error details
    return res.status(400).send({
    error: 'Validation failed',
    code: 'VALIDATION_ERROR',
    details: parseResult["error"].issues.map(i => ({ path: i.path, message: i.message }))
    });
    }

    const updates = parseResult.data;

    // P1-FIX: Actually persist preferences to database
    await pool.query(
    `INSERT INTO org_llm_prefs (org_id, preferences, updated_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (org_id) DO UPDATE SET preferences = $2, updated_at = NOW()`,
    [ctx.orgId, JSON.stringify(updates)]
    );

    // Sync budget to CostTracker for immediate enforcement
    if (updates.costLimits) {
    try {
      const container = getContainer();
      const monthly = updates.costLimits.monthly ?? 0;
      const daily = monthly > 0 ? monthly / 30 : 0;
      container.costTracker.setBudget(ctx.orgId, daily, monthly);
    } catch (syncErr) {
      logger.warn('[llm/preferences] Failed to sync budget to CostTracker', {
      error: syncErr instanceof Error ? syncErr.message : String(syncErr),
      });
    }
    }

    return res.send({ updated: true, preferences: updates });
  } catch (error) {
    logger.error('[llm/preferences] Update error', error instanceof Error ? error : new Error(String(error)));
    // FIX: Added return before reply.send()
    return res.status(500).send({ error: 'Failed to update LLM preferences' });
  }
  });
}
