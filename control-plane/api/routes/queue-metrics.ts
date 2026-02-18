

import { FastifyInstance } from 'fastify';
import { Pool } from 'pg';

import { rateLimit } from '../../services/rate-limit';
import { requireRole } from '../../services/auth';
import { getAuthContext } from '../types';
import { getLogger } from '@kernel/logger';
import { errors } from '@errors/responses';

const logger = getLogger('queue-metrics');

// Interface for queue metrics
export interface QueueMetrics {
  publishing: {
  backlog: number;
  errorRate: number;
  concurrency: 'adaptive';
  };
  search: {
  backlog: number;
  errorRate: number;
  concurrency: 'adaptive';
  };
}

// SECURITY FIX P1-6: Added orgId parameter for tenant isolation
async function fetchQueueMetrics(pool: Pool, orgId: string): Promise<QueueMetrics> {
  const publishingMetrics = await pool.query(
  `SELECT
    COUNT(*) FILTER (WHERE status = 'pending') as backlog,
    COALESCE(
    COUNT(*) FILTER (WHERE status = 'failed')::float /
    NULLIF(COUNT(*) FILTER (WHERE status IN ('completed', 'failed')), 0),
    0
    ) as error_rate
  FROM publishing_jobs
  WHERE org_id = $1 AND created_at > NOW() - INTERVAL '24 hours'`,
  [orgId]
  );

  const searchMetrics = await pool.query(
  `SELECT
    COUNT(*) FILTER (WHERE status = 'pending') as backlog,
    COALESCE(
    COUNT(*) FILTER (WHERE status = 'failed')::float /
    NULLIF(COUNT(*) FILTER (WHERE status IN ('completed', 'failed')), 0),
    0
    ) as error_rate
  FROM search_indexing_jobs
  WHERE org_id = $1 AND created_at > NOW() - INTERVAL '24 hours'`,
  [orgId]
  );

  return {
  publishing: {
    backlog: parseInt(publishingMetrics.rows[0]?.backlog || '0', 10),
    errorRate: parseFloat(publishingMetrics.rows[0]?.error_rate || '0'),
    concurrency: 'adaptive'
  },
  search: {
    backlog: parseInt(searchMetrics.rows[0]?.backlog || '0', 10),
    errorRate: parseFloat(searchMetrics.rows[0]?.error_rate || '0'),
    concurrency: 'adaptive'
  }
  };
}

export async function queueMetricsRoutes(app: FastifyInstance, pool: Pool) {
  app.get('/admin/queues/metrics', async (req, res) => {
  try {
    // P1-3 FIX: Rate limit BEFORE auth checks. Previously rate limiting ran
    // after requireRole(), meaning unauthenticated/unauthorized callers could
    // spam auth failures without consuming any rate-limit quota.
    await rateLimit(`admin:queues:metrics:${req.ip}`, 40);

    const ctx = getAuthContext(req);
    requireRole(ctx, ['owner', 'admin']);

    const metrics = await fetchQueueMetrics(pool, ctx['orgId']);
    return res.send(metrics);
  } catch (error) {
    logger.error('[admin/queues/metrics] Error', { message: error instanceof Error ? error.message : String(error) });
    return errors.internal(res, 'Failed to retrieve queue metrics');
  }
  });
}
