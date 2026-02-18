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
).strict();

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

    const { limit, startDate, endDate, action, entityType } = queryResult.data;

    // Build query with optional filters
    let query = `
      al.id, al.action, al.entity_type, al.entity_id,
      al.created_at, d.name as domain_name
      FROM activity_log al
      LEFT JOIN domains d ON al.domain_id = d.id
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

    // FIXED (TIMELINE-ROUTE-2): Wrap DB query in try/catch to prevent raw pg errors leaking
    // FIXED (TIMELINE-TIMEOUT-1): Race against 30 s wall-clock to prevent connection pool
    // exhaustion from slow/hung PostgreSQL backends.
    try {
      const queryPromise = pool.query(`SELECT ${query}`, params);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Timeline query timeout after 30s')), 30000)
      );
      const { rows } = await Promise.race([queryPromise, timeoutPromise]);

      return {
        events: rows.map(row => ({
          id: row['id'],
          action: row['action'],
          entityType: row['entity_type'],
          entityId: row['entity_id'],
          domainName: row['domain_name'],
          createdAt: row['created_at'],
        })),
        // NOTE: `returned` is the count of rows in this page (capped by `limit`).
        // This is NOT the total record count. Use cursor-based pagination for full counts.
        returned: rows.length,
        filters: { startDate, endDate, action, entityType },
      };
    } catch (dbErr) {
      logger.error('Timeline org query failed', dbErr instanceof Error ? dbErr : new Error(String(dbErr)));
      return errors.internal(res, 'Failed to fetch timeline');
    }
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

    const { limit, startDate, endDate, action, entityType } = queryResult.data;

    // Build query with optional filters
    // FIXED (TIMELINE-ROUTE-8): Add org_id constraint for defence-in-depth.
    // The pre-check at line 144 is the primary guard, but SQL must also enforce the boundary
    // so that a future refactoring that removes the pre-check doesn't silently open an IDOR.
    let query = `
      al.id, al.action, al.entity_type, al.entity_id,
      al.created_at
      FROM activity_log al
      WHERE al.domain_id = $1
        AND al.org_id = $2
    `;
    const params: unknown[] = [domainId, ctx.orgId];
    let paramIndex = 3;

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

    // FIXED (TIMELINE-ROUTE-2): Wrap DB query in try/catch to prevent raw pg errors leaking
    // FIXED (TIMELINE-ROUTE-4): metadata column removed from SELECT — raw JSONB must not be
    //   returned to API consumers without schema validation (XSS and info-disclosure risk).
    // FIXED (TIMELINE-TIMEOUT-2): Race against 30 s wall-clock to prevent connection pool
    // exhaustion from slow/hung PostgreSQL backends.
    try {
      const queryPromise = pool.query(`SELECT ${query}`, params);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Domain timeline query timeout after 30s')), 30000)
      );
      const { rows } = await Promise.race([queryPromise, timeoutPromise]);

      return {
        events: rows.map(row => ({
          id: row['id'],
          action: row['action'],
          entityType: row['entity_type'],
          entityId: row['entity_id'],
          createdAt: row['created_at'],
        })),
        returned: rows.length,
        filters: { startDate, endDate, action, entityType },
      };
    } catch (dbErr) {
      logger.error('Timeline domain query failed', dbErr instanceof Error ? dbErr : new Error(String(dbErr)));
      return errors.internal(res, 'Failed to fetch timeline');
    }
  });
}
