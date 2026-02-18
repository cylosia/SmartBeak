/**
 * P2-MEDIUM FIX: Sequence Monitoring Utilities
 */

import { getPool, getConnectionMetrics } from '../pool';
import { getLogger } from '@kernel/logger';

const logger = getLogger('database:health');

/**
 * Check database health
 */
export async function checkHealth(): Promise<{
  healthy: boolean;
  latency: number;
  error?: string;
  metrics?: ReturnType<typeof getConnectionMetrics>;
}> {
  const start = Date.now();
  try {
    const pool = await getPool();
    await pool.query('SELECT 1');
    return {
      healthy: true,
      latency: Date.now() - start,
      metrics: getConnectionMetrics(),
    };
  } catch (error: unknown) {
    return {
      healthy: false,
      latency: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
      metrics: getConnectionMetrics(),
    };
  }
}

/**
 * Check sequence health and get utilization stats
 * Requires sequence_monitoring_alerts table to exist
 */
export async function checkSequenceHealth(): Promise<{
  healthy: boolean;
  sequences: Array<{
    name: string;
    currentValue: number;
    maxValue: number;
    utilizationPercent: number;
    status: 'OK' | 'WARNING' | 'CRITICAL';
  }>;
}> {
  try {
    const pool = await getPool();
    const { rows } = await pool.query(`
      SELECT 
        sequencename as name,
        COALESCE(last_value, 0) as "currentValue",
        max_value as "maxValue",
        ROUND((COALESCE(last_value, 0)::numeric / NULLIF(max_value, 0)::numeric) * 100, 2) as "utilizationPercent",
        CASE 
          WHEN COALESCE(last_value, 0)::numeric / NULLIF(max_value, 0)::numeric > 0.9 THEN 'CRITICAL'
          WHEN COALESCE(last_value, 0)::numeric / NULLIF(max_value, 0)::numeric > 0.75 THEN 'WARNING'
          ELSE 'OK'
        END as status
      FROM pg_sequences
      WHERE schemaname = 'public'
      AND max_value IS NOT NULL
      ORDER BY "utilizationPercent" DESC
    `);

    const hasCritical = rows.some((r: { status: string }) => r.status === 'CRITICAL');

    return {
      healthy: !hasCritical,
      sequences: rows,
    };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to check sequence health', err);
    return {
      healthy: false, // P2-MEDIUM FIX: Return false on error to properly indicate health check failure
      sequences: [],
    };
  }
}

/**
 * Get database status with detailed information
 */
export async function getDatabaseStatus(): Promise<{
  status: 'healthy' | 'degraded' | 'unhealthy';
  health: Awaited<ReturnType<typeof checkHealth>>;
  sequences: Awaited<ReturnType<typeof checkSequenceHealth>>;
}> {
  const [health, sequences] = await Promise.all([
    checkHealth(),
    checkSequenceHealth(),
  ]);

  let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
  if (!health.healthy) {
    status = 'unhealthy';
  } else if (!sequences.healthy) {
    status = 'degraded';
  }

  return {
    status,
    health,
    sequences,
  };
}
