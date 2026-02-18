/**
 * Database Maintenance Scheduler
 * 
 * Provides scheduled maintenance tasks for database optimization.
 * Integrates with job scheduling systems.
 * 
 * @module @packages/database/maintenance/scheduler
 */

import type { Knex } from 'knex';
import { runSequenceMonitoring } from './sequenceMonitor';
import { runVacuumMaintenance, vacuumHighChurnTables } from './vacuumManager';
import { runBloatAnalysis, createBloatAlertMessage } from './bloatDetector';
import type {} from './types';

/** Maintenance task types */
export type MaintenanceTaskType = 
  | 'sequence_check'
  | 'sequence_alert'
  | 'vacuum_high_churn'
  | 'vacuum_bloated'
  | 'bloat_analysis'
  | 'full_maintenance';

/** Maintenance task configuration */
export interface MaintenanceTask {
  type: MaintenanceTaskType;
  name: string;
  description: string;
  cron: string;
  enabled: boolean;
  options?: Record<string, unknown>;
}

/** Maintenance task result */
export interface MaintenanceTaskResult {
  task: MaintenanceTaskType;
  success: boolean;
  started_at: Date;
  completed_at: Date;
  duration_ms: number;
  results: unknown;
  alerts: string[];
  errors: string[];
}

/** Default maintenance schedule */
export const DEFAULT_MAINTENANCE_SCHEDULE: MaintenanceTask[] = [
  {
    type: 'sequence_check',
    name: 'sequence-frequent-check',
    description: 'High-frequency sequence monitoring for critical thresholds',
    cron: '*/15 * * * *', // Every 15 minutes
    enabled: true,
  },
  {
    type: 'sequence_alert',
    name: 'sequence-daily-alert',
    description: 'Daily sequence health check with alerting',
    cron: '0 9 * * *', // 9 AM daily
    enabled: true,
  },
  {
    type: 'vacuum_high_churn',
    name: 'vacuum-high-churn',
    description: 'Vacuum high-churn tables every 6 hours',
    cron: '0 */6 * * *',
    enabled: true,
  },
  {
    type: 'vacuum_bloated',
    name: 'vacuum-bloated-tables',
    description: 'Vacuum tables with high bloat ratio',
    cron: '0 2 * * *', // 2 AM daily
    enabled: true,
  },
  {
    type: 'bloat_analysis',
    name: 'bloat-analysis',
    description: 'Comprehensive bloat analysis and recommendations',
    cron: '0 8 * * 1', // Monday 8 AM
    enabled: true,
  },
  {
    type: 'full_maintenance',
    name: 'full-weekly-maintenance',
    description: 'Complete maintenance cycle with all checks',
    cron: '0 3 * * 0', // Sunday 3 AM
    enabled: true,
  },
];

/**
 * Execute a maintenance task
 */
export async function executeMaintenanceTask(
  knex: Knex,
  taskType: MaintenanceTaskType,
  options: Record<string, unknown> = {}
): Promise<MaintenanceTaskResult> {
  const startedAt = new Date();
  const alerts: string[] = [];
  const errors: string[] = [];
  let results: unknown = null;
  let success = true;
  
  try {
    switch (taskType) {
      case 'sequence_check': {
        const seqResults = await runSequenceMonitoring(knex, {
          thresholdPercent: options['thresholdPercent'] as number ?? 95,
          generateAlerts: false, // Just check, don't alert
        });
        results = seqResults;
        if (seqResults.critical_count > 0) {
          alerts.push(`Found ${seqResults.critical_count} critical sequences`);
        }
        break;
      }
        
      case 'sequence_alert': {
        const alertResults = await runSequenceMonitoring(knex, {
          thresholdPercent: options['thresholdPercent'] as number ?? 80,
          generateAlerts: true,
        });
        results = alertResults;
        if (alertResults.alerts_generated > 0) {
          alerts.push(`Generated ${alertResults.alerts_generated} sequence alerts`);
        }
        break;
      }
        
      case 'vacuum_high_churn': {
        const vacuumResults = await vacuumHighChurnTables(knex);
        results = vacuumResults;
        const failedVacuums = vacuumResults.filter(r => !r.success);
        if (failedVacuums.length > 0) {
          errors.push(`Failed to vacuum ${failedVacuums.length} tables`);
        }
        break;
      }

      case 'vacuum_bloated':
        results = await runVacuumMaintenance(knex, {
          minDeadTupleRatio: options['minDeadTupleRatio'] as number ?? 10,
          includeHighChurn: false, // Skip high-churn (handled separately)
        });
        break;
        
      case 'bloat_analysis': {
        const bloatResults = await runBloatAnalysis(knex);
        results = bloatResults;
        if (bloatResults.critical_count > 0) {
          alerts.push(createBloatAlertMessage(bloatResults));
        }
        break;
      }
        
      case 'full_maintenance':
        results = await runFullMaintenance(knex, options);
        break;
        
      default:
        throw new Error(`Unknown maintenance task type: ${taskType}`);
    }
  } catch (error) {
    success = false;
    errors.push(error instanceof Error ? error.message : String(error));
  }
  
  const completedAt = new Date();
  
  return {
    task: taskType,
    success,
    started_at: startedAt,
    completed_at: completedAt,
    duration_ms: completedAt.getTime() - startedAt.getTime(),
    results,
    alerts,
    errors,
  };
}

