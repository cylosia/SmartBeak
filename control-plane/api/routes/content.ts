


import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';
import crypto from 'crypto';

import { getLogger } from '@kernel/logger';
import { DB } from '@kernel/constants';
import { errors } from '@errors/responses';
import { ErrorCodes } from '@errors';
import { withTransaction } from '@database';

const logger = getLogger('content');

import { CreateDraft } from '../../../domains/content/application/handlers/CreateDraft';
import { DomainOwnershipService } from '../../services/domain-ownership';
import { getContentRepository } from '../../services/repository-factory';
import { PublishContent } from '../../../domains/content/application/handlers/PublishContent';
import { rateLimit } from '../../services/rate-limit';
import { requireRole } from '../../services/auth';
import { getAuthContext } from '../types';

const CreateContentSchema = z.object({
  domainId: z.string().uuid('Domain ID must be a valid UUID'),
  title: z.string().min(1, 'Title is required').max(500, 'Title must be 500 characters or less'),
  body: z.string().max(50000, 'Body must be 50KB or less').optional(), // 50KB max
  contentType: z.enum(['article', 'page', 'product', 'review', 'guide', 'post', 'video', 'image']).default('article'),
  excerpt: z.string().max(500, 'Excerpt must be 500 characters or less').optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
});

const UpdateContentSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  body: z.string().max(50000).optional(),
  excerpt: z.string().max(500).optional(),
  contentType: z.enum(['article', 'page', 'product', 'review', 'guide', 'post', 'video', 'image']).optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
}).refine(
  (data) => Object.keys(data).length > 0,
  { message: 'At least one field must be provided for update' }
);

const ContentParamsSchema = z.object({
  id: z.string().uuid('Content ID must be a valid UUID'),
});

