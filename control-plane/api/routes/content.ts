


import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';
import crypto from 'crypto';

import { getLogger } from '@kernel/logger';

const logger = getLogger('content');

import { CreateDraft } from '../../../domains/content/application/handlers/CreateDraft';
import { DomainOwnershipService } from '../../services/domain-ownership';
import { getContentRepository } from '../../services/repository-factory';
import { PublishContent } from '../../../domains/content/application/handlers/PublishContent';
import { rateLimit } from '../../services/rate-limit';
import { requireRole, AuthContext } from '../../services/auth';
import { UpdateDraft } from '../../../domains/content/application/handlers/UpdateDraft';

const CreateContentSchema = z.object({
  id: z.string().uuid().default(() => crypto.randomUUID()),
  domainId: z.string().uuid('Domain ID must be a valid UUID'),
  title: z.string().min(1, 'Title is required').max(500, 'Title must be 500 characters or less'),
  body: z.string().max(50000, 'Body must be 50KB or less').optional(), // 50KB max
  contentType: z.enum(['article', 'page', 'product', 'review', 'guide', 'post', 'video', 'image']).default('article'),
  excerpt: z.string().max(500, 'Excerpt must be 500 characters or less').optional(),
  status: z.enum(['draft', 'published', 'archived']).default('draft'),
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

export interface ErrorWithCode extends Error {
  code?: string;
}

export interface ZodError extends Error {
  issues?: Array<{ path: (string | number)[]; message: string; code: string }>;
}

function sanitizeErrorForClient(error: unknown): { error: string; code?: string } {
  // Log full error server-side
  const errorToLog = error instanceof Error ? error : new Error(String(error));
  logger["error"]('[content] Internal error:', errorToLog);

  // Return safe message to client
  const errWithCode = error as { code?: string; name?: string };
  if (errWithCode.code === 'DOMAIN_NOT_OWNED') {
  return { error: 'Domain not owned by organization', code: 'DOMAIN_NOT_OWNED' };
  }
  if (errWithCode.code === 'CONTENT_NOT_FOUND') {
  return { error: 'Content not found', code: 'CONTENT_NOT_FOUND' };
  }
  if (errWithCode.name === 'ZodError') {
  return { error: 'Invalid input data', code: 'VALIDATION_ERROR' };
  }

  // Generic message for all other errors (prevents info leakage)
  return { error: 'An error occurred processing your request', code: 'INTERNAL_ERROR' };
}

export async function contentRoutes(app: FastifyInstance, pool: Pool) {
  const ownership = new DomainOwnershipService(pool);

  // Note: Body limit should be set when creating the Fastify instance in http.ts

  // GET /content - List content with filtering
  app.get('/content', async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const ctx = (req as unknown as { auth: { orgId: string; userId: string; role: string } }).auth;
    if (!ctx) {
    return res.status(401).send({ error: 'Unauthorized' });
    }
    requireRole(ctx as AuthContext, ['admin', 'editor', 'viewer']);
    await rateLimit('content', 50, req, res);

    // Validate orgId
    if (!ctx?.["orgId"]) {
    return res.status(400).send({ error: 'Organization ID is required' });
    }

    const orgIdResult = z.string().uuid().safeParse(ctx["orgId"]);
    if (!orgIdResult.success) {
    return res.status(400).send({
    error: 'Invalid organization ID',
    code: 'VALIDATION_ERROR',
    });
    }

    // Validate query params
    const queryResult = ContentQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
    return res.status(400).send({
    error: 'Invalid query parameters',
    code: 'VALIDATION_ERROR',
    details: queryResult["error"].issues,
    });
    }

    const { domainId, status, contentType, page, limit, search } = queryResult.data;
    const offset = (page - 1) * limit;

    // If domainId provided, verify ownership
    if (domainId) {
    const domainResult = await pool.query(
    'SELECT 1 FROM domains WHERE id = $1 AND org_id = $2',
    [domainId, ctx["orgId"]]
    );
    if (domainResult.rows.length === 0) {
    return res.status(403).send({ error: 'Access denied to domain' });
    }
    }

    // Build query
    // C4-FIX: Changed table name from 'content' to 'content_items' to match migration schema
    let query = `
    SELECT c["id"], c.title, c.status, c.content_type, c.domain_id,
        c.created_at, c.updated_at,
        d.name as domain_name
    FROM content_items c
    LEFT JOIN domains d ON c.domain_id = d["id"]
    WHERE d.org_id = $1
    `;
    const params: unknown[] = [ctx["orgId"]];
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
    // P1-SECURITY-FIX: Escape LIKE wildcards and use ESCAPE clause to prevent injection
    // Escape special characters: \ (backslash), % (percent), _ (underscore)
    const escapedSearch = search
      .replace(/\\/g, '\\\\')   // Escape backslashes first
      .replace(/%/g, '\\%')     // Escape percent wildcards  
      .replace(/_/g, '\\_');    // Escape underscore wildcards
    query += ` AND (c.title ILIKE $${paramIndex} ESCAPE '\\' OR c.body ILIKE $${paramIndex} ESCAPE '\\')`;
    params.push(`%${escapedSearch}%`);
    paramIndex++;
    }

    // Get total count
    const countResult = await pool.query(
    `SELECT COUNT(*) FROM (${query}) as count_query`,
    params  // P0-FIX: Pass params to count query to ensure tenant isolation
    );
    const total = parseInt(countResult.rows[0].count, 10);

    // Add pagination
    query += ` ORDER BY c.updated_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(limit, offset);

    const { rows } = await pool.query(query, params);

    return {
    data: rows.map(row => ({
    id: row["id"],
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
    totalPages: Math.ceil(total / limit),
    }
    };
  } catch (error: unknown) {
    const { error: message, code } = sanitizeErrorForClient(error);
    return res.status(500).send({ error: message, code });
  }
  });

  // POST /content - Create new content draft
  app.post('/content', async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const ctx = (req as unknown as { auth: { orgId: string; userId: string; role: string } }).auth;
    if (!ctx) {
    return res.status(401).send({ error: 'Unauthorized' });
    }
    requireRole(ctx as AuthContext, ['admin','editor']);
    await rateLimit('content', 50, req, res);

    // Validate orgId
    if (!ctx?.["orgId"]) {
    return res.status(400).send({ error: 'Organization ID is required' });
    }

    const orgIdResult = z.string().uuid().safeParse(ctx["orgId"]);
    if (!orgIdResult.success) {
    return res.status(400).send({
    error: 'Invalid organization ID',
    code: 'VALIDATION_ERROR',
    });
    }

    let validated;
    try {
    validated = CreateContentSchema.parse(req.body);
    } catch (validationError: unknown) {
    const zodError = validationError as ZodError;
    return res.status(400).send({
    error: 'Validation failed',
    code: 'VALIDATION_ERROR',
    details: zodError.issues?.map((e) => ({
    path: e.path,
    message: e.message,
    code: e.code
    }))
    });
    }

    // Verify org owns the domain
    await ownership.assertOrgOwnsDomain(ctx["orgId"], validated["domainId"]);

    const repo = getContentRepository('content');
    const handler = new CreateDraft(repo);

    const item = await handler.execute(
    validated["id"],
    validated["domainId"],
    validated.title,
    validated.body,
    validated.contentType
    );
    return { success: true, item };
  } catch (error: unknown) {
    const { error: message, code } = sanitizeErrorForClient(error);
    const status = code === 'DOMAIN_NOT_OWNED' ? 403 : code === 'CONTENT_NOT_FOUND' ? 404 : 500;
    return res.status(status).send({ error: message, code });
  }
  });

  // GET /content/:id - Get specific content
  app.get('/content/:id', async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const ctx = (req as unknown as { auth: { orgId: string; userId: string; role: string } }).auth;
    if (!ctx) {
    return res.status(401).send({ error: 'Unauthorized' });
    }
    requireRole(ctx as AuthContext, ['admin', 'editor', 'viewer']);
    await rateLimit('content', 50, req, res);

    // Validate params
    let params;
    try {
    params = ContentParamsSchema.parse(req.params);
    } catch (validationError: unknown) {
    const zodError = validationError as ZodError;
    return res.status(400).send({
    error: 'Validation failed',
    code: 'VALIDATION_ERROR',
    details: zodError.issues?.map((e) => ({
    path: e.path,
    message: e.message,
    code: e.code
    }))
    });
    }

    const repo = getContentRepository('content');

    // Get the item to verify domain ownership
    const item = await repo.getById(params["id"]);
    if (!item) {
    return res.status(404).send({ error: 'Content not found', code: 'CONTENT_NOT_FOUND' });
    }

    await ownership.assertOrgOwnsDomain(ctx["orgId"], item["domainId"]);

    return { success: true, item };
  } catch (error: unknown) {
    const { error: message, code } = sanitizeErrorForClient(error);
    const status = code === 'DOMAIN_NOT_OWNED' ? 403 : code === 'CONTENT_NOT_FOUND' ? 404 : 500;
    return res.status(status).send({ error: message, code });
  }
  });

  // PATCH /content/:id - Update content draft
  app.patch('/content/:id', async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const ctx = (req as unknown as { auth: { orgId: string; userId: string; role: string } }).auth;
    if (!ctx) {
    return res.status(401).send({ error: 'Unauthorized' });
    }
    requireRole(ctx as AuthContext, ['admin','editor']);
    await rateLimit('content', 50, req, res);

    // Validate params
    let params;
    try {
    params = ContentParamsSchema.parse(req.params);
    } catch (validationError: unknown) {
    const zodError = validationError as ZodError;
    return res.status(400).send({
    error: 'Validation failed',
    code: 'VALIDATION_ERROR',
    details: zodError.issues?.map((e) => ({
    path: e.path,
    message: e.message,
    code: e.code
    }))
    });
    }

    // Validate body
    let validated;
    try {
    validated = UpdateContentSchema.parse(req.body);
    } catch (validationError: unknown) {
    const zodError = validationError as ZodError;
    return res.status(400).send({
    error: 'Validation failed',
    code: 'VALIDATION_ERROR',
    details: zodError.issues?.map((e) => ({
    path: e.path,
    message: e.message,
    code: e.code
    }))
    });
    }

    const repo = getContentRepository('content');

    // Get the item to verify domain ownership
    const item = await repo.getById(params["id"]);
    if (!item) {
    return res.status(404).send({ error: 'Content not found', code: 'CONTENT_NOT_FOUND' });
    }

    await ownership.assertOrgOwnsDomain(ctx["orgId"], item["domainId"]);

    // H12-FIX: Pass title and body from validated input, preserving existing values if not provided
    const handler = new UpdateDraft(repo);
    const updated = await handler.execute(
    params["id"],
    validated.title ?? item.title ?? '',
    validated.body ?? item.body ?? ''
    );

    return { success: true, item: updated };
  } catch (error: unknown) {
    const { error: message, code } = sanitizeErrorForClient(error);
    const status = code === 'DOMAIN_NOT_OWNED' ? 403 : code === 'CONTENT_NOT_FOUND' ? 404 : 500;
    return res.status(status).send({ error: message, code });
  }
  });

  // POST /content/:id/publish - Publish content
  app.post('/content/:id/publish', async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const ctx = (req as unknown as { auth: { orgId: string; userId: string; role: string } }).auth;
    if (!ctx) {
    return res.status(401).send({ error: 'Unauthorized' });
    }
    requireRole(ctx as AuthContext, ['admin','editor']);
    await rateLimit('content', 20, req, res);

    // Validate params
    let params;
    try {
    params = ContentParamsSchema.parse(req.params);
    } catch (validationError: unknown) {
    const zodError = validationError as ZodError;
    return res.status(400).send({
    error: 'Validation failed',
    code: 'VALIDATION_ERROR',
    details: zodError.issues?.map((e) => ({
    path: e.path,
    message: e.message,
    code: e.code
    }))
    });
    }

    const repo = getContentRepository('content');

    // Get the item to verify domain ownership
    const item = await repo.getById(params["id"]);
    if (!item) {
    return res.status(404).send({ error: 'Content not found', code: 'CONTENT_NOT_FOUND' });
    }

    await ownership.assertOrgOwnsDomain(ctx["orgId"], item["domainId"]);

    const handler = new PublishContent(repo);
    const event = await handler.execute(params["id"]);

    return { success: true, event };
  } catch (error: unknown) {
    const { error: message, code } = sanitizeErrorForClient(error);
    const status = code === 'DOMAIN_NOT_OWNED' ? 403 : code === 'CONTENT_NOT_FOUND' ? 404 : 500;
    return res.status(status).send({ error: message, code });
  }
  });

  // DELETE /content/:id - Delete content (soft delete)
  app.delete('/content/:id', async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const ctx = (req as unknown as { auth: { orgId: string; userId: string; role: string } }).auth;
    if (!ctx) {
    return res.status(401).send({ error: 'Unauthorized' });
    }
    requireRole(ctx as AuthContext, ['admin']);
    await rateLimit('content', 20, req, res);

    // Validate params
    let params;
    try {
    params = ContentParamsSchema.parse(req.params);
    } catch (validationError: unknown) {
    const zodError = validationError as ZodError;
    return res.status(400).send({
    error: 'Validation failed',
    code: 'VALIDATION_ERROR',
    details: zodError.issues?.map((e) => ({
    path: e.path,
    message: e.message,
    code: e.code
    }))
    });
    }

    const repo = getContentRepository('content');

    // Get the item to verify domain ownership
    const item = await repo.getById(params["id"]);
    if (!item) {
    return res.status(404).send({ error: 'Content not found', code: 'CONTENT_NOT_FOUND' });
    }

    await ownership.assertOrgOwnsDomain(ctx["orgId"], item["domainId"]);

    // Soft delete
    // C4-FIX: Changed table 'content' to 'content_items' and 'deleted_at' to 'archived_at' to match migration schema
    await pool.query(
    'UPDATE content_items SET status = $1, archived_at = NOW(), updated_at = NOW() WHERE id = $2',
    ['archived', params["id"]]
    );

    return { success: true, id: params["id"], deleted: true };
  } catch (error: unknown) {
    const { error: message, code } = sanitizeErrorForClient(error);
    const status = code === 'DOMAIN_NOT_OWNED' ? 403 : code === 'CONTENT_NOT_FOUND' ? 404 : 500;
    return res.status(status).send({ error: message, code });
  }
  });
}
