import { z } from 'zod';
import { FastifyInstance, FastifyRequest as FastifyRequestType, FastifyReply } from 'fastify';
import { csrfProtection } from '../middleware/csrf';
import { apiRateLimit } from '../middleware/rateLimiter';
import crypto from 'crypto';
import { Pool } from 'pg';
import { getLogger } from '../../../../packages/kernel/logger';


const logger = getLogger('PublishService');

const PublishIntentSchema = z.object({
  contentId: z.string().uuid(),
  idempotencyKey: z.string().uuid().optional(),
  targets: z.array(z.object({
    type: z.enum(['wordpress', 'web']),
    id: z.string(),
  })).min(1),
  scheduledAt: z.string().datetime().optional(),
});

class IdempotencyService {
  pool;
  constructor(pool: Pool) {
    this.pool = pool;
  }
  async checkOrCreate(idempotencyKey: string, operation: string, payload: unknown) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Check for existing intent
      const { rows } = await client.query(`SELECT result, status
    FROM idempotency_keys
    WHERE key = $1 AND operation = $2`, [idempotencyKey, operation]);
      if (rows.length > 0) {
        // Key exists - return cached result
        await client.query('COMMIT');
        return {
          isNew: false,
          existingResult: rows[0].result
        };
      }
      // Create new intent record
      await client.query(`INSERT INTO idempotency_keys (key, operation, payload, status, created_at)
    VALUES ($1, $2, $3, 'pending', NOW())`, [idempotencyKey, operation, JSON.stringify(payload)]);
      await client.query('COMMIT');
      return { isNew: true };
    }
    catch (error) {
      // CRITICAL FIX: Log rollback failures instead of silently ignoring
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        logger.error('Rollback failed', rollbackError as Error);
        
        // Chain errors for better debugging
        const originalMsg = error instanceof Error ? error.message : String(error);
        const rollbackMsg = rollbackError instanceof Error 
          ? rollbackError.message 
          : String(rollbackError);
        
        throw new Error(
          `Transaction failed: ${originalMsg}. ` +
          `Additionally, rollback failed: ${rollbackMsg}`
        );
      }
      throw error;
    }
    finally {
      client.release();
    }
  }
  async complete(idempotencyKey: string, operation: string, result: unknown) {
    await this.pool.query(`UPDATE idempotency_keys
    SET status = 'completed', result = $3, completed_at = NOW()
    WHERE key = $1 AND operation = $2`, [idempotencyKey, operation, JSON.stringify(result)]);
  }
  async fail(idempotencyKey: string, operation: string, error: string) {
    await this.pool.query(`UPDATE idempotency_keys
    SET status = 'failed', error = $3, failed_at = NOW()
    WHERE key = $1 AND operation = $2`, [idempotencyKey, operation, error]);
  }
}
export async function publishRoutes(app: FastifyInstance, pool: Pool) {
  const idempotencyService = new IdempotencyService(pool);

  app.post('/publish/intents', async (req, res) => {
    try {
      // Validate input
      let validated;
      try {
        validated = PublishIntentSchema.parse(req.body);
      }
      catch (error) {
        const zodError = error as z.ZodError;
        return res.status(400).send({
          error: 'Validation failed',
          details: zodError.issues,
        });
      }
      // Generate idempotency key if not provided
      const idempotencyKey = validated.idempotencyKey || crypto.randomUUID();
      // Check idempotency
      const { isNew, existingResult } = await idempotencyService.checkOrCreate(idempotencyKey, 'publish_intent', validated);
      if (!isNew) {
        // Return cached result
        return res.status(200).send({
          status: 'cached',
          idempotencyKey,
          result: existingResult,
        });
      }
      // Process new publish intent
      try {
        const result = {
          intentId: crypto.randomUUID(),
          contentId: validated.contentId,
          targets: validated.targets,
          status: 'queued',
          scheduledAt: validated.scheduledAt,
        };
        // Store result for idempotency
        await idempotencyService.complete(idempotencyKey, 'publish_intent', result);
        return res.status(202).send({
          idempotencyKey,
          ...result,
          status: 'queued',
        });
      }
      catch (error) {
        await idempotencyService.fail(idempotencyKey, 'publish_intent', (error as Error)["message"]);
        throw error;
      }
    }
    catch (error) {
      logger.error('Error creating publish intent', error as Error);
      return res.status(500).send({
        error: 'Failed to create publish intent',
        code: 'PUBLISH_FAILED',
      });
    }
  });
  // Get publish intent status
  app.get('/publish/intents/:id', async (req, res) => {
    try {
      const params = req.params as { id: string };
      const { id } = params;
      const { rows } = await pool.query(`SELECT key, status, result, error, created_at, completed_at
    FROM idempotency_keys
    WHERE key = $1`, [id]);
      if (rows.length === 0) {
        return res.status(404).send({ error: 'Intent not found' });
      }
      const row = rows[0];
      return res.send({
        idempotencyKey: row.key,
        status: row.status,
        result: row.result,
        error: row.error,
        createdAt: row.created_at,
        completedAt: row.completed_at,
      });
    }
    catch (error) {
      logger.error('Error retrieving publish intent', error as Error);
      res.status(500).send({ error: 'Failed to retrieve intent' });
    }
  });
}


export interface AuthenticatedFastifyRequest {
  user?: {
    id: string;
    orgId: string;
  };
}

export interface IntentRouteParams {
  Params: { id: string };
}

export type PublishIntent = z.infer<typeof PublishIntentSchema>;
