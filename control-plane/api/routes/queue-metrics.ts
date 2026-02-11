

import { FastifyInstance, FastifyRequest } from 'fastify';
import { Pool } from 'pg';

import { rateLimit } from '../../services/rate-limit';
import { requireRole, type AuthContext } from '../../services/auth';

// Interface for queue metrics
export interface QueueMetrics {
  publishing: {
  backlog: number;
  errorRate: number;
  concurrency: string;
  };
  search: {
  backlog: number;
  errorRate: number;
  concurrency: string;
  };
}

// Fetch metrics from database
async function fetchQueueMetrics(pool: Pool): Promise<QueueMetrics> {
  const publishingMetrics = await pool.query(
  `SELECT
    COUNT(*) FILTER (WHERE status = 'pending') as backlog,
    COALESCE(
    COUNT(*) FILTER (WHERE status = 'failed')::float /
    NULLIF(COUNT(*) FILTER (WHERE status IN ('completed', 'failed')), 0),
    0
    ) as error_rate
  FROM publishing_jobs
  WHERE created_at > NOW() - INTERVAL '24 hours'`
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
  WHERE created_at > NOW() - INTERVAL '24 hours'`
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
    const ctx = req.auth as AuthContext;
    if (!ctx) {
    return res.status(401).send({ error: 'Unauthorized' });
    }
    requireRole(ctx, ['owner','admin']);
    await rateLimit('admin:queues:metrics', 40);

    const metrics = await fetchQueueMetrics(pool);
    return res.send(metrics);
  } catch (error) {
    console["error"]('[admin/queues/metrics] Error:', error);
    return res.status(500).send({ error: 'Failed to retrieve queue metrics' });
  }
  });
}
