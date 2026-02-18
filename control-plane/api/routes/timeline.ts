import { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';

import { rateLimit } from '../../services/rate-limit';
import { requireRole } from '../../services/auth';
import { getAuthContext } from '../types';
import { getLogger } from '@kernel/logger';
import { errors } from '@errors/responses';
import { ErrorCodes } from '@errors';

const logger = getLogger('timeline');

const DomainParamsSchema = z.object({
  domainId: z.string().uuid(),
}).strict();

// Pagination schema with configurable limit
const TimelineQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(200).optional().default(50),
  offset: z.coerce.number().min(0).optional().default(0),
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
    // P0-2 FIX: Auth check BEFORE requireRole to prevent error swallowing
    const ctx = getAuthContext(req);
    requireRole(ctx, ['owner', 'admin', 'editor', 'viewer']);

    // P1-2 FIX: Per-org rate limiting instead of global
    await rateLimit(`timeline:${ctx.orgId}`, 50);

    const { orgId } = ctx;

    // Validate orgId using Zod schema
    const orgIdResult = z.string().uuid().safeParse(orgId);
    if (!orgIdResult.success) {
      return errors.validationFailed(res, orgIdResult.error.issues);
    }

    // Parse and validate query params
    const queryResult = TimelineQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      return errors.validationFailed(res, queryResult.error.issues);
    }

    const { limit, offset, startDate, endDate, action, entityType } = queryResult.data;

    // Build WHERE clause with optional filters
    let whereClause = 'WHERE al.org_id = $1';
    const params: unknown[] = [orgId];
    let paramIndex = 2;

    if (startDate) {
      whereClause += ` AND al.created_at >= $${paramIndex++}`;
      params.push(startDate);
    }

    if (endDate) {
      whereClause += ` AND al.created_at <= $${paramIndex++}`;
      params.push(endDate);
    }

    if (action) {
      whereClause += ` AND al.action = $${paramIndex++}`;
      params.push(action);
    }

    if (entityType) {
      whereClause += ` AND al.entity_type = $${paramIndex++}`;
      params.push(entityType);
    }

    // P1-1 FIX: Use COUNT(*) OVER() window function to get the true total matching
    // rows alongside the paginated slice, without a second round-trip to the DB.
    // P2-2 FIX: Pass Date objects directly instead of .toISOString() strings so
    // the pg driver handles timestamptz correctly.
    const { rows } = await pool.query(
      `SELECT
         al.id, al.action, al.entity_type, al.entity_id,
         al.created_at, d.name AS domain_name,
         COUNT(*) OVER() AS total_count
       FROM activity_log al
       LEFT JOIN domains d ON al.domain_id = d.id
       ${whereClause}
       ORDER BY al.created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
      [...params, limit, offset]
    );

    const total = rows.length > 0 ? Number(rows[0]?.['total_count'] ?? 0) : 0;

    return {
      events: rows.map(row => ({
        id: row['id'],
        action: row['action'],
        entityType: row['entity_type'],
        entityId: row['entity_id'],
        domainName: row['domain_name'],
        createdAt: row['created_at'],
      })),
      total,
      limit,
      offset,
      filters: { startDate, endDate, action, entityType },
    };
  });

  // GET /timeline/domain/:domainId - Get domain-specific timeline
  app.get('/timeline/domain/:domainId', async (req, res) => {
    // P0-2 FIX: Auth check BEFORE requireRole to prevent error swallowing
    const ctx = getAuthContext(req);
    requireRole(ctx, ['owner', 'admin', 'editor', 'viewer']);

    // P1-2 FIX: Per-org rate limiting instead of global
    await rateLimit(`timeline:${ctx.orgId}`, 50);

    const paramsResult = DomainParamsSchema.safeParse(req.params);
    if (!paramsResult.success) {
      return errors.badRequest(res, 'Invalid domain ID', ErrorCodes.INVALID_PARAMS, paramsResult.error.issues);
    }

    const { domainId } = paramsResult.data;

    // Validate orgId
    const orgIdResult = z.string().uuid().safeParse(ctx.orgId);
    if (!orgIdResult.success) {
      return errors.badRequest(res, 'Invalid organization ID');
    }

    // P1-10 FIX: Return 404 instead of 403 to prevent domain ID enumeration
    const { rows: domainRows } = await pool.query(
      'SELECT 1 FROM domains WHERE id = $1 AND org_id = $2',
      [domainId, ctx.orgId]
    );

    if (domainRows.length === 0) {
      return errors.notFound(res, 'Domain', ErrorCodes.DOMAIN_NOT_FOUND);
    }

    // Parse and validate query params
    const queryResult = TimelineQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      return errors.validationFailed(res, queryResult.error.issues);
    }

    const { limit, offset, startDate, endDate, action, entityType } = queryResult.data;

    // Build WHERE clause with optional filters
    let whereClause = 'WHERE al.domain_id = $1';
    const params: unknown[] = [domainId];
    let paramIndex = 2;

    if (startDate) {
      whereClause += ` AND al.created_at >= $${paramIndex++}`;
      params.push(startDate);
    }

    if (endDate) {
      whereClause += ` AND al.created_at <= $${paramIndex++}`;
      params.push(endDate);
    }

    if (action) {
      whereClause += ` AND al.action = $${paramIndex++}`;
      params.push(action);
    }

    if (entityType) {
      whereClause += ` AND al.entity_type = $${paramIndex++}`;
      params.push(entityType);
    }

    // P1-1 FIX: COUNT(*) OVER() returns actual total; OFFSET enables cursor pagination.
    // P2-2 FIX: Pass Date objects directly — pg handles timestamptz correctly.
    const { rows } = await pool.query(
      `SELECT
         al.id, al.action, al.entity_type, al.entity_id,
         al.metadata, al.created_at,
         COUNT(*) OVER() AS total_count
       FROM activity_log al
       ${whereClause}
       ORDER BY al.created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
      [...params, limit, offset]
    );

    const total = rows.length > 0 ? Number(rows[0]?.['total_count'] ?? 0) : 0;

    return {
      events: rows.map(row => ({
        id: row['id'],
        action: row['action'],
        entityType: row['entity_type'],
        entityId: row['entity_id'],
        metadata: row['metadata'],
        createdAt: row['created_at'],
      })),
      total,
      limit,
      offset,
      filters: { startDate, endDate, action, entityType },
    };
  });
}
