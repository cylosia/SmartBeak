

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';

import { getLogger } from '@kernel/logger';
import { rateLimit } from '../../services/rate-limit';
import { requireRole, AuthContext } from '../../services/auth';
import { errors } from '@errors/responses';
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

const ALLOWED_LLM_MODELS = [
  'gpt-4', 'gpt-4-turbo', 'gpt-4o', 'gpt-3.5-turbo',
  'claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku',
  'claude-opus-4-6', 'claude-sonnet-4-5-20250929',
] as const;

const ALLOWED_IMAGE_PROVIDERS = ['dall-e-3', 'dall-e-2', 'stable-diffusion'] as const;
const ALLOWED_IMAGE_SIZES = ['256x256', '512x512', '1024x1024', '1792x1024', '1024x1792'] as const;
const ALLOWED_IMAGE_QUALITIES = ['standard', 'hd'] as const;

const UpdatePreferencesSchema = z.object({
  defaultModel: z.enum(ALLOWED_LLM_MODELS).optional(),
  fallbackModel: z.enum(ALLOWED_LLM_MODELS).optional(),
  contentGeneration: z.object({
  model: z.enum(ALLOWED_LLM_MODELS).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(8000).optional(),
  }).strict().optional(),
  imageGeneration: z.object({
  provider: z.enum(ALLOWED_IMAGE_PROVIDERS).optional(),
  size: z.enum(ALLOWED_IMAGE_SIZES).optional(),
  quality: z.enum(ALLOWED_IMAGE_QUALITIES).optional(),
  }).strict().optional(),
  costLimits: z.object({
  monthly: z.number().min(0).optional(),
  alertThreshold: z.number().min(0).max(100).optional(),
  }).strict().optional(),
}).strict();

/** Schema used to validate stored JSONB preferences before merging with defaults */
const StoredPreferencesSchema = UpdatePreferencesSchema.partial();

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
    const { auth: ctx } = req as AuthenticatedRequest;
    if (!ctx) {
    return errors.unauthorized(res);
    }
    requireRole(ctx, ['owner', 'admin', 'editor', 'viewer']);
    rateLimit('llm', 30);

    // P0-FIX: Fixed SQL aliases (double quotes for PG identifiers) + org_id filter
    const result = await pool.query(
      `SELECT id, name, provider, capabilities, cost_per_1k_tokens as "costPer1kTokens",
          max_tokens as "maxTokens", available
      FROM llm_models
      WHERE available = true AND org_id = $1
      ORDER BY provider, name`,
      [ctx.orgId]
    );
    const models: LlmModel[] = result.rows;

    return res.send({ models });
  });

  // GET /llm/preferences - Get user's LLM preferences
  app.get('/llm/preferences', async (
  req: FastifyRequest,
  res: FastifyReply
  ): Promise<void> => {
    const { auth: ctx } = req as AuthenticatedRequest;
    if (!ctx) {
    return errors.unauthorized(res);
    }
    requireRole(ctx, ['owner', 'admin', 'editor']);
    rateLimit('llm', 30);

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
      const parseResult = StoredPreferencesSchema.safeParse(rows[0].preferences);
      if (!parseResult.success) {
        logger.warn('[llm/preferences] Stored preferences failed validation, using defaults', {
          issues: parseResult.error.issues.map(i => i.message),
        });
      } else {
        const stored = parseResult.data;
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
    }
    } catch (dbError) {
    logger.error('[llm/preferences] Database error, using defaults', dbError instanceof Error ? dbError : new Error(String(dbError)));
    }

    return res.send(preferences);
  });

  // POST /llm/preferences - Update LLM preferences
  app.post('/llm/preferences', async (
  req: FastifyRequest,
  res: FastifyReply
  ): Promise<void> => {
    const { auth: ctx } = req as AuthenticatedRequest;
    if (!ctx) {
    return errors.unauthorized(res);
    }
    requireRole(ctx, ['owner', 'admin']);
    rateLimit('llm', 30);

    // Validate input
    const parseResult = UpdatePreferencesSchema.safeParse(req.body);
    if (!parseResult.success) {
    // P3-FIX: Sanitize validation error details
    return errors.validationFailed(res, parseResult["error"].issues.map(i => ({ path: i.path, message: i.message })));
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
  });
}
