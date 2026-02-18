import { z } from 'zod';
import { FastifyInstance } from 'fastify';
import { requireAuthFastify } from '@security/auth';
import crypto from 'crypto';
import { Pool } from 'pg';
import { getLogger } from '@kernel/logger';
import { errors } from '@errors/responses';
import { ErrorCodes } from '@errors';


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
  async checkOrCreate(idempotencyKey: string, operation: string, payload: unknown, orgId: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Check for existing intent — scoped to the calling org (P0-FIX: IDOR prevention)
      const { rows } = await client.query(`SELECT result, status
    FROM idempotency_keys
    WHERE key = $1 AND operation = $2 AND org_id = $3`, [idempotencyKey, operation, orgId]);
      if (rows.length > 0) {
        // Key exists - return cached result
        await client.query('COMMIT');
        return {
          isNew: false,
          existingResult: rows[0].result
        };
      }
      // P0-FIX: Store org_id so GET /publish/intents/:id can enforce ownership
      await client.query(`INSERT INTO idempotency_keys (key, operation, payload, status, org_id, created_at)
    VALUES ($1, $2, $3, 'pending', $4, NOW())`, [idempotencyKey, operation, JSON.stringify(payload), orgId]);
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

  // SECURITY FIX: Add authentication - this route was previously unauthenticated
  app.addHook('preHandler', async (req, res) => {
    await requireAuthFastify(req, res);
  });

  app.post('/publish/intents', async (req, res) => {
    // SECURITY FIX: Verify request is authenticated (added preHandler hook above)
    if (!req.authContext) {
      return errors.unauthorized(res, 'Unauthorized. Bearer token required.');
    }

    try {
      // Validate input
      let validated;
      try {
        validated = PublishIntentSchema.parse(req.body);
      }
      catch (error) {
        const zodError = error as z.ZodError;
        return errors.validationFailed(res, zodError.issues);
      }
      // Generate idempotency key if not provided
      const idempotencyKey = validated.idempotencyKey || crypto.randomUUID();
      // Check idempotency — pass orgId for tenant scoping (P0-FIX: IDOR prevention)
      const orgId = req.authContext['orgId'] as string;
      const { isNew, existingResult } = await idempotencyService.checkOrCreate(idempotencyKey, 'publish_intent', validated, orgId);
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
      return errors.internal(res, 'Failed to create publish intent');
    }
  });
  // Get publish intent status
  app.get('/publish/intents/:id', async (req, res) => {
    // SECURITY FIX: Verify request is authenticated
    if (!req.authContext) {
      return errors.unauthorized(res, 'Unauthorized. Bearer token required.');
    }

    try {
      const params = req.params as { id: string };
      const { id } = params;
      const reqOrgId = req.authContext['orgId'] as string;
      // P0-FIX: Scope by org_id to prevent IDOR — without this any authenticated
      // user could read any organisation's publish intent by knowing its key.
      const { rows } = await pool.query(`SELECT key, status, result, error, created_at, completed_at
    FROM idempotency_keys
    WHERE key = $1 AND org_id = $2`, [id, reqOrgId]);
      if (rows.length === 0) {
        return errors.notFound(res, 'Intent', ErrorCodes.INTENT_NOT_FOUND);
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
      return errors.internal(res, 'Failed to retrieve intent');
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
