import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';
import { getLogger } from '@kernel/logger';
import { rateLimit } from '../../services/rate-limit';
import { requireRole, AuthContext } from '../../services/auth';

const logger = getLogger('activity');

const ActivityQuerySchema = z.object({
  entityType: z.string().optional(),
  entityId: z.string().optional(),
  domainId: z.string().uuid().optional(),
  action: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function activityRoutes(app: FastifyInstance, pool: Pool) {
  // GET /activity - List activity logs with filtering
  app.get('/activity', async (req: FastifyRequest, res: FastifyReply) => {
    try {
      const ctx = (req as unknown as { auth: { orgId: string; userId: string; role: string } }).auth;
      if (!ctx) {
        return res.status(401).send({ error: 'Unauthorized' });
      }
      requireRole(ctx as AuthContext, ['admin', 'editor', 'viewer']);
      await rateLimit('activity', 50, req, res);

      // Validate orgId
      if (!ctx?.["orgId"]) {
        return res.status(400).send({ error: 'Organization ID is required' });
      }

      // Validate query params
      const queryResult = ActivityQuerySchema.safeParse(req.query);
      if (!queryResult.success) {
        return res.status(400).send({
          error: 'Invalid query parameters',
          code: 'VALIDATION_ERROR',
          details: (queryResult as any).error.issues,
        });
      }

      const { entityType, entityId, domainId, action, limit, offset } = queryResult.data;

      // Build query
      let query = `
        SELECT id, org_id, domain_id, user_id, action, entity_type, entity_id,
               metadata, created_at
        FROM activity_log
        WHERE org_id = $1
      `;
      const params: unknown[] = [ctx["orgId"]];
      let paramIndex = 2;

      if (domainId) {
        query += ` AND domain_id = $${paramIndex++}`;
        params.push(domainId);
      }

      if (entityType) {
        query += ` AND entity_type = $${paramIndex++}`;
        params.push(entityType);
      }

      if (entityId) {
        query += ` AND entity_id = $${paramIndex++}`;
        params.push(entityId);
      }

      if (action) {
        query += ` AND action = $${paramIndex++}`;
        params.push(action);
      }

      // Get total count
      const countResult = await pool.query(
        `SELECT COUNT(*) FROM (${query}) as count_query`,
        params
      );
      const total = parseInt(countResult.rows[0].count, 10);

      // Add ordering and pagination
      query += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
      params.push(limit, offset);

      const { rows } = await pool.query(query, params);

      return {
        data: rows.map(row => ({
          id: row.id,
          action: row.action,
          entityType: row.entity_type,
          entityId: row.entity_id,
          domainId: row.domain_id,
          userId: row.user_id,
          metadata: row.metadata,
          createdAt: row.created_at,
        })),
        pagination: {
          total,
          limit,
          offset,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error: unknown) {
      logger.error('[activity] Error fetching activity logs:', error);
      return res.status(500).send({
        error: 'An error occurred fetching activity logs',
        code: 'INTERNAL_ERROR',
      });
    }
  });

  // GET /activity/:entityId - Get activity for a specific entity
  app.get('/activity/:entityId', async (req: FastifyRequest, res: FastifyReply) => {
    try {
      const ctx = (req as unknown as { auth: { orgId: string; userId: string; role: string } }).auth;
      if (!ctx) {
        return res.status(401).send({ error: 'Unauthorized' });
      }
      requireRole(ctx as AuthContext, ['admin', 'editor', 'viewer']);
      await rateLimit('activity', 50, req, res);

      const { entityId } = req.params as { entityId: string };

      const { rows } = await pool.query(
        `SELECT id, org_id, domain_id, user_id, action, entity_type, entity_id,
                metadata, created_at
         FROM activity_log
         WHERE org_id = $1 AND entity_id = $2
         ORDER BY created_at DESC
         LIMIT 100`,
        [ctx["orgId"], entityId]
      );

      return {
        data: rows.map(row => ({
          id: row.id,
          action: row.action,
          entityType: row.entity_type,
          entityId: row.entity_id,
          domainId: row.domain_id,
          userId: row.user_id,
          metadata: row.metadata,
          createdAt: row.created_at,
        })),
      };
    } catch (error: unknown) {
      logger.error('[activity] Error fetching entity activity:', error);
      return res.status(500).send({
        error: 'An error occurred fetching activity',
        code: 'INTERNAL_ERROR',
      });
    }
  });
}
