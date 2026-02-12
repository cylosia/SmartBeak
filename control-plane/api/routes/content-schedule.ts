

import { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { getAuthContext } from '../types';
import { getContentRepository } from '../../services/repository-factory';
import { DomainOwnershipService } from '../../services/domain-ownership';
import { rateLimit } from '../../services/rate-limit';
import { requireRole } from '../../services/auth';
import { ScheduleContent } from '../../../domains/content/application/handlers/ScheduleContent';

const ParamsSchema = z.object({
  id: z.string().uuid(),
});

const BodySchema = z.object({
  publishAt: z.string().datetime(),
});

export async function contentScheduleRoutes(app: FastifyInstance) {
  app.post('/content/:id/schedule', async (req, res) => {
  try {
    // SECURITY FIX: Rate limit BEFORE auth to prevent DoS
    await rateLimit('content', 50);
    const ctx = getAuthContext(req);
    requireRole(ctx, ['admin','editor']);

    const paramsResult = ParamsSchema.safeParse(req.params);
    if (!paramsResult.success) {
    return res.status(400).send({
    error: 'Invalid content ID',
    code: 'INVALID_ID',
    });
    }

    const { id } = paramsResult.data;

    // Validate body
    const bodyResult = BodySchema.safeParse(req.body);
    if (!bodyResult.success) {
    return res.status(400).send({
    error: 'Validation failed',
    code: 'VALIDATION_ERROR',
    details: bodyResult["error"].issues
    });
    }

    const { publishAt } = bodyResult.data;
    const publishDate = new Date(publishAt);

    const repo = getContentRepository('content');

    // P0-5 FIX: Verify the authenticated user's org owns this content item
    // before allowing schedule. Previously any editor could schedule any org's content.
    const contentItem = await repo.getById(id);
    if (!contentItem) {
    return res.status(404).send({
    error: 'Content not found',
    code: 'CONTENT_NOT_FOUND',
    });
    }
    // Verify org owns the domain that owns this content
    if (contentItem.domainId) {
    const { getContainer } = await import('../../services/container');
    const ownership = new DomainOwnershipService(getContainer().db);
    await ownership.assertOrgOwnsDomain(ctx.orgId, contentItem.domainId);
    }

    const handler = new ScheduleContent(repo);
    const event = await handler.execute(id, publishDate);

    return {
    success: true,
    event: {
    ...event,
    scheduledAt: publishDate.toISOString(),
    }
    };
  } catch (error: unknown) {
    console["error"]('[content/schedule] Error:', error);
    return res.status(500).send({
    error: 'Failed to schedule content',
    code: 'INTERNAL_ERROR',
    });
  }
  });
}