const ContentQuerySchema = z.object({
  domainId: z.string().uuid().optional(),
  status: z.enum(['draft', 'published', 'archived', 'all']).optional().default('all'),
  contentType: z.enum(['article', 'page', 'product', 'review', 'guide', 'post', 'video', 'image']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(200).optional(),
});

export async function contentRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  const ownership = new DomainOwnershipService(pool);

  // GET /content - List content with filtering
  app.get('/content', async (req: FastifyRequest, res: FastifyReply) => {
    rateLimit('content', 50);
    const ctx = getAuthContext(req);
    requireRole(ctx, ['admin', 'editor', 'viewer']);

    if (!ctx["orgId"]) {
    return errors.badRequest(res, 'Organization ID is required');
    }

    const orgIdResult = z.string().uuid().safeParse(ctx.orgId);
    if (!orgIdResult.success) {
    return errors.badRequest(res, 'Invalid organization ID');
    }

    const queryResult = ContentQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
    return errors.validationFailed(res, queryResult["error"].issues);
    }

    const { domainId, status, contentType, page, limit, search } = queryResult.data;
    const offset = (page - 1) * limit;

    if (offset > DB.MAX_OFFSET) {
    return errors.badRequest(res, `Page depth exceeds maximum safe offset (${DB.MAX_OFFSET}). Use cursor-based pagination for deeper access.`);
    }

    if (domainId) {
    const domainResult = await pool.query(
    'SELECT 1 FROM domains WHERE id = $1 AND org_id = $2',
    [domainId, ctx.orgId]
    );
    if (domainResult.rows.length === 0) {
    return errors.forbidden(res, 'Access denied to domain');
    }
    }

    // C4-FIX: Changed table name from 'content' to 'content_items' to match migration schema
    let query = `
    SELECT c.id, c.title, c.status, c.content_type, c.domain_id,
        c.created_at, c.updated_at, c.published_at,
        d.name as domain_name
    FROM content_items c
    LEFT JOIN domains d ON c.domain_id = d.id
    WHERE d.org_id = $1
    `;
    const params: unknown[] = [ctx.orgId];
    let paramIndex = 2;

    if (domainId) {
    query += ` AND c.domain_id = $${paramIndex++}`;
    params.push(domainId);
    }

    if (status && status !== 'all') {
    query += ` AND c.status = $${paramIndex++}`;
    params.push(status);
    }

    if (contentType) {
    query += ` AND c.content_type = $${paramIndex++}`;
    params.push(contentType);
    }

    if (search) {
    const escapedSearch = search
      .replace(/\\/g, '\\\\')
      .replace(/%/g, '\\%')
      .replace(/_/g, '\\_');
    query += ` AND c.title ILIKE $${paramIndex} ESCAPE '\\'`;
    params.push(`%${escapedSearch}%`);
    paramIndex++;
    }

    const paginationStartIndex = paramIndex;
    const paginatedQuery =
      query + ` ORDER BY c.updated_at DESC LIMIT $${paginationStartIndex} OFFSET $${paginationStartIndex + 1}`;
    const paginatedParams = [...params, limit, offset];

    const { rows, total } = await withTransaction(async (client) => {
      const countResult = await client.query(
        `SELECT COUNT(*) FROM (${query}) as count_query`,
        params
      );
      const countRow = countResult.rows[0] as { count: string } | undefined;
      const innerTotal = countRow ? parseInt(countRow.count, 10) : 0;

      const { rows: dataRows } = await client.query(paginatedQuery, paginatedParams);
      return { rows: dataRows, total: innerTotal };
    });

    return {
    data: rows.map(row => ({
    id: row.id,
    title: row.title,
    status: row.status,
    contentType: row.content_type,
    domainId: row.domain_id,
    domainName: row.domain_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
    })),
    pagination: {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
    }
    };
  });

  // POST /content - Create new content draft
  app.post('/content', async (req: FastifyRequest, res: FastifyReply) => {
    rateLimit('content', 50);
    const ctx = getAuthContext(req);
    requireRole(ctx, ['admin', 'editor']);

    if (!ctx["orgId"]) {
    return errors.badRequest(res, 'Organization ID is required');
    }

    const orgIdResult = z.string().uuid().safeParse(ctx.orgId);
    if (!orgIdResult.success) {
    return errors.badRequest(res, 'Invalid organization ID');
    }

    const bodyResult = CreateContentSchema.safeParse(req.body);
    if (!bodyResult.success) {
    return errors.validationFailed(res, bodyResult["error"].issues);
    }
    const validated = bodyResult.data;

    await ownership.assertOrgOwnsDomain(ctx.orgId, validated.domainId);

    const repo = getContentRepository('content');
    const handler = new CreateDraft(repo);

    const item = await handler.execute(
    crypto.randomUUID(),
    validated.domainId,
    validated.title,
    validated.body,
    validated.contentType
    );
    return { success: true, item };
  });

  // GET /content/:id - Get specific content
  app.get('/content/:id', async (req: FastifyRequest, res: FastifyReply) => {
    rateLimit('content', 50);
    const ctx = getAuthContext(req);
    requireRole(ctx, ['admin', 'editor', 'viewer']);

    const paramsResult = ContentParamsSchema.safeParse(req.params);
    if (!paramsResult.success) {
    return errors.validationFailed(res, paramsResult["error"].issues);
    }
    const params = paramsResult.data;

    const repo = getContentRepository('content');

    const item = await repo.getById(params.id);
    if (!item) {
    return errors.notFound(res, 'Content', ErrorCodes.CONTENT_NOT_FOUND);
    }

    await ownership.assertOrgOwnsDomain(ctx.orgId, item.domainId);

    return { success: true, item };
  });

  // PATCH /content/:id - Update content draft
  app.patch('/content/:id', async (req: FastifyRequest, res: FastifyReply) => {
    rateLimit('content', 50);
    const ctx = getAuthContext(req);
    requireRole(ctx, ['admin', 'editor']);

    const paramsResult = ContentParamsSchema.safeParse(req.params);
    if (!paramsResult.success) {
    return errors.validationFailed(res, paramsResult["error"].issues);
    }
    const params = paramsResult.data;

    const bodyResult = UpdateContentSchema.safeParse(req.body);
    if (!bodyResult.success) {
    return errors.validationFailed(res, bodyResult["error"].issues);
    }
    const validated = bodyResult.data;

    const repo = getContentRepository('content');

    const item = await repo.getById(params.id);
    if (!item) {
    return errors.notFound(res, 'Content', ErrorCodes.CONTENT_NOT_FOUND);
    }

    await ownership.assertOrgOwnsDomain(ctx.orgId, item.domainId);

    if (item['status'] !== 'draft' && item['status'] !== 'scheduled') {
    return errors.badRequest(res, `Cannot update content with status '${item['status']}'`);
    }

    const updatedItem = item.updateDraft(
    validated.title ?? item.title,
    validated.body ?? item.body
    );
    await repo.save(updatedItem);

    return { success: true, item: updatedItem };
  });

  // POST /content/:id/publish - Publish content
  app.post('/content/:id/publish', async (req: FastifyRequest, res: FastifyReply) => {
    rateLimit('content', 20);
    const ctx = getAuthContext(req);
    requireRole(ctx, ['admin', 'editor']);

    const paramsResult = ContentParamsSchema.safeParse(req.params);
    if (!paramsResult.success) {
    return errors.validationFailed(res, paramsResult["error"].issues);
    }
    const params = paramsResult.data;

    const repo = getContentRepository('content');

    const item = await repo.getById(params.id);
    if (!item) {
    return errors.notFound(res, 'Content', ErrorCodes.CONTENT_NOT_FOUND);
    }

    await ownership.assertOrgOwnsDomain(ctx.orgId, item.domainId);

    const handler = new PublishContent(repo);
    const event = await handler.execute(params.id);

    return { success: true, event };
  });

  // DELETE /content/:id - Delete content (soft delete)
  app.delete('/content/:id', async (req: FastifyRequest, res: FastifyReply) => {
    rateLimit('content', 20);
    const ctx = getAuthContext(req);
    requireRole(ctx, ['admin']);

    const paramsResult = ContentParamsSchema.safeParse(req.params);
    if (!paramsResult.success) {
    return errors.validationFailed(res, paramsResult["error"].issues);
    }
    const params = paramsResult.data;

    const repo = getContentRepository('content');

    const item = await repo.getById(params.id);
    if (!item) {
    return errors.notFound(res, 'Content', ErrorCodes.CONTENT_NOT_FOUND);
    }

    await ownership.assertOrgOwnsDomain(ctx.orgId, item.domainId);

    // Soft delete — anchor to org_id to prevent cross-org TOCTOU after ownership check
    const { rowCount } = await pool.query(
    `UPDATE content_items SET status = $1, archived_at = NOW(), updated_at = NOW()
    WHERE id = $2 AND domain_id IN (SELECT id FROM domains WHERE org_id = $3)`,
    ['archived', params.id, ctx.orgId]
    );

    if ((rowCount ?? 0) === 0) {
    logger.warn('[content] Soft delete affected 0 rows — possible TOCTOU domain transfer', { id: params.id, orgId: ctx.orgId });
    return errors.notFound(res, 'Content', ErrorCodes.CONTENT_NOT_FOUND);
    }

    return { success: true, id: params.id, deleted: true };
  });
}
