

import { FastifyInstance, FastifyRequest } from 'fastify';
import { Pool } from 'pg';

import { rateLimit } from '../../services/rate-limit';
import { requireRole, type AuthContext } from '../../services/auth';

// I4-FIX: Configurable queue depth alerting thresholds
const BACKLOG_WARN_THRESHOLD = parseInt(process.env['QUEUE_BACKLOG_WARN'] || '100', 10);
const BACKLOG_CRITICAL_THRESHOLD = parseInt(process.env['QUEUE_BACKLOG_CRITICAL'] || '1000', 10);
const ERROR_RATE_THRESHOLD = parseFloat(process.env['QUEUE_ERROR_RATE_THRESHOLD'] || '0.1');

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

// I4-FIX: Alert severity levels
export interface QueueAlert {
  severity: 'warning' | 'critical';
  queue: string;
  metric: string;
  value: number;
  threshold: number;
  message: string;
}

/**
 * I4-FIX: Evaluate queue metrics against thresholds and generate alerts
 */
function evaluateAlerts(metrics: QueueMetrics): QueueAlert[] {
  const alerts: QueueAlert[] = [];

  // Check publishing queue backlog
  if (metrics.publishing.backlog > BACKLOG_CRITICAL_THRESHOLD) {
    alerts.push({
      severity: 'critical',
      queue: 'publishing',
      metric: 'backlog',
      value: metrics.publishing.backlog,
      threshold: BACKLOG_CRITICAL_THRESHOLD,
      message: `Publishing queue backlog (${metrics.publishing.backlog}) exceeds critical threshold (${BACKLOG_CRITICAL_THRESHOLD})`,
    });
  } else if (metrics.publishing.backlog > BACKLOG_WARN_THRESHOLD) {
    alerts.push({
      severity: 'warning',
      queue: 'publishing',
      metric: 'backlog',
      value: metrics.publishing.backlog,
      threshold: BACKLOG_WARN_THRESHOLD,
      message: `Publishing queue backlog (${metrics.publishing.backlog}) exceeds warning threshold (${BACKLOG_WARN_THRESHOLD})`,
    });
  }

  // Check publishing queue error rate
  if (metrics.publishing.errorRate > ERROR_RATE_THRESHOLD) {
    alerts.push({
      severity: 'warning',
      queue: 'publishing',
      metric: 'errorRate',
      value: metrics.publishing.errorRate,
      threshold: ERROR_RATE_THRESHOLD,
      message: `Publishing queue error rate (${(metrics.publishing.errorRate * 100).toFixed(1)}%) exceeds threshold (${(ERROR_RATE_THRESHOLD * 100).toFixed(1)}%)`,
    });
  }

  // Check search queue backlog
  if (metrics.search.backlog > BACKLOG_CRITICAL_THRESHOLD) {
    alerts.push({
      severity: 'critical',
      queue: 'search',
      metric: 'backlog',
      value: metrics.search.backlog,
      threshold: BACKLOG_CRITICAL_THRESHOLD,
      message: `Search queue backlog (${metrics.search.backlog}) exceeds critical threshold (${BACKLOG_CRITICAL_THRESHOLD})`,
    });
  } else if (metrics.search.backlog > BACKLOG_WARN_THRESHOLD) {
    alerts.push({
      severity: 'warning',
      queue: 'search',
      metric: 'backlog',
      value: metrics.search.backlog,
      threshold: BACKLOG_WARN_THRESHOLD,
      message: `Search queue backlog (${metrics.search.backlog}) exceeds warning threshold (${BACKLOG_WARN_THRESHOLD})`,
    });
  }

  // Check search queue error rate
  if (metrics.search.errorRate > ERROR_RATE_THRESHOLD) {
    alerts.push({
      severity: 'warning',
      queue: 'search',
      metric: 'errorRate',
      value: metrics.search.errorRate,
      threshold: ERROR_RATE_THRESHOLD,
      message: `Search queue error rate (${(metrics.search.errorRate * 100).toFixed(1)}%) exceeds threshold (${(ERROR_RATE_THRESHOLD * 100).toFixed(1)}%)`,
    });
  }

  return alerts;
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

  // I4-FIX: Queue depth alerting endpoint
  // Returns active alerts based on configurable thresholds for backlog and error rate
  app.get('/admin/queues/alerts', async (req, res) => {
    try {
      const ctx = req.auth as AuthContext;
      if (!ctx) {
        return res.status(401).send({ error: 'Unauthorized' });
      }
      requireRole(ctx, ['owner', 'admin']);
      await rateLimit('admin:queues:alerts', 40);

      const metrics = await fetchQueueMetrics(pool);
      const alerts = evaluateAlerts(metrics);

      return res.send({
        alerts,
        hasAlerts: alerts.length > 0,
        hasCritical: alerts.some(a => a.severity === 'critical'),
        thresholds: {
          backlogWarn: BACKLOG_WARN_THRESHOLD,
          backlogCritical: BACKLOG_CRITICAL_THRESHOLD,
          errorRate: ERROR_RATE_THRESHOLD,
        },
        checkedAt: new Date().toISOString(),
      });
    } catch (error) {
      console["error"]('[admin/queues/alerts] Error:', error);
      return res.status(500).send({ error: 'Failed to retrieve queue alerts' });
    }
  });
}
