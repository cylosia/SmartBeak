/**
 * Sequence Monitor Utility
 * 
 * Monitors database sequences for exhaustion risk.
 * Provides alerting at 80% utilization threshold.
 * 
 * @module @packages/database/maintenance/sequenceMonitor
 */

import type { Knex } from 'knex';
import type {
  SequenceHealth,
  SequenceAlert,
  SequenceUtilization,
  SequenceExhaustionEstimate,
} from './types';

/** Default threshold for sequence alerts (80%) */
const DEFAULT_THRESHOLD_PERCENT = 80;

/** Critical threshold for urgent action (95%) */
const CRITICAL_THRESHOLD_PERCENT = 95;

/**
 * Get health status for all database sequences
 */
export async function getSequenceHealth(knex: Knex): Promise<SequenceHealth[]> {
  const result = await knex.raw<{
    rows: SequenceHealth[];
  }>(`
    SELECT 
      sequence_name,
      data_type,
      start_value,
      current_value,
      max_value,
      utilization_percent,
      remaining_values,
      cycle_option,
      effective_max_value
    FROM v_sequence_health
  `);
  return result.rows;
}

/**
 * Get sequences with utilization above threshold
 */
export async function checkSequenceUtilization(
  knex: Knex,
  thresholdPercent: number = DEFAULT_THRESHOLD_PERCENT
): Promise<SequenceUtilization[]> {
  const result = await knex.raw<{
    rows: SequenceUtilization[];
  }>(`
    SELECT * FROM check_sequence_utilization(?)
  `, [thresholdPercent]);
  return result.rows;
}

/**
 * Get critical sequences requiring immediate attention
 */
export async function getCriticalSequences(
  knex: Knex
): Promise<Array<SequenceHealth & { requires_attention: boolean; risk_level: string }>> {
  const result = await knex.raw<{
    rows: Array<SequenceHealth & { requires_attention: boolean; risk_level: string }>;
  }>(`
    SELECT * FROM v_critical_sequences
  `);
  return result.rows;
}

/**
 * Generate new sequence alerts for sequences above threshold
 * @returns Number of new alerts created
 */
export async function generateSequenceAlerts(
  knex: Knex,
  thresholdPercent: number = DEFAULT_THRESHOLD_PERCENT
): Promise<number> {
  const result = await knex.raw<{
    rows: [{ generate_sequence_alerts: number }];
  }>(`
    SELECT generate_sequence_alerts(?) as generate_sequence_alerts
  `, [thresholdPercent]);
  return result.rows[0]?.generate_sequence_alerts ?? 0;
}

/**
 * Get all unacknowledged sequence alerts
 */
export async function getUnacknowledgedAlerts(
  knex: Knex,
  level?: 'WARNING' | 'CRITICAL'
): Promise<SequenceAlert[]> {
  let query = knex('sequence_monitoring_alerts')
    .whereNull('acknowledged_at')
    .orderBy('utilization_percent', 'desc');
  
  if (level) {
    query = query.where('alert_level', level);
  }
  
  return await query;
}

/**
 * Acknowledge a sequence alert
 */
export async function acknowledgeAlert(
  knex: Knex,
  alertId: number,
  acknowledgedBy: string,
  notes?: string
): Promise<boolean> {
  const result = await knex.raw<{
    rows: [{ acknowledge_sequence_alert: boolean }];
  }>(`
    SELECT acknowledge_sequence_alert(?, ?, ?) as acknowledge_sequence_alert
  `, [alertId, acknowledgedBy, notes ?? null]);
  return result.rows[0]?.acknowledge_sequence_alert ?? false;
}

/**
 * Estimate when a sequence will be exhausted
 */
export async function estimateSequenceExhaustion(
  knex: Knex,
  sequenceName: string,
  sampleDays: number = 30
): Promise<SequenceExhaustionEstimate | null> {
  const result = await knex.raw<{
    rows: SequenceExhaustionEstimate[];
  }>(`
    SELECT * FROM estimate_sequence_reset_date(?, ?)
  `, [sequenceName, sampleDays]);
  return result.rows[0] ?? null;
}

