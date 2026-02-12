/**
 * Database Maintenance Job
 * 
 * Scheduled maintenance tasks for database optimization:
 * - Sequence monitoring and alerting
 * - Vacuum/analyze operations
 * - Bloat detection and reporting
 * 
 * @module apps/api/jobs/databaseMaintenanceJob
 */

import { z } from 'zod';
import { getLogger } from '@kernel/logger';
import { maintenance } from '@database';
import type { Knex } from 'knex';
import { db } from '../db';

const logger = getLogger('db-maintenance-job');

/** Job data schema */
export const MaintenanceJobDataSchema = z.object({
  task: z.enum([
    'sequence_check',
    'sequence_alert', 
    'vacuum_high_churn',
    'vacuum_bloated',
    'bloat_analysis',
    'full_maintenance',
  ]),
  thresholdPercent: z.number().min(50).max(99).optional(),
  minDeadTupleRatio: z.number().min(1).max(50).optional(),
  dryRun: z.boolean().optional(),
  notifyOnSuccess: z.boolean().optional(),
});

export type MaintenanceJobData = z.infer<typeof MaintenanceJobDataSchema>;

/** Job result */
export interface MaintenanceJobResult {
  success: boolean;
  task: string;
  duration_ms: number;
  alerts: string[];
  errors: string[];
  details: unknown;
}

/**
 * Execute database maintenance task
 */
export async function executeDatabaseMaintenance(
  data: MaintenanceJobData
): Promise<MaintenanceJobResult> {
  const startTime = Date.now();
  const alerts: string[] = [];
  const errors: string[] = [];
  
  logger.info('Starting database maintenance task', { task: data.task });
  
  try {
    const result = await maintenance.scheduler.executeMaintenanceTask(
      db,
      data.task,
      {
        thresholdPercent: data.thresholdPercent,
        minDeadTupleRatio: data.minDeadTupleRatio,
        dryRun: data.dryRun,
      }
    );
    
    const duration = Date.now() - startTime;
    
    // Log alerts
    for (const alert of result.alerts) {
      logger.warn('Maintenance alert', { task: data.task, alert });
      alerts.push(alert);
    }
    
    // Log errors
    for (const error of result.errors) {
      logger.error('Maintenance error', undefined, { task: data.task, error });
      errors.push(error);
    }
    
    if (result.success && data.notifyOnSuccess) {
      logger.info('Database maintenance completed successfully', {
        task: data.task,
        duration_ms: duration,
      });
    }
    
    return {
      success: result.success,
      task: data.task,
      duration_ms: duration,
      alerts,
      errors,
      details: result.results,
    };
  } catch (err) {
    const duration = Date.now() - startTime;
    const errorMessage = err instanceof Error ? err.message : String(err);
    
    logger.error('Database maintenance failed', undefined, {
      task: data.task,
      error: errorMessage,
      duration_ms: duration,
    });
    
    return {
      success: false,
      task: data.task,
      duration_ms: duration,
      alerts,
      errors: [...errors, errorMessage],
      details: null,
    };
  }
}

/**
 * Get database maintenance status
 */
export async function getDatabaseMaintenanceStatus(): Promise<{
  healthy: boolean;
  status: string;
  sequences: {
    total: number;
    critical: number;
    warning: number;
  };
  bloat: {
    total_tables: number;
    critical: number;
    warning: number;
    average_bloat_ratio: number;
  };
  unacknowledged_alerts: number;
}> {
  const status = await maintenance.getMaintenanceStatus(db);
  const healthCheck = await maintenance.createHealthCheck(db);
  
  return {
    healthy: healthCheck.healthy,
    status: healthCheck.status,
    sequences: {
      total: status.sequences.total,
      critical: status.sequences.critical,
      warning: status.sequences.warning,
    },
    bloat: {
      total_tables: status.bloat.total_tables,
      critical: status.bloat.critical,
      warning: status.bloat.warning,
      average_bloat_ratio: status.bloat.average_bloat_ratio,
    },
    unacknowledged_alerts: status.unacknowledged_alerts,
  };
}

/**
 * Acknowledge a sequence alert
 */
export async function acknowledgeSequenceAlert(
  alertId: number,
  acknowledgedBy: string,
  notes?: string
): Promise<boolean> {
  return await maintenance.acknowledgeAlert(db, alertId, acknowledgedBy, notes);
}

/**
 * Get unacknowledged sequence alerts
 */
export async function getUnacknowledgedAlerts(
  level?: 'WARNING' | 'CRITICAL'
): Promise<maintenance.SequenceAlert[]> {
  return await maintenance.getUnacknowledgedAlerts(db, level);
}

/**
 * Run manual vacuum on a table
 */
// M10-FIX: Whitelist of known tables to prevent SQL injection via table name
const ALLOWED_VACUUM_TABLES = [
  'domains', 'domain_registry', 'domain_activity', 'content_items',
  'domain_sale_readiness', 'diligence_sessions', 'diligence_tokens',
  'email_optin_confirmations', 'audit_events', 'org_usage',
  'domain_exports', 'domain_transfer_log', 'memberships',
] as const;

