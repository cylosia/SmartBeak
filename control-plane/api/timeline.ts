
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getLogger } from '@kernel/logger';
import { rateLimit } from '../services/rate-limit';
import { requireRole } from '../services/auth';
import { getAuthContext } from './types';

const logger = getLogger('timeline');

export interface DomainParams {
  domainId: string;
}

// Extend FastifyInstance to include db
interface FastifyInstanceWithDb extends FastifyInstance {
  db: {
    query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }>;
  };
}

const DomainParamsSchema = z.object({
  domainId: z.string().uuid('Domain ID must be a valid UUID'),
}).strict();

export async function registerTimelineRoutes(app: FastifyInstance) {
  const appWithDb = app as FastifyInstanceWithDb;

  app.get('/timeline/domain/:domainId', async (req, res) => {
    // P0-1 FIX: Add authentication, authorization, input validation, and rate limiting
    const ctx = getAuthContext(req);
    requireRole(ctx, ['owner', 'admin', 'editor', 'viewer']);
    await rateLimit(`timeline:${ctx.orgId}`, 50);

    const paramsResult = DomainParamsSchema.safeParse(req.params);
    if (!paramsResult.success) {
      return res.status(400).send({
        error: 'Invalid domain ID',
        code: 'VALIDATION_ERROR',
        details: paramsResult.error.issues,
      });
    }

    const { domainId } = paramsResult.data;

    // Verify domain belongs to the user's org
    const { rows: domainRows } = await appWithDb.db.query(
      'SELECT 1 FROM domains WHERE id = $1 AND org_id = $2',
      [domainId, ctx.orgId]
    );

    if (domainRows.length === 0) {
      // Return 404 (not 403) to prevent domain ID enumeration
      return res.status(404).send({ error: 'Domain not found' });
    }

    const result = await appWithDb.db.query(
      `SELECT dte.id, dte.intent_id, dte.action, dte.status, dte.requested_at
       FROM decision_timeline_events dte
       WHERE dte.intent_id IN (SELECT id FROM human_intents WHERE domain_id = $1)
       ORDER BY dte.requested_at ASC`,
      [domainId]
    );
    return result.rows;
  });
}
