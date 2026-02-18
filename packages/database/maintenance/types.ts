/**
 * Database Maintenance Types
 */

/** Sequence health information */
export interface SequenceHealth {
  sequence_name: string;
  data_type: string;
  start_value: number;
  // P2-6 FIX: PostgreSQL bigint sequences can reach 9223372036854775807 (2^63-1),
  // which exceeds Number.MAX_SAFE_INTEGER (2^53-1). Using string preserves full
  // precision as returned by the pg driver. Parse with BigInt() when arithmetic
  // is needed (e.g. utilization_percent calculation).
  current_value: string;
  max_value: string;
  utilization_percent: number;
  remaining_values: string;
  cycle_option: string;
  effective_max_value: string;
}

// P2-7 FIX: Unified AlertLevel type includes all states used across both
// SequenceAlert (which needs INFO) and SequenceUtilization (which needs OK).
// Previously AlertLevel was 'INFO'|'WARNING'|'CRITICAL' (missing 'OK') while
// SequenceUtilization had 'OK'|'WARNING'|'CRITICAL' (missing 'INFO'), making
// the types mutually incompatible. Now one canonical type covers all cases.
export type AlertLevel = 'OK' | 'INFO' | 'WARNING' | 'CRITICAL';

/** Sequence alert record */
export interface SequenceAlert {
  id: number;
  sequence_name: string;
  data_type: string;
  current_value: string;
  max_value: string;
  utilization_percent: number;
  threshold_percent: number;
  alert_level: AlertLevel;
  table_name?: string;
  column_name?: string;
  created_at: Date;
  acknowledged_at?: Date;
  acknowledged_by?: string;
  notes?: string;
}

/** Sequence utilization check result */
export interface SequenceUtilization {
  sequence_name: string;
  data_type: string;
  current_value: string;
  max_value: string;
  utilization_percent: number;
  alert_level: AlertLevel;
  remaining: string;
}

/** Sequence exhaustion estimate */
export interface SequenceExhaustionEstimate {
  sequence_name: string;
  current_value: number;
  max_value: number;
  daily_growth_rate: number;
  estimated_days_remaining: number | null;
  estimated_exhaustion_date: Date | null;
  recommended_action: string;
}

/** Vacuum statistics for a table */
export interface VacuumStatistics {
  schemaname: string;
  table_name: string;
  live_tuples: number;
  dead_tuples: number;
  dead_tuple_ratio: number;
  last_vacuum?: Date;
  last_autovacuum?: Date;
  last_analyze?: Date;
  last_autoanalyze?: Date;
  vacuum_count: number;
  autovacuum_count: number;
  analyze_count: number;
  autoanalyze_count: number;
}

/** Table bloat information */
export interface TableBloat {
  schemaname: string;
  table_name: string;
  total_size: string;
  table_size: string;
  indexes_size: string;
  n_live_tup: number;
  n_dead_tup: number;
  bloat_ratio: number;
  status: 'OK' | 'WARNING' | 'CRITICAL';
}

/** Maintenance operation log entry */
export interface MaintenanceLogEntry {
  id: number;
  table_name: string;
  operation: 'vacuum' | 'analyze' | 'reindex' | 'cluster';
  started_at: Date;
  completed_at?: Date;
  duration_ms?: number;
  dead_tuples_before?: number;
  dead_tuples_after?: number;
  table_size_before?: number;
  table_size_after?: number;
  success: boolean;
  error_message?: string;
  executed_by: string;
}

/** Maintenance operation options */
export interface MaintenanceOptions {
  /** Timeout in milliseconds */
  timeoutMs?: number;
  /** Whether to run operation concurrently */
  concurrently?: boolean;
  /** Whether to analyze after vacuum */
  analyze?: boolean;
  /** Full vacuum (locks table) */
  full?: boolean;
  /** Verbose output */
  verbose?: boolean;
}

/** Maintenance operation result */
export interface MaintenanceResult {
  success: boolean;
  operation: string;
  table_name: string;
  duration_ms: number;
  message: string;
  error?: Error;
}

/** Database configuration for a table */
export interface TableAutovacuumConfig {
  table_name: string;
  autovacuum_vacuum_scale_factor?: number;
  autovacuum_vacuum_threshold?: number;
  autovacuum_analyze_scale_factor?: number;
  autovacuum_analyze_threshold?: number;
  autovacuum_vacuum_cost_limit?: number;
  autovacuum_vacuum_cost_delay?: number;
}

/** Index usage statistics */
export interface IndexUsageStats {
  schemaname: string;
  tablename: string;
  indexname: string;
  index_size: string;
  idx_scan: number;
  idx_tup_read: number;
  idx_tup_fetch: number;
}

/** Connection pool statistics */
export interface ConnectionPoolStats {
  total_connections: number;
  active_connections: number;
  idle_connections: number;
  waiting_clients: number;
  max_connections: number;
  pool_utilization: number;
}
