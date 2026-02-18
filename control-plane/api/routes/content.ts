


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

function hasErrorCode(err: unknown): err is { code: string } {
  return typeof err === 'object' && err !== null && 'code' in err &&
    typeof (err as Record<string, unknown>)['code'] === 'string';
}

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

  // Note: Body limit should be set when creating the Fastify instance in http.ts

  // GET /content - List content with filtering
  app.get('/content', async (req: FastifyRequest, res: FastifyReply) => {
  try {
    // P1-11 FIX: Rate limit BEFORE auth to prevent CPU exhaustion via JWT verification DDoS.
    // Previously auth (expensive JWT verify) ran before rate limit.
    await rateLimit('content', 50, req, res);
    const ctx = getAuthContext(req);
    requireRole(ctx, ['admin', 'editor', 'viewer']);

    // Validate orgId
    if (!ctx["orgId"]) {
    return errors.badRequest(res, 'Organization ID is required');
    }

    const orgIdResult = z.string().uuid().safeParse(ctx.orgId);
    if (!orgIdResult.success) {
    return errors.badRequest(res, 'Invalid organization ID');
    }

    // Validate query params
    const queryResult = ContentQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
    return errors.validationFailed(res, queryResult["error"].issues);
    }

    const { domainId, status, contentType, page, limit, search } = queryResult.data;
    const offset = (page - 1) * limit;

    // P2 FIX: Cap OFFSET to prevent deep-page O(n) table scans
    if (offset > DB.MAX_OFFSET) {
    return errors.badRequest(res, `Page depth exceeds maximum safe offset (${DB.MAX_OFFSET}). Use cursor-based pagination for deeper access.`);
    }

    // If domainId provided, verify ownership
    if (domainId) {
    const domainResult = await pool.query(
    'SELECT 1 FROM domains WHERE id = $1 AND org_id = $2',
    [domainId, ctx.orgId]
    );
    if (domainResult.rows.length === 0) {
    return errors.forbidden(res, 'Access denied to domain');
    }
    }

    // Build query
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
    // P1-SECURITY-FIX: Escape LIKE wildcards and use ESCAPE clause to prevent injection.
    // Escape special characters: \ (backslash), % (percent), _ (underscore)
    const escapedSearch = search
      .replace(/\\/g, '\\\\')   // Escape backslashes first
      .replace(/%/g, '\\%')     // Escape percent wildcards
      .replace(/_/g, '\\_');    // Escape underscore wildcards
    // PERFORMANCE: Only search `title` here.  Searching `body` (up to 50 KB per row)
    // with ILIKE '%...%' forces a full sequential scan because ILIKE cannot use a
    // B-tree index and there is no pg_trgm GIN index on the body column.
    // Add a GIN trgm index on body and re-enable body search once that migration lands.
    query += ` AND c.title ILIKE $${paramIndex} ESCAPE '\\'`;
    params.push(`%${escapedSearch}%`);
    paramIndex++;
    }

    // Snapshot paramIndex before the transaction so both queries use consistent indices
    const paginationStartIndex = paramIndex;
    const paginatedQuery =
      query + ` ORDER BY c.updated_at DESC LIMIT $${paginationStartIndex} OFFSET $${paginationStartIndex + 1}`;
    const paginatedParams = [...params, limit, offset];

    // Wrap COUNT and data fetch in one transaction for a consistent read
    const { rows, total } = await withTransaction(async (client) => {
      const countResult = await client.query(
        `SELECT COUNT(*) FROM (${query}) as count_query`,
        params  // P0-FIX: Pass params to count query to ensure tenant isolation
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
  } catch (error: unknown) {
    logger.error('[content] Internal error', error instanceof Error ? error : new Error(String(error)));
    return errors.internal(res);
  }
  });

  // POST /content - Create new content draft
  app.post('/content', async (req: FastifyRequest, res: FastifyReply) => {
  try {
    await rateLimit('content', 50, req, res);
    const ctx = getAuthContext(req);
    requireRole(ctx, ['admin', 'editor']);

    // Validate orgId
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

    // Verify org owns the domain
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
  } catch (error: unknown) {
    logger.error('[content] Internal error', error instanceof Error ? error : new Error(String(error)));
    if (hasErrorCode(error) && error.code === 'DOMAIN_NOT_OWNED') {
    return errors.forbidden(res, 'Domain not owned by organization', ErrorCodes.DOMAIN_NOT_OWNED);
    }
    if (hasErrorCode(error) && error.code === 'CONTENT_NOT_FOUND') {
    return errors.notFound(res, 'Content', ErrorCodes.CONTENT_NOT_FOUND);
    }
    return errors.internal(res);
  }
  });

  // GET /content/:id - Get specific content
  app.get('/content/:id', async (req: FastifyRequest, res: FastifyReply) => {
  try {
    await rateLimit('content', 50, req, res);
    const ctx = getAuthContext(req);
    requireRole(ctx, ['admin', 'editor', 'viewer']);

    // Validate params
    const paramsResult = ContentParamsSchema.safeParse(req.params);
    if (!paramsResult.success) {
    return errors.validationFailed(res, paramsResult["error"].issues);
    }
    const params = paramsResult.data;

    const repo = getContentRepository('content');

    // Get the item to verify domain ownership
    const item = await repo.getById(params.id);
    if (!item) {
    return errors.notFound(res, 'Content', ErrorCodes.CONTENT_NOT_FOUND);
    }

    await ownership.assertOrgOwnsDomain(ctx.orgId, item.domainId);

    return { success: true, item };
  } catch (error: unknown) {
    logger.error('[content] Internal error', error instanceof Error ? error : new Error(String(error)));
    if (hasErrorCode(error) && error.code === 'DOMAIN_NOT_OWNED') {
    return errors.forbidden(res, 'Domain not owned by organization', ErrorCodes.DOMAIN_NOT_OWNED);
    }
    if (hasErrorCode(error) && error.code === 'CONTENT_NOT_FOUND') {
    return errors.notFound(res, 'Content', ErrorCodes.CONTENT_NOT_FOUND);
    }
    return errors.internal(res);
  }
  });

  // PATCH /content/:id - Update content draft
  app.patch('/content/:id', async (req: FastifyRequest, res: FastifyReply) => {
  try {
    await rateLimit('content', 50, req, res);
    const ctx = getAuthContext(req);
    requireRole(ctx, ['admin', 'editor']);

    // Validate params
    const paramsResult = ContentParamsSchema.safeParse(req.params);
    if (!paramsResult.success) {
    return errors.validationFailed(res, paramsResult["error"].issues);
    }
    const params = paramsResult.data;

    // Validate body
    const bodyResult = UpdateContentSchema.safeParse(req.body);
    if (!bodyResult.success) {
    return errors.validationFailed(res, bodyResult["error"].issues);
    }
    const validated = bodyResult.data;

    const repo = getContentRepository('content');

    // Get the item to verify domain ownership
    const item = await repo.getById(params.id);
    if (!item) {
    return errors.notFound(res, 'Content', ErrorCodes.CONTENT_NOT_FOUND);
    }

    await ownership.assertOrgOwnsDomain(ctx.orgId, item.domainId);

    // Validate content state before updating (avoids second repo.getById in UpdateDraft handler)
    if (item['status'] !== 'draft' && item['status'] !== 'scheduled') {
    return errors.badRequest(res, `Cannot update content with status '${item['status']}'`);
    }

    // Apply update directly to avoid the double-fetch inside UpdateDraft.execute
    const updatedItem = item.updateDraft(
    validated.title ?? item.title,
    validated.body ?? item.body
    );
    await repo.save(updatedItem);

    return { success: true, item: updatedItem };
  } catch (error: unknown) {
    logger.error('[content] Internal error', error instanceof Error ? error : new Error(String(error)));
    if (hasErrorCode(error) && error.code === 'DOMAIN_NOT_OWNED') {
    return errors.forbidden(res, 'Domain not owned by organization', ErrorCodes.DOMAIN_NOT_OWNED);
    }
    if (hasErrorCode(error) && error.code === 'CONTENT_NOT_FOUND') {
    return errors.notFound(res, 'Content', ErrorCodes.CONTENT_NOT_FOUND);
    }
    return errors.internal(res);
  }
  });

  // POST /content/:id/publish - Publish content
  app.post('/content/:id/publish', async (req: FastifyRequest, res: FastifyReply) => {
  try {
    await rateLimit('content', 20, req, res);
    const ctx = getAuthContext(req);
    requireRole(ctx, ['admin', 'editor']);

    // Validate params
    const paramsResult = ContentParamsSchema.safeParse(req.params);
    if (!paramsResult.success) {
    return errors.validationFailed(res, paramsResult["error"].issues);
    }
    const params = paramsResult.data;

    const repo = getContentRepository('content');

    // Get the item to verify domain ownership
    const item = await repo.getById(params.id);
    if (!item) {
    return errors.notFound(res, 'Content', ErrorCodes.CONTENT_NOT_FOUND);
    }

    await ownership.assertOrgOwnsDomain(ctx.orgId, item.domainId);

    const handler = new PublishContent(repo);
    const event = await handler.execute(params.id);

    return { success: true, event };
  } catch (error: unknown) {
    logger.error('[content] Internal error', error instanceof Error ? error : new Error(String(error)));
    if (hasErrorCode(error) && error.code === 'DOMAIN_NOT_OWNED') {
    return errors.forbidden(res, 'Domain not owned by organization', ErrorCodes.DOMAIN_NOT_OWNED);
    }
    if (hasErrorCode(error) && error.code === 'CONTENT_NOT_FOUND') {
    return errors.notFound(res, 'Content', ErrorCodes.CONTENT_NOT_FOUND);
    }
    return errors.internal(res);
  }
  });

  // DELETE /content/:id - Delete content (soft delete)
  app.delete('/content/:id', async (req: FastifyRequest, res: FastifyReply) => {
  try {
    await rateLimit('content', 20, req, res);
    const ctx = getAuthContext(req);
    requireRole(ctx, ['admin']);

    // Validate params
    const paramsResult = ContentParamsSchema.safeParse(req.params);
    if (!paramsResult.success) {
    return errors.validationFailed(res, paramsResult["error"].issues);
    }
    const params = paramsResult.data;

    const repo = getContentRepository('content');

    // Get the item to verify domain ownership
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

    // P1-FIX: If the domain was transferred between the ownership check and the UPDATE,
    // rowCount will be 0. Return a clear error instead of silently reporting success.
    if ((rowCount ?? 0) === 0) {
    logger.warn('[content] Soft delete affected 0 rows — possible TOCTOU domain transfer', { id: params.id, orgId: ctx.orgId });
    return errors.notFound(res, 'Content', ErrorCodes.CONTENT_NOT_FOUND);
    }

    return { success: true, id: params.id, deleted: true };
  } catch (error: unknown) {
    logger.error('[content] Internal error', error instanceof Error ? error : new Error(String(error)));
    if (hasErrorCode(error) && error.code === 'DOMAIN_NOT_OWNED') {
    return errors.forbidden(res, 'Domain not owned by organization', ErrorCodes.DOMAIN_NOT_OWNED);
    }
    if (hasErrorCode(error) && error.code === 'CONTENT_NOT_FOUND') {
    return errors.notFound(res, 'Content', ErrorCodes.CONTENT_NOT_FOUND);
    }
    return errors.internal(res);
  }
  });
}
