
import { FastifyInstance, FastifyRequest } from 'fastify';
import { Pool } from 'pg';

import { getLogger } from '@kernel/logger';
import { PostgresNotificationDLQRepository } from '../../../domains/notifications/infra/persistence/PostgresNotificationDLQRepository';
import { requireRole, type Role } from '../../services/auth';
import { NotificationAdminService } from '../../services/notification-admin';
import { rateLimit } from '../../services/rate-limit';
import { sanitizeErrorMessage } from '../../../packages/security/logger';
import { NotFoundError, ValidationError } from '@errors';
import { errors } from '@errors/responses';
import { isValidUUID } from '../../../packages/security/input-validator';

const logger = getLogger('NotificationsAdmin');

export interface AuthContext {
  userId: string;
  orgId: string;
  domainId?: string;
  roles: Role[];
}

export interface AuthenticatedRequest extends FastifyRequest {
  auth: AuthContext;
}

export async function notificationAdminRoutes(app: FastifyInstance, pool: Pool) {
  const admin = new NotificationAdminService(pool);
  const dlq = new PostgresNotificationDLQRepository(pool);

  app.get('/admin/notifications', async (req, res) => {
    try {
      const { auth: ctx } = req as AuthenticatedRequest;
      if (!ctx) {
        return errors.unauthorized(res);
      }
      requireRole(ctx, ['owner','admin']);

      // SECURITY FIX: Issue 3 - Add namespace prefix for rate limit key
      await rateLimit(`admin:notifications:${ctx["orgId"]}`, 40, 'admin');

      // SECURITY FIX: Issue 19 - Pass orgId to service method
      const result = await admin.listNotifications(ctx["orgId"]);
      return res.send(result);
    } catch (error) {
      // SECURITY FIX: Issue 22 - Sanitize error messages
      const sanitizedError = sanitizeErrorMessage(error instanceof Error ? error.message : 'Failed to retrieve notifications');
      logger.error(`[admin/notifications] Error: ${sanitizedError}`);
      return errors.internal(res, 'Failed to retrieve notifications');
    }
  });

  app.post('/admin/notifications/:id/retry', async (req, res) => {
    try {
      const { auth: ctx } = req as AuthenticatedRequest;
      if (!ctx) {
        return errors.unauthorized(res);
      }
      requireRole(ctx, ['owner','admin']);

      // SECURITY FIX: Issue 3 - Add namespace prefix for rate limit key
      await rateLimit(`admin:notifications:retry:${ctx["orgId"]}`, 30, 'admin');

      const { id } = req.params as { id: string };

      // SECURITY FIX: Issue 8 - Validate UUID format
      if (!isValidUUID(id)) {
        return errors.badRequest(res, 'Invalid notification ID format');
      }

      // SECURITY FIX: Issue 19 - Pass orgId for ownership verification
      const result = await admin.retry(id, ctx["orgId"]);
      return res.send(result);
    } catch (error) {
      logger.error('[admin/notifications/:id/retry] Error', error instanceof Error ? error : new Error(String(error)));

      if (error instanceof NotFoundError) {
        return errors.notFound(res, 'Notification');
      }
      if (error instanceof ValidationError) {
        return errors.badRequest(res, error.message);
      }

      return errors.internal(res, 'Failed to retry notification');
    }
  });

  app.get('/admin/notifications/dlq', async (req, res) => {
    try {
      const { auth: ctx } = req as AuthenticatedRequest;
      if (!ctx) {
        return errors.unauthorized(res);
      }
      requireRole(ctx, ['owner','admin']);

      // SECURITY FIX: Issue 3 - Add namespace prefix for rate limit key
      await rateLimit(`admin:notifications:dlq:${ctx["orgId"]}`, 40, 'admin');

      // P1-FIX: Removed unsafe `as unknown as number` double-cast that passed orgId string
      // as the limit parameter (causing NaN → PostgreSQL error). DLQ.list() now accepts orgId.
      const result = await dlq.list(ctx["orgId"]);
      return res.send(result);
    } catch (error) {
      // SECURITY FIX: Issue 22 - Sanitize error messages
      const sanitizedError = sanitizeErrorMessage(error instanceof Error ? error.message : 'Failed to retrieve DLQ');
      logger.error(`[admin/notifications/dlq] Error: ${sanitizedError}`);
      return errors.internal(res, 'Failed to retrieve DLQ');
    }
  });

  app.get('/admin/notifications/metrics', async (req, res) => {
    try {
      const { auth: ctx } = req as AuthenticatedRequest;
      if (!ctx) {
        return errors.unauthorized(res);
      }
      requireRole(ctx, ['owner','admin']);

      // SECURITY FIX: Issue 3 - Add namespace prefix for rate limit key
      await rateLimit(`admin:notifications:metrics:${ctx["orgId"]}`, 40, 'admin');

      // SECURITY FIX: Issue 19 - Pass orgId for scoped metrics
      const result = await admin.metrics(ctx["orgId"]);
      return res.send(result);
    } catch (error) {
      // SECURITY FIX: Issue 22 - Sanitize error messages
      const sanitizedError = sanitizeErrorMessage(error instanceof Error ? error.message : 'Failed to retrieve metrics');
      logger.error(`[admin/notifications/metrics] Error: ${sanitizedError}`);
      return errors.internal(res, 'Failed to retrieve metrics');
    }
  });

  // SECURITY FIX: Issue 19 - Add cancel endpoint with ownership check
  app.post('/admin/notifications/:id/cancel', async (req, res) => {
    try {
      const { auth: ctx } = req as AuthenticatedRequest;
      if (!ctx) {
        return errors.unauthorized(res);
      }
      requireRole(ctx, ['owner','admin']);

      // SECURITY FIX: Issue 3 - Add namespace prefix for rate limit key
      await rateLimit(`admin:notifications:cancel:${ctx["orgId"]}`, 30, 'admin');

      const { id } = req.params as { id: string };

      // SECURITY FIX: Issue 8 - Validate UUID format
      if (!isValidUUID(id)) {
        return errors.badRequest(res, 'Invalid notification ID format');
      }

      // SECURITY FIX: Issue 19 - Pass orgId for ownership verification
      const result = await admin.cancel(id, ctx["orgId"]);
      return res.send(result);
    } catch (error) {
      logger.error('[admin/notifications/:id/cancel] Error', error instanceof Error ? error : new Error(String(error)));

      if (error instanceof NotFoundError) {
        return errors.notFound(res, 'Notification');
      }
      if (error instanceof ValidationError) {
        return errors.badRequest(res, error.message);
      }

      return errors.internal(res, 'Failed to cancel notification');
    }
  });
}
