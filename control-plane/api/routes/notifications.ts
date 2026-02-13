

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';

import { getLogger } from '../../../packages/kernel/logger';
import { checkRateLimitAsync } from '../../services/rate-limit';
import { NotificationPreferenceService } from '../../../domains/notifications/application/NotificationPreferenceService';
import { PostgresNotificationPreferenceRepository } from '../../../domains/notifications/infra/persistence/PostgresNotificationPreferenceRepository';
import { PostgresNotificationRepository } from '../../../domains/notifications/infra/persistence/PostgresNotificationRepository';
import { requireRole, AuthContext } from '../../services/auth';
import { errors } from '@errors/responses';

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
  const _repo = new PostgresNotificationRepository(pool);
  const prefRepo = new PostgresNotificationPreferenceRepository(pool);
  const prefs = new NotificationPreferenceService(prefRepo);

  app.get('/notifications', async (
  req: FastifyRequest,
  res: FastifyReply
  ): Promise<void> => {
  try {
    const { auth: ctx } = req as AuthenticatedRequest;
    if (!ctx) {
    return errors.unauthorized(res);
    }
    requireRole(ctx, ['owner', 'admin', 'editor', 'viewer']);
    const rateLimitResult = await checkRateLimitAsync(ctx.userId, 'notifications');
    if (!rateLimitResult.allowed) {
    return errors.rateLimited(res, Math.ceil((rateLimitResult.resetTime - Date.now()) / 1000));
    }

    // Parse pagination params
    const page = Math.max(1, parseInt((req.query as Record<string, string>)?.["page"] || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt((req.query as Record<string, string>)?.["limit"] || '50', 10)));
    const offset = (page - 1) * limit;

    // P2 FIX: Cap OFFSET to prevent deep-page O(n) table scans
    const MAX_SAFE_OFFSET = 10000;
    if (offset > MAX_SAFE_OFFSET) {
    return errors.badRequest(res, `Page depth exceeds maximum safe offset (${MAX_SAFE_OFFSET}). Use cursor-based pagination for deeper access.`);
    }

    let rows: Notification[];
    let total: number;

    try {
    // Start transaction to ensure consistency between count and fetch
    const client = await pool.connect();
    try {
    await client.query('BEGIN');
    await client.query('SET LOCAL statement_timeout = $1', [30000]); // 30 seconds

    // P2-FIX: Removed Oracle/MySQL-style hint comments (/*+ INDEX(...) */) that are
    // no-ops in PostgreSQL. Ensure proper indexes exist in migrations instead.
    const result = await client.query(
    `SELECT id, channel, template, status, created_at
    FROM notifications
    WHERE user_id = $1
    ORDER BY created_at DESC
    LIMIT $2 OFFSET $3`,
    [ctx.userId, limit, offset]
    );
    rows = result.rows;

    // Get total count within same transaction
    const countResult = await client.query(
    `SELECT COUNT(*) as total
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
    logger.error('[notifications] Database error', dbError instanceof Error ? dbError : new Error(String(dbError)));
    return errors.serviceUnavailable(res, 'Database temporarily unavailable');
    }

    return res.send({
    data: rows,
    pagination: {
    totalPages: Math.ceil(total / limit),
    }
    });
  } catch (error) {
    logger.error('[notifications] Unexpected error', error instanceof Error ? error : new Error(String(error)));
    // P1-FIX: Removed error.message leak to client
    return errors.internal(res);
  }
  });

  app.get('/notifications/preferences', async (
  req: FastifyRequest,
  res: FastifyReply
  ): Promise<void> => {
  try {
    const { auth: ctx } = req as AuthenticatedRequest;
    if (!ctx) {
    return errors.unauthorized(res);
    }
    requireRole(ctx, ['owner', 'admin', 'editor', 'viewer']);
    const rateLimitResult2 = await checkRateLimitAsync(ctx.userId, 'notifications:preferences');
    if (!rateLimitResult2.allowed) {
    return errors.rateLimited(res, Math.ceil((rateLimitResult2.resetTime - Date.now()) / 1000));
    }
    const preferences = await prefs.list(ctx.userId);
    return res.send(preferences);
  } catch (error) {
    logger.error('[notifications/preferences] Error', error instanceof Error ? error : new Error(String(error)));
    // P1-FIX: Removed error.message leak to client
    return errors.internal(res, 'Failed to fetch preferences');
  }
  });

  app.post('/notifications/preferences', async (
  req: FastifyRequest,
  res: FastifyReply
  ): Promise<void> => {
  try {
    const { auth: ctx } = req as AuthenticatedRequest;
    if (!ctx) {
    return errors.unauthorized(res);
    }
    requireRole(ctx, ['owner', 'admin', 'editor', 'viewer']);
    const rateLimitResult3 = await checkRateLimitAsync(ctx.userId, 'notifications:preferences:update');
    if (!rateLimitResult3.allowed) {
    return errors.rateLimited(res, Math.ceil((rateLimitResult3.resetTime - Date.now()) / 1000));
    }

    // Validate body
    const bodyResult = PreferenceBodySchema.safeParse(req.body);
    if (!bodyResult.success) {
    return errors.validationFailed(res, bodyResult["error"].issues);
    }

    const { channel, enabled, frequency } = bodyResult.data;
    // M2-FIX: Default frequency to 'immediate' instead of non-null assertion on optional field
    const result = await prefs.set(ctx.userId, channel, enabled, frequency ?? 'immediate');
    return res.send(result);
  } catch (error) {
    logger.error('[notifications/preferences] Update error', error instanceof Error ? error : new Error(String(error)));
    // P1-FIX: Removed error.message leak to client
    return errors.internal(res, 'Failed to update preferences');
  }
  });
}
