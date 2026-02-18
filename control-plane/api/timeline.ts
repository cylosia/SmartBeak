
import { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';
import { getLogger } from '@kernel/logger';
import { rateLimit } from '../services/rate-limit';
import { requireRole } from '../services/auth';
import { getAuthContext } from './types';
import { errors } from '@errors/responses';
import { ErrorCodes } from '@errors';

const _logger = getLogger('timeline:decisions');

export interface DomainParams {
  domainId: string;
}

const DomainParamsSchema = z.object({
  domainId: z.string().uuid('Domain ID must be a valid UUID'),
}).strict();

/**
 * FIXED (TIMELINE-3-5): Route path renamed from `/timeline/domain/:domainId` to
 * `/timeline/decisions/:domainId` to eliminate the path conflict with the route in
 * `routes/timeline.ts` which queries `activity_log`. This handler queries
 * `decision_timeline_events` and has a distinct purpose.
 *
 * FIXED (TIMELINE-3-1): Removed unsafe `app as FastifyInstanceWithDb` cast.
 *   Now accepts `pool: Pool` directly, same pattern as routes/timeline.ts.
 */
export async function registerTimelineRoutes(app: FastifyInstance, pool: Pool) {
  app.get('/timeline/decisions/:domainId', async (req, res) => {
    const ctx = getAuthContext(req);
    requireRole(ctx, ['owner', 'admin', 'editor', 'viewer']);
    await rateLimit(`timeline:${ctx.orgId}`, 50);

    const paramsResult = DomainParamsSchema.safeParse(req.params);
    if (!paramsResult.success) {
      // FIXED (TIMELINE-3-6): Use canonical error helpers with requestId
      return errors.badRequest(res, 'Invalid domain ID', ErrorCodes['INVALID_PARAMS'], paramsResult.error.issues);
    }

    const { domainId } = paramsResult.data;

    try {
      // Verify domain belongs to the user's org
      const { rows: domainRows } = await pool.query(
        'SELECT 1 FROM domains WHERE id = $1 AND org_id = $2',
        [domainId, ctx.orgId]
      );

      if (domainRows.length === 0) {
        // FIXED (TIMELINE-3-6): Use canonical error helper
        return errors.notFound(res, 'Domain', ErrorCodes['DOMAIN_NOT_FOUND']);
      }

      // FIXED (TIMELINE-3-2): Use JOIN instead of unbounded IN subquery; add org_id constraint;
      //   add LIMIT to prevent full-table scans on domains with many intents.
      const { rows } = await pool.query(
        `SELECT dte.id, dte.intent_id, dte.action, dte.status, dte.requested_at
         FROM decision_timeline_events dte
         JOIN human_intents hi ON dte.intent_id = hi.id
         WHERE hi.domain_id = $1
           AND hi.org_id = $2
         ORDER BY dte.requested_at ASC
         LIMIT 200`,
        [domainId, ctx.orgId]
      );

      return {
        events: rows.map(row => ({
          id: row['id'],
          intentId: row['intent_id'],
          action: row['action'],
          status: row['status'],
          requestedAt: row['requested_at'],
        })),
      };
    } catch (dbErr) {
      // FIXED (TIMELINE-3-3): Added try/catch — raw pg errors must not propagate to client
      _logger.error('Decision timeline query failed', dbErr instanceof Error ? dbErr : new Error(String(dbErr)));
      return errors.internal(res, 'Failed to fetch decision timeline');
    }
  });
}