/**
 * Run full maintenance cycle
 */
async function runFullMaintenance(
  knex: Knex,
  options: Record<string, unknown> = {}
): Promise<{
  sequence_check: unknown;
  vacuum_maintenance: unknown;
  bloat_analysis: unknown;
}> {
  // Run all maintenance tasks
  const sequenceCheck = await runSequenceMonitoring(knex, {
    thresholdPercent: options['thresholdPercent'] as number ?? 80,
    generateAlerts: true,
  });
  
  const vacuumMaintenance = await runVacuumMaintenance(knex, {
    minDeadTupleRatio: options['minDeadTupleRatio'] as number ?? 5,
    includeHighChurn: true,
  });
  
  const bloatAnalysis = await runBloatAnalysis(knex);
  
  return {
    sequence_check: sequenceCheck,
    vacuum_maintenance: vacuumMaintenance,
    bloat_analysis: bloatAnalysis,
  };
}

/**
 * Get maintenance status summary
 */
export async function getMaintenanceStatus(
  knex: Knex
): Promise<{
  sequences: {
    total: number;
    critical: number;
    warning: number;
    healthy: number;
  };
  bloat: {
    total_tables: number;
    critical: number;
    warning: number;
    healthy: number;
    average_bloat_ratio: number;
  };
  unacknowledged_alerts: number;
  last_maintenance: Date | undefined;
}> {
  // Get sequence status
  const sequenceHealth = await knex.raw<{
    rows: Array<{ status: string; count: number }>;
  }>(`
    SELECT 
      CASE 
        WHEN utilization_percent >= 95 THEN 'critical'
        WHEN utilization_percent >= 80 THEN 'warning'
        ELSE 'healthy'
      END as status,
      COUNT(*) as count
    FROM v_sequence_health
    GROUP BY 1
  `);
  
  // Get bloat status
  const bloatStatus = await knex.raw<{
    rows: Array<{ status: string; count: number; avg_bloat: number }>;
  }>(`
    SELECT 
      status,
      COUNT(*) as count,
      AVG(bloat_ratio) as avg_bloat
    FROM db_table_bloat
    GROUP BY status
  `);
  
  // Get unacknowledged alerts
  // P1-FIX: PostgreSQL COUNT returns bigint which pg serializes as a string (e.g. "42").
  // The type was previously declared as `{ count: number }` which was incorrect and
  // caused `alertCount?.count ?? 0` to return the string "42" instead of the number 42.
  const alertCount = await knex('sequence_monitoring_alerts')
    .whereNull('acknowledged_at')
    .count<{ count: string }>('id as count')
    .first();

  // Get last maintenance
  const lastMaintenance = await knex('db_maintenance_log')
    .where('success', true)
    .max<{ max: Date }>('completed_at as max')
    .first();

  const seqMap = new Map(sequenceHealth.rows.map(r => [r.status, r.count]));
  const bloatMap = new Map(bloatStatus.rows.map(r => [r.status, r.count]));
  const totalBloat = bloatStatus.rows.reduce((sum, r) => sum + r.count, 0);
  // Guard against division by zero when no bloat data is available.
  // P2-FIX: Null-coalesce avg_bloat to 0 before multiplying — PostgreSQL AVG() returns
  // NULL for empty groups, which would propagate as NaN through the weighted sum.
  const avgBloat = totalBloat === 0
    ? 0
    : bloatStatus.rows.reduce((sum, r) => sum + ((r.avg_bloat ?? 0) * r.count), 0) / totalBloat;

  return {
    sequences: {
      total: sequenceHealth.rows.reduce((sum, r) => sum + r.count, 0),
      critical: seqMap.get('critical') ?? 0,
      warning: seqMap.get('warning') ?? 0,
      healthy: seqMap.get('healthy') ?? 0,
    },
    bloat: {
      total_tables: totalBloat,
      critical: bloatMap.get('CRITICAL') ?? 0,
      warning: bloatMap.get('WARNING') ?? 0,
      healthy: bloatMap.get('OK') ?? 0,
      average_bloat_ratio: avgBloat,
    },
    // P1-FIX: Parse string to number since pg COUNT returns bigint serialized as string.
    unacknowledged_alerts: parseInt(String(alertCount?.count ?? '0'), 10),
    last_maintenance: lastMaintenance?.max ?? undefined as Date | undefined,
  };
}