export async function manualVacuumTable(
  tableName: string
): Promise<maintenance.MaintenanceResult> {
  if (!(ALLOWED_VACUUM_TABLES as readonly string[]).includes(tableName)) {
    throw new Error(`Table "${tableName}" is not in the allowed vacuum list`);
  }
  logger.info('Running manual vacuum', { table: tableName });
  return await maintenance.vacuumAnalyzeTable(db, tableName);
}

/**
 * Register maintenance jobs with the scheduler
 */
export function registerMaintenanceJobs(
  register: <T>(
    config: {
      name: string;
      queue: string;
      priority?: 'critical' | 'high' | 'normal' | 'low' | 'background';
      maxRetries?: number;
      timeout?: number;
    },
    handler: (data: T) => Promise<unknown>,
    schema?: z.ZodSchema<T>
  ) => void
): void {
  // Sequence monitoring - every 15 minutes
  register<MaintenanceJobData>(
    {
      name: 'db-maintenance-sequence-check',
      queue: 'database-maintenance',
      priority: 'high',
      maxRetries: 2,
      timeout: 60000,
    },
    async (data) => {
      return executeDatabaseMaintenance({
        ...data,
        task: 'sequence_check',
        thresholdPercent: 95,
      });
    },
    MaintenanceJobDataSchema
  );
  
  // Sequence alerting - daily
  register<MaintenanceJobData>(
    {
      name: 'db-maintenance-sequence-alert',
      queue: 'database-maintenance',
      priority: 'normal',
      maxRetries: 3,
      timeout: 120000,
    },
    async (data) => {
      return executeDatabaseMaintenance({
        ...data,
        task: 'sequence_alert',
        thresholdPercent: 80,
        notifyOnSuccess: true,
      });
    },
    MaintenanceJobDataSchema
  );
  
  // Vacuum high-churn tables - every 6 hours
  register<MaintenanceJobData>(
    {
      name: 'db-maintenance-vacuum-high-churn',
      queue: 'database-maintenance',
      priority: 'background',
      maxRetries: 1,
      timeout: 300000, // 5 minutes
    },
    async (data) => {
      return executeDatabaseMaintenance({
        ...data,
        task: 'vacuum_high_churn',
      });
    },
    MaintenanceJobDataSchema
  );
  
  // Vacuum bloated tables - daily
  register<MaintenanceJobData>(
    {
      name: 'db-maintenance-vacuum-bloated',
      queue: 'database-maintenance',
      priority: 'background',
      maxRetries: 2,
      timeout: 600000, // 10 minutes
    },
    async (data) => {
      return executeDatabaseMaintenance({
        ...data,
        task: 'vacuum_bloated',
        minDeadTupleRatio: 10,
      });
    },
    MaintenanceJobDataSchema
  );
  
  // Bloat analysis - weekly
  register<MaintenanceJobData>(
    {
      name: 'db-maintenance-bloat-analysis',
      queue: 'database-maintenance',
      priority: 'low',
      maxRetries: 2,
      timeout: 120000,
    },
    async (data) => {
      return executeDatabaseMaintenance({
        ...data,
        task: 'bloat_analysis',
        notifyOnSuccess: true,
      });
    },
    MaintenanceJobDataSchema
  );
  
  // Full maintenance - weekly
  register<MaintenanceJobData>(
    {
      name: 'db-maintenance-full',
      queue: 'database-maintenance',
      priority: 'low',
      maxRetries: 2,
      timeout: 900000, // 15 minutes
    },
    async (data) => {
      return executeDatabaseMaintenance({
        ...data,
        task: 'full_maintenance',
        thresholdPercent: 80,
        notifyOnSuccess: true,
      });
    },
    MaintenanceJobDataSchema
  );
  
  logger.info('Database maintenance jobs registered');
}

/**
 * Schedule recurring maintenance jobs
 */
export async function scheduleMaintenanceJobs(
  scheduleRecurring: (
    name: string,
    data: MaintenanceJobData,
    cron: string
  ) => Promise<void>
): Promise<void> {
  // Sequence check every 15 minutes
  await scheduleRecurring(
    'db-maintenance-sequence-check',
    { task: 'sequence_check' },
    '*/15 * * * *'
  );
  
  // Sequence alert daily at 9 AM
  await scheduleRecurring(
    'db-maintenance-sequence-alert',
    { task: 'sequence_alert' },
    '0 9 * * *'
  );
  
  // Vacuum high-churn every 6 hours
  await scheduleRecurring(
    'db-maintenance-vacuum-high-churn',
    { task: 'vacuum_high_churn' },
    '0 */6 * * *'
  );
  
  // Vacuum bloated daily at 2 AM
  await scheduleRecurring(
    'db-maintenance-vacuum-bloated',
    { task: 'vacuum_bloated' },
    '0 2 * * *'
  );
  
  // Bloat analysis weekly on Monday at 8 AM
  await scheduleRecurring(
    'db-maintenance-bloat-analysis',
    { task: 'bloat_analysis' },
    '0 8 * * 1'
  );
  
  // Full maintenance weekly on Sunday at 3 AM
  await scheduleRecurring(
    'db-maintenance-full',
    { task: 'full_maintenance' },
    '0 3 * * 0'
  );
  
  logger.info('Database maintenance jobs scheduled');
}
