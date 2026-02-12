

import { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { ContentStatus } from '../../../domains/content/domain/entities/ContentItem';
import { getAuthContext } from '../types';
import { getContentRepository } from '../../services/repository-factory';
import { ListContent } from '../../../domains/content/application/handlers/ListContent';
import { rateLimit } from '../../services/rate-limit';
import { requireRole } from '../../services/auth';

const VALID_STATUSES: ContentStatus[] = ['draft', 'scheduled', 'published', 'archived'];

const QuerySchema = z.object({
  status: z.enum(['draft', 'scheduled', 'published', 'archived']).default('draft'),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
  domainId: z.string().uuid().optional(),
});

export async function contentListRoutes(app: FastifyInstance) {
  app.get('/content', async (req, res) => {
  try {
    // SECURITY FIX: Rate limit BEFORE auth to prevent DoS
    await rateLimit('content', 50);
    const ctx = getAuthContext(req);
    requireRole(ctx, ['admin','editor','viewer']);

    const parseResult = QuerySchema.safeParse(req.query);
    if (!parseResult.success) {
    return res.status(400).send({
    error: 'Validation failed',
    code: 'VALIDATION_ERROR',
    details: parseResult["error"].issues
    });
    }

    const { status, limit, offset, domainId } = parseResult.data;

    const repo = getContentRepository('content');
    const handler = new ListContent(repo);

    // P0-4 FIX: Pass orgId to enforce multi-tenant isolation
    // Also pass domainId if provided for additional filtering
    const items = await handler.byStatus(
    status as ContentStatus,
    Number(limit),
    Number(offset),
    ctx.orgId,
    domainId,
    );

    // P0-6 FIX: Include items array in response (was previously discarded)
    return {
    success: true,
    items,
    pagination: {
    limit: Number(limit),
    offset: Number(offset),
    domainId: domainId || null
    }
    };
  } catch (error: unknown) {
    console["error"]('[content/list] Error:', error);
    const errorMessage = process.env['NODE_ENV'] === 'development' && error instanceof Error
    ? error.message
    : 'Failed to list content';
    return res.status(500).send({
    error: 'Failed to list content',
    code: 'INTERNAL_ERROR',
    ...(process.env['NODE_ENV'] === 'development' && { details: errorMessage })
    });
  }
  });
}