/**
 * Format maintenance status for display
 */
export function formatMaintenanceStatus(
  status: Awaited<ReturnType<typeof getMaintenanceStatus>>
): string {
  let output = '📊 Database Maintenance Status\n';
  output += '============================\n\n';
  
  // Sequences
  output += `Sequences: ${status.sequences.total} total\n`;
  output += `  🟢 Healthy: ${status.sequences.healthy}\n`;
  output += `  🟡 Warning: ${status.sequences.warning}\n`;
  output += `  🔴 Critical: ${status.sequences.critical}\n\n`;
  
  // Bloat
  output += `Tables: ${status.bloat.total_tables} total\n`;
  output += `  🟢 Healthy: ${status.bloat.healthy}\n`;
  output += `  🟡 Warning: ${status.bloat.warning}\n`;
  output += `  🔴 Critical: ${status.bloat.critical}\n`;
  output += `  Average Bloat: ${status.bloat.average_bloat_ratio.toFixed(2)}%\n\n`;
  
  // Alerts
  if (status.unacknowledged_alerts > 0) {
    output += `⚠️  Unacknowledged Alerts: ${status.unacknowledged_alerts}\n\n`;
  }
  
  // Last maintenance
  if (status.last_maintenance) {
    const daysAgo = Math.floor((Date.now() - status.last_maintenance.getTime()) / (1000 * 60 * 60 * 24));
    output += `Last Maintenance: ${daysAgo} days ago\n`;
  } else {
    output += `Last Maintenance: Never\n`;
  }
  
  return output;
}

/**
 * Create maintenance health check for monitoring systems
 */
export async function createHealthCheck(
  knex: Knex
): Promise<{
  healthy: boolean;
  status: 'healthy' | 'degraded' | 'critical';
  checks: {
    sequences: { healthy: boolean; message: string };
    bloat: { healthy: boolean; message: string };
    alerts: { healthy: boolean; message: string };
  };
}> {
  const status = await getMaintenanceStatus(knex);
  
  const seqHealthy = status.sequences.critical === 0;
  const bloatHealthy = status.bloat.critical === 0 && status.bloat.average_bloat_ratio < 0.2;
  const alertsHealthy = status.unacknowledged_alerts < 10;
  
  const overallHealthy = seqHealthy && bloatHealthy && alertsHealthy;
  const overallStatus = status.sequences.critical > 0 
    ? 'critical' 
    : (!seqHealthy || !bloatHealthy) 
    ? 'degraded' 
    : 'healthy';
  
  return {
    healthy: overallHealthy,
    status: overallStatus,
    checks: {
      sequences: {
        healthy: seqHealthy,
        message: seqHealthy 
          ? 'All sequences healthy' 
          : `${status.sequences.critical} sequences in critical state`,
      },
      bloat: {
        healthy: bloatHealthy,
        message: bloatHealthy 
          ? 'Table bloat within acceptable limits' 
          : `${status.bloat.critical} tables with critical bloat`,
      },
      alerts: {
        healthy: alertsHealthy,
        message: alertsHealthy 
          ? 'Alert queue healthy' 
          : `${status.unacknowledged_alerts} unacknowledged alerts`,
      },
    },
  };
}