/**
 * Run complete sequence monitoring check
 * Generates alerts and returns current status
 */
export async function runSequenceMonitoring(
  knex: Knex,
  options: {
    thresholdPercent?: number;
    generateAlerts?: boolean;
  } = {}
): Promise<{
  checked_at: Date;
  threshold_percent: number;
  sequences_checked: number;
  critical_count: number;
  warning_count: number;
  alerts_generated: number;
  critical_sequences: SequenceUtilization[];
}> {
  const thresholdPercent = options.thresholdPercent ?? DEFAULT_THRESHOLD_PERCENT;
  const generateAlerts = options.generateAlerts ?? true;
  
  // Get all sequence health
  const allSequences = await getSequenceHealth(knex);
  
  // Check utilization
  const utilization = await checkSequenceUtilization(knex, thresholdPercent);
  
  // Generate alerts if enabled
  let alertsGenerated = 0;
  if (generateAlerts) {
    alertsGenerated = await generateSequenceAlerts(knex, thresholdPercent);
  }
  
  // Count by level
  const critical = utilization.filter(u => u.alert_level === 'CRITICAL');
  const warning = utilization.filter(u => u.alert_level === 'WARNING');
  
  return {
    checked_at: new Date(),
    threshold_percent: thresholdPercent,
    sequences_checked: allSequences.length,
    critical_count: critical.length,
    warning_count: warning.length,
    alerts_generated: alertsGenerated,
    critical_sequences: critical,
  };
}

/**
 * Check if any sequence is in critical state (>= 95%)
 */
export async function hasCriticalSequences(
  knex: Knex
): Promise<boolean> {
  const result = await knex.raw<{
    rows: [{ count: number }];
  }>(`
    SELECT COUNT(*) as count
    FROM v_sequence_health
    WHERE utilization_percent >= ?
  `, [CRITICAL_THRESHOLD_PERCENT]);
  return (result.rows[0]?.count ?? 0) > 0;
}

/**
 * Format sequence health for logging/monitoring
 */
export function formatSequenceHealth(
  health: SequenceHealth
): string {
  const status = health.utilization_percent >= CRITICAL_THRESHOLD_PERCENT
    ? '🔴 CRITICAL'
    : health.utilization_percent >= DEFAULT_THRESHOLD_PERCENT
    ? '🟡 WARNING'
    : '🟢 OK';
  
  return `[${status}] ${health.sequence_name}: ${health.utilization_percent.toFixed(2)}% ` +
    `(${health.current_value.toLocaleString()} / ${health.max_value.toLocaleString()})`;
}

/**
 * Format sequence alert for notifications
 */
export function formatSequenceAlert(
  alert: SequenceAlert
): string {
  const emoji = alert.alert_level === 'CRITICAL' ? '🚨' : '⚠️';
  return `${emoji} Sequence Alert: ${alert.sequence_name}\n` +
    `Level: ${alert.alert_level}\n` +
    `Utilization: ${alert.utilization_percent}%\n` +
    `Current Value: ${alert.current_value.toLocaleString()}\n` +
    `${alert.notes ?? ''}`;
}

/**
 * Create a scheduled monitoring job configuration
 * Returns cron expression and job details for scheduling
 */
export function getMonitoringSchedule(): {
  frequent: { cron: string; description: string };
  daily: { cron: string; description: string };
  weekly: { cron: string; description: string };
} {
  return {
    frequent: {
      cron: '*/15 * * * *', // Every 15 minutes
      description: 'High-frequency monitoring for critical sequences',
    },
    daily: {
      cron: '0 9 * * *', // 9 AM daily
      description: 'Daily sequence health check with alerting',
    },
    weekly: {
      cron: '0 9 * * 1', // Monday 9 AM
      description: 'Weekly comprehensive sequence report',
    },
  };
}
