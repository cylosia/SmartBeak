

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

// P0-1 FIX: publishing_jobs has no org_id column (uses domain_id → domains.org_id).
// P0-1 FIX: search_indexing_jobs does not exist; correct table is indexing_jobs,
//           reached via indexing_jobs.index_id → search_indexes.domain_id → domains.org_id.
// P1-4 FIX: Added statement_timeout (5 s) to prevent connection-pool exhaustion if
//           the DB is degraded — without it a single slow admin request can hold a
//           connection indefinitely and cascade to full-pool starvation.
// P2-1 FIX: Both queries run in parallel (Promise.all) — they are independent and
//           previously doubled latency by running sequentially.
async function fetchQueueMetrics(pool: Pool, orgId: string): Promise<QueueMetrics> {
  const client = await pool.connect();
  try {
    await client.query('SET LOCAL statement_timeout = 5000');

    const [publishingMetrics, searchMetrics] = await Promise.all([
      client.query(
        `SELECT
          COUNT(*) FILTER (WHERE pj.status = 'pending') AS backlog,
          COALESCE(
            COUNT(*) FILTER (WHERE pj.status = 'failed')::float /
            NULLIF(COUNT(*) FILTER (WHERE pj.status IN ('completed', 'failed')), 0),
            0
          ) AS error_rate
        FROM publishing_jobs pj
        JOIN domains d ON d.id = pj.domain_id
        WHERE d.org_id = $1
          AND pj.created_at > NOW() - INTERVAL '24 hours'`,
        [orgId]
      ),
      client.query(
        `SELECT
          COUNT(*) FILTER (WHERE ij.status = 'pending') AS backlog,
          COALESCE(
            COUNT(*) FILTER (WHERE ij.status = 'failed')::float /
            NULLIF(COUNT(*) FILTER (WHERE ij.status IN ('completed', 'failed')), 0),
            0
          ) AS error_rate
        FROM indexing_jobs ij
        JOIN search_indexes si ON si.id = ij.index_id
        JOIN domains d ON d.id = si.domain_id
        WHERE d.org_id = $1
          AND ij.created_at > NOW() - INTERVAL '24 hours'`,
        [orgId]
      ),
    ]);

    return {
      publishing: {
        backlog: parseInt(publishingMetrics.rows[0]?.backlog ?? '0', 10),
        errorRate: parseFloat(publishingMetrics.rows[0]?.error_rate ?? '0'),
        concurrency: 'adaptive',
      },
      search: {
        backlog: parseInt(searchMetrics.rows[0]?.backlog ?? '0', 10),
        errorRate: parseFloat(searchMetrics.rows[0]?.error_rate ?? '0'),
        concurrency: 'adaptive',
      },
    };
  } finally {
    client.release();
  }
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
