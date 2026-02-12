import { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';

import { rateLimit } from '../../services/rate-limit';
import { requireRole, type AuthContext } from '../../services/auth';
import { getAuthContext } from '../types';
import { getLogger } from '../../../packages/kernel/logger';

const logger = getLogger('timeline');

const DomainParamsSchema = z.object({
  domainId: z.string().uuid(),
});

// Pagination schema with configurable limit
const TimelineQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(200).optional().default(50),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  action: z.enum(['create', 'update', 'delete', 'publish', 'archive']).optional(),
  entityType: z.enum(['content', 'domain', 'user', 'integration']).optional(),
}).refine(
  (data) => {
  if (data.startDate && data.endDate) {
    return data.startDate <= data.endDate;
  }
  return true;
  },
  { message: 'startDate must be before or equal to endDate' }
).refine(
  (data) => {
  if (data.startDate && data.endDate) {
    const diffDays = (data.endDate.getTime() - data.startDate.getTime()) / (1000 * 60 * 60 * 24);
    return diffDays <= 365; // Max 1 year range
  }
  return true;
  },
  { message: 'Date range cannot exceed 365 days' }
);

export async function timelineRoutes(app: FastifyInstance, pool: Pool) {
  // GET /timeline - Get organization-wide timeline
  app.get('/timeline', async (req, res) => {
  try {
    // P0-2 FIX: Use getAuthContext (throws on missing auth) BEFORE requireRole
    let ctx: AuthContext;
    try {
    ctx = getAuthContext(req);
    } catch {
    return res.status(401).send({ error: 'Unauthorized' });
    }

    if (!ctx.orgId) {
    return res.status(401).send({ error: 'Unauthorized' });
    }

    requireRole(ctx, ['owner', 'admin', 'editor', 'viewer']);
    // P2-1 FIX: Scope rate limit to organization
    await rateLimit(`timeline:${ctx.orgId}`, 50);

    const { orgId } = ctx;

    // Validate orgId using Zod schema
    const orgIdResult = z.string().uuid().safeParse(orgId);
    if (!orgIdResult.success) {
    return res.status(400).send({
    error: 'Invalid organization ID',
    code: 'VALIDATION_ERROR',
    });
    }

    // Parse and validate query params
    const queryResult = TimelineQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
    return res.status(400).send({
    error: 'Invalid query parameters',
    code: 'VALIDATION_ERROR',
    details: queryResult["error"].issues,
    });
    }

    const { limit, startDate, endDate, action, entityType } = queryResult.data;

    // Build query with optional filters
    let query = `
    al["id"], al.action, al.entity_type, al.entity_id,
    al.created_at, d.name as domain_name
    FROM activity_log al
    LEFT JOIN domains d ON al.domain_id = d["id"]
    WHERE al.org_id = $1
    `;
    const params: unknown[] = [orgId];
    let paramIndex = 2;

    if (startDate) {
    query += ` AND al.created_at >= $${paramIndex++}`;
    params.push(startDate.toISOString());
    }

    if (endDate) {
    query += ` AND al.created_at <= $${paramIndex++}`;
    params.push(endDate.toISOString());
    }

    if (action) {
    query += ` AND al.action = $${paramIndex++}`;
    params.push(action);
    }

    if (entityType) {
    query += ` AND al.entity_type = $${paramIndex++}`;
    params.push(entityType);
    }

    query += ` ORDER BY al.created_at DESC LIMIT $${paramIndex}`;
    params.push(limit);

    // Fetch recent activity across all domains
    const { rows } = await pool.query(`SELECT ${query}`, params);

    return {
    events: rows.map(row => ({
    id: row["id"],
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    domainName: row.domain_name,
    createdAt: row.created_at,
    })),
    total: rows.length,
    filters: { startDate, endDate, action, entityType },
    };
  } catch (error) {
    // P1-5 FIX: Use structured logger instead of console.error
    logger.error('[timeline] Error', error instanceof Error ? error : new Error(String(error)));
    // P2-3 FIX: Return proper error response instead of masking as empty success
    return res.status(500).send({ error: 'Internal server error' });
  }
  });

  // GET /timeline/domain/:domainId - Get domain-specific timeline
  app.get('/timeline/domain/:domainId', async (req, res) => {
  try {
    // P0-2 FIX: Use getAuthContext (throws on missing auth) BEFORE requireRole
    let ctx: AuthContext;
    try {
    ctx = getAuthContext(req);
    } catch {
    return res.status(401).send({ error: 'Unauthorized' });
    }

    if (!ctx.orgId) {
    return res.status(401).send({ error: 'Unauthorized' });
    }

    requireRole(ctx, ['owner', 'admin', 'editor', 'viewer']);
    // P2-1 FIX: Scope rate limit to organization
    await rateLimit(`timeline:${ctx.orgId}`, 50);

    const paramsResult = DomainParamsSchema.safeParse(req.params);
    if (!paramsResult.success) {
    return res.status(400).send({
    error: 'Invalid domain ID',
    code: 'INVALID_ID',
    details: paramsResult["error"].issues,
    });
    }

    const { domainId } = paramsResult.data;

    // Validate orgId
    const orgIdResult = z.string().uuid().safeParse(ctx["orgId"]);
    if (!orgIdResult.success) {
    return res.status(400).send({
    error: 'Invalid organization ID',
    code: 'VALIDATION_ERROR',
    });
    }

    // Verify domain access
    const { rows: domainRows } = await pool.query(
    'SELECT 1 FROM domains WHERE id = $1 AND org_id = $2',
    [domainId, ctx["orgId"]]
    );

    if (domainRows.length === 0) {
    // P1-6 FIX: Return 404 instead of 403 to prevent domain ID enumeration
    return res.status(404).send({ error: 'Domain not found' });
    }

    // Parse and validate query params
    const queryResult = TimelineQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
    return res.status(400).send({
    error: 'Invalid query parameters',
    code: 'VALIDATION_ERROR',
    details: queryResult["error"].issues,
    });
    }

    const { limit, startDate, endDate, action, entityType } = queryResult.data;

    // Build query with optional filters
    let query = `
    al["id"], al.action, al.entity_type, al.entity_id,
    al.metadata, al.created_at
    FROM activity_log al
    WHERE al.domain_id = $1
    `;
    const params: unknown[] = [domainId];
    let paramIndex = 2;

    if (startDate) {
    query += ` AND al.created_at >= $${paramIndex++}`;
    params.push(startDate.toISOString());
    }

    if (endDate) {
    query += ` AND al.created_at <= $${paramIndex++}`;
    params.push(endDate.toISOString());
    }

    if (action) {
    query += ` AND al.action = $${paramIndex++}`;
    params.push(action);
    }

    if (entityType) {
    query += ` AND al.entity_type = $${paramIndex++}`;
    params.push(entityType);
    }

    query += ` ORDER BY al.created_at DESC LIMIT $${paramIndex}`;
    params.push(limit);

    // Fetch domain-specific activity
    const { rows } = await pool.query(`SELECT ${query}`, params);

    return {
    events: rows.map(row => ({
    id: row["id"],
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    metadata: row.metadata,
    createdAt: row.created_at,
    })),
    total: rows.length,
    filters: { startDate, endDate, action, entityType },
    };
  } catch (error) {
    // P1-5 FIX: Use structured logger instead of console.error
    logger.error('[timeline/domain] Error', error instanceof Error ? error : new Error(String(error)));
    // P2-3 FIX: Return proper error response instead of masking as empty success
    return res.status(500).send({ error: 'Internal server error' });
  }
  });
}
