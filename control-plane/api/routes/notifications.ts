

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';

import { getLogger } from '@kernel/logger';
import { DB } from '@kernel/constants';
import { checkRateLimitAsync } from '../../services/rate-limit';
import { NotificationPreferenceService } from '../../../domains/notifications/application/NotificationPreferenceService';
import { PostgresNotificationPreferenceRepository } from '../../../domains/notifications/infra/persistence/PostgresNotificationPreferenceRepository';
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

const PREFERENCE_CHANNELS = ['email', 'sms', 'push', 'webhook'] as const;

const PreferenceBodySchema = z.object({
  channel: z.enum(PREFERENCE_CHANNELS),
  enabled: z.boolean(),
  frequency: z.enum(['immediate', 'daily', 'weekly']).optional(),
}).strict();

export type AuthenticatedRequest = FastifyRequest & {
  auth?: AuthContext | undefined;
};

/**
* Notification routes
*/
export async function notificationRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
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
    if (offset > DB.MAX_OFFSET) {
    return errors.badRequest(res, `Page depth exceeds maximum safe offset (${DB.MAX_OFFSET}). Use cursor-based pagination for deeper access.`);
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
    const totalRow = countResult.rows[0] as { total: string } | undefined;
    total = totalRow ? parseInt(totalRow.total, 10) : 0;

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
    page,
    limit,
    total,
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
    const result = await prefs.list(ctx.userId);
    if (!result.success) {
    return errors.internal(res, 'Failed to fetch preferences');
    }
    return res.send(result.preferences ?? []);
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
    const result = await prefs.set(ctx.userId, channel, enabled, frequency ?? 'immediate');
    // P1-FIX: Do not send the raw service result — it includes an `error` field with
    // internal details (DB messages, stack traces) when success=false.  Instead,
    // check the result and return a sanitised HTTP response.
    if (!result.success) {
    return errors.internal(res, 'Failed to update preferences');
    }
    // Map domain entity to a plain DTO — entities serialize private fields
    // (e.g., _enabled) which leaks naming conventions and confuses consumers.
    const pref = result.preference;
    return res.send(pref ? {
    id: pref.id,
    userId: pref.userId,
    channel: pref.channel,
    enabled: pref.isEnabled(),
    frequency: pref.frequency,
    } : null);
  } catch (error) {
    logger.error('[notifications/preferences] Update error', error instanceof Error ? error : new Error(String(error)));
    return errors.internal(res, 'Failed to update preferences');
  }
  });
}
