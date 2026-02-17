

import { FastifyInstance, FastifyRequest } from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';

import { getLogger } from '@kernel/logger';
import { PublishingCreateJobService } from '../../services/publishing-create-job';
import { rateLimit } from '../../services/rate-limit';
import { requireRole, RoleAccessError, type Role } from '../../services/auth';
import { NotFoundError } from '@errors';
import { errors, sendError } from '@errors/responses';

const logger = getLogger('publishing-create-job');

export async function publishingCreateJobRoutes(app: FastifyInstance, pool: Pool) {
  const svc = new PublishingCreateJobService(pool);

  const CreateJobSchema = z.object({
  contentId: z.string().uuid(),
  targetId: z.string().min(1).max(255),
  scheduleAt: z.string().datetime().optional(),
  });

  /**
  * Authenticated request interface
  */
  interface AuthenticatedRequest extends FastifyRequest {
  auth: {
    userId: string;
    orgId: string;
    domainId?: string;
    roles: Role[];
  };
  }

  app.post('/publishing/jobs', async (req, res) => {
  try {
    const { auth: ctx } = req as AuthenticatedRequest;
    if (!ctx) {
    return errors.unauthorized(res);
    }
    requireRole(ctx, ['owner','admin','editor']);
    await rateLimit('content', 50);

    // Validate input
    const parseResult = CreateJobSchema.safeParse(req.body);
    if (!parseResult.success) {
    return errors.validationFailed(res, parseResult["error"].issues);
    }

    const { contentId, targetId, scheduleAt } = parseResult.data;

    return svc.createJob({
    domainId: ctx["domainId"]!,
    contentId,
    targetId,
    ...(scheduleAt !== undefined && { scheduleAt }),
    });
  } catch (error) {
    if (error instanceof RoleAccessError) {
    return errors.forbidden(res);
    }
    if (error instanceof NotFoundError) {
    return sendError(res, 404, error.code, error.message);
    }
    logger.error('[publishing/jobs] Route error', error instanceof Error ? error : new Error(String(error)));
    return errors.internal(res);
  }
  });
}
