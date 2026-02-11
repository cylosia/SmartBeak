

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';

import { getLogger } from '../../../packages/kernel/logger';
import { checkRateLimitAsync } from '../../services/rate-limit';
import { NotificationPreferenceService } from '../../../domains/notifications/application/NotificationPreferenceService';
import { PostgresNotificationPreferenceRepository } from '../../../domains/notifications/infra/persistence/PostgresNotificationPreferenceRepository';
import { PostgresNotificationRepository } from '../../../domains/notifications/infra/persistence/PostgresNotificationRepository';
import { requireRole, AuthContext } from '../../services/auth';

const logger = getLogger('Notifications');

export interface Notification {
  id: string;
  channel: string;
  template: string;
  status: string;
  created_at: Date;
}

const PreferenceBodySchema = z.object({
  channel: z.string().min(1),
  enabled: z.boolean(),
  frequency: z.enum(['immediate', 'daily', 'weekly']).optional(),
});

export type AuthenticatedRequest = FastifyRequest & {
  auth?: AuthContext | undefined;
};

/**
* Notification routes
*/
export async function notificationRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  const repo = new PostgresNotificationRepository(pool);
  const prefRepo = new PostgresNotificationPreferenceRepository(pool);
  const prefs = new NotificationPreferenceService(prefRepo);

  app.get('/notifications', async (
  req: FastifyRequest,
  res: FastifyReply
  ): Promise<void> => {
  try {
    const { auth: ctx } = req as AuthenticatedRequest;
    if (!ctx) {
    return res.status(401).send({ error: 'Unauthorized' });
    }
    requireRole(ctx, ['owner', 'admin', 'editor', 'viewer']);
    const rateLimitResult = await checkRateLimitAsync(ctx.userId, 'notifications');
    if (!rateLimitResult.allowed) {
    return res.status(429).send({
    error: 'Rate limit exceeded',
    retryAfter: Math.ceil((rateLimitResult.resetTime - Date.now()) / 1000)
    });
    }

    // Parse pagination params
    const page = Math.max(1, parseInt((req.query as Record<string, string>)?.["page"] || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt((req.query as Record<string, string>)?.["limit"] || '50', 10)));
    const offset = (page - 1) * limit;

    let rows: Notification[];
    let total: number;

    try {
    // Start transaction to ensure consistency between count and fetch
    const client = await pool.connect();
    try {
    await client.query('BEGIN');
    await client.query('SET LOCAL statement_timeout = $1', [30000]); // 30 seconds

    // Add index hints for better performance
    const result = await client.query(
    `SELECT /*+ INDEX(notifications idx_notifications_user_created) */
        id, channel, template, status, created_at
    FROM notifications
    WHERE user_id = $1
    ORDER BY created_at DESC
    LIMIT $2 OFFSET $3`,
    [ctx.userId, limit, offset]
    );
    rows = result.rows;

    // Get total count within same transaction
    const countResult = await client.query(
    `SELECT /*+ INDEX(notifications idx_notifications_user) */ COUNT(*) as total
    FROM notifications WHERE user_id = $1`,
    [ctx.userId]
    );
    total = parseInt(countResult.rows[0].total, 10);

    await client.query('COMMIT');
    } catch (txError) {
    await client.query('ROLLBACK');
    throw txError;
    } finally {
    client.release();
    }
    } catch (dbError) {
    logger.error('[notifications] Database error:', dbError);
    res.status(503).send({
    error: 'Database temporarily unavailable',
    message: 'Unable to fetch notifications. Please try again later.'
    });
    return;
    }

    return res.send({
    data: rows,
    pagination: {
    totalPages: Math.ceil(total / limit),
    }
    });
  } catch (error) {
    logger.error('[notifications] Unexpected error:', error);
    // FIX: Added return before reply.send()
    return res.status(500).send({
    error: 'Internal server error',
    message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
  });

  app.get('/notifications/preferences', async (
  req: FastifyRequest,
  res: FastifyReply
  ): Promise<void> => {
  try {
    const { auth: ctx } = req as AuthenticatedRequest;
    if (!ctx) {
    return res.status(401).send({ error: 'Unauthorized' });
    }
    requireRole(ctx, ['owner', 'admin', 'editor', 'viewer']);
    const rateLimitResult2 = await checkRateLimitAsync(ctx.userId, 'notifications:preferences');
    if (!rateLimitResult2.allowed) {
    return res.status(429).send({
    error: 'Rate limit exceeded',
    retryAfter: Math.ceil((rateLimitResult2.resetTime - Date.now()) / 1000)
    });
    }
    const preferences = await prefs.list(ctx.userId);
    return res.send(preferences);
  } catch (error) {
    logger.error('[notifications/preferences] Error:', error);
    // FIX: Added return before reply.send()
    return res.status(500).send({
    error: 'Failed to fetch preferences',
    message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
  });

  app.post('/notifications/preferences', async (
  req: FastifyRequest,
  res: FastifyReply
  ): Promise<void> => {
  try {
    const { auth: ctx } = req as AuthenticatedRequest;
    if (!ctx) {
    return res.status(401).send({ error: 'Unauthorized' });
    }
    requireRole(ctx, ['owner', 'admin', 'editor', 'viewer']);
    const rateLimitResult3 = await checkRateLimitAsync(ctx.userId, 'notifications:preferences:update');
    if (!rateLimitResult3.allowed) {
    return res.status(429).send({
    error: 'Rate limit exceeded',
    retryAfter: Math.ceil((rateLimitResult3.resetTime - Date.now()) / 1000)
    });
    }

    // Validate body
    const bodyResult = PreferenceBodySchema.safeParse(req.body);
    if (!bodyResult.success) {
    res.status(400).send({
    error: 'Validation failed',
    code: 'VALIDATION_ERROR',
    details: bodyResult["error"].issues
    });
    return;
    }

    const { channel, enabled, frequency } = bodyResult.data;
    const result = await prefs.set(ctx.userId, channel, enabled, frequency!);
    return res.send(result);
  } catch (error) {
    logger.error('[notifications/preferences] Update error:', error);
    // FIX: Added return before reply.send()
    return res.status(500).send({
    error: 'Failed to update preferences',
    message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
  });
}
