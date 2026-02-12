/**
 * Vacuum Manager Utility
 *
 * Manages vacuum and analyze operations for database tables.
 * Provides utilities for maintenance scheduling and bloat prevention.
 *
 * @module @packages/database/maintenance/vacuumManager
 */

import type { Knex } from 'knex';
import type {
  VacuumStatistics,
  MaintenanceResult,
  MaintenanceOptions,
  TableAutovacuumConfig,
} from './types';

/** Default timeout for maintenance operations (5 minutes) */
const DEFAULT_TIMEOUT_MS = 300000;

/** High-churn tables requiring frequent vacuum */
const HIGH_CHURN_TABLES = [
  'audit_events',
  'analytics_events',
  'job_executions',
  'notifications',
  'publishing_jobs',
  'publish_attempts',
];

/** Medium-churn tables */
const MEDIUM_CHURN_TABLES = [
  'content',
  'content_items',
  'email_subscribers',
  'media_assets',
];

// P0-3 FIX: Strict allowlist regex for table names to prevent SQL injection
// Only lowercase letters, digits, and underscores allowed
const TABLE_NAME_REGEX = /^[a-z_][a-z0-9_]*$/;

/**
 * P0-3 FIX: Validate table name against strict allowlist pattern
 * Prevents SQL injection via table name manipulation in raw VACUUM/ANALYZE commands
 */
function validateTableName(tableName: string): void {
  if (!tableName || typeof tableName !== 'string') {
    throw new Error('Table name is required and must be a string');
  }
  if (tableName.length > 63) {
    throw new Error('Table name exceeds PostgreSQL maximum identifier length');
  }
  if (!TABLE_NAME_REGEX.test(tableName)) {
    throw new Error(`Invalid table name format: ${tableName}. Only lowercase alphanumeric and underscores allowed.`);
  }
}

/**
 * P0-2 FIX: Validate numeric config value at runtime
 * TypeScript types are erased at runtime; this ensures values are actually finite numbers
 */
function validateNumericConfig(name: string, value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid numeric value for ${name}: ${String(value)}`);
  }
  return num;
}

/**
 * P1-10 FIX: Set statement timeout for maintenance operations
 * Prevents runaway VACUUM FULL from holding AccessExclusiveLock indefinitely
 */
async function withStatementTimeout(
  knex: Knex,
  timeoutMs: number,
  fn: () => Promise<void>
): Promise<void> {
  await knex.raw('SET statement_timeout = ?', [timeoutMs]);
  try {
    await fn();
  } finally {
    await knex.raw('RESET statement_timeout');
  }
}

/**
 * Get vacuum statistics for all tables
 */
export async function getVacuumStatistics(
  knex: Knex
): Promise<VacuumStatistics[]> {
  const result = await knex.raw<{
    rows: VacuumStatistics[];
  }>(`
    SELECT
      schemaname,
      relname as table_name,
      n_live_tup as live_tuples,
      n_dead_tup as dead_tuples,
      dead_tuple_ratio,
      last_vacuum,
      last_autovacuum,
      last_analyze,
      last_autoanalyze,
      vacuum_count,
      autovacuum_count,
      analyze_count,
      autoanalyze_count
    FROM db_vacuum_statistics
  `);
  return result.rows;
}

/**
 * Get vacuum statistics for a specific table
 */
export async function getTableVacuumStats(
  knex: Knex,
  tableName: string
): Promise<VacuumStatistics | null> {
  const result = await knex.raw<{
    rows: VacuumStatistics[];
  }>(`
    SELECT
      schemaname,
      relname as table_name,
      n_live_tup as live_tuples,
      n_dead_tup as dead_tuples,
      dead_tuple_ratio,
      last_vacuum,
      last_autovacuum,
      last_analyze,
      last_autoanalyze,
      vacuum_count,
      autovacuum_count,
      analyze_count,
      autoanalyze_count
    FROM db_vacuum_statistics
    WHERE relname = ?
  `, [tableName]);
  return result.rows[0] ?? null;
}

/**
 * Run VACUUM ANALYZE on a table
 * Note: This runs outside a transaction
 */
export async function vacuumAnalyzeTable(
  knex: Knex,
  tableName: string,
  options: MaintenanceOptions = {}
): Promise<MaintenanceResult> {
  // P0-3 FIX: Validate table name before building raw SQL command
  validateTableName(tableName);

  const startTime = Date.now();
  const full = options.full ?? false;
  const verbose = options.verbose ?? false;

  try {
    // Get before stats
    const beforeStats = await getTableVacuumStats(knex, tableName);

    // Build vacuum command using validated identifier
    const vacuumCmd = [
      full ? 'VACUUM FULL' : 'VACUUM',
      verbose ? 'VERBOSE' : '',
      options.analyze !== false ? 'ANALYZE' : '',
      knex.raw('??', [tableName]).toString(),
    ].filter(Boolean).join(' ');

    // P1-10 FIX: Execute vacuum with statement timeout to prevent runaway locks
    await withStatementTimeout(knex, DEFAULT_TIMEOUT_MS, async () => {
      await knex.raw(vacuumCmd);
    });

    // Get after stats
    const afterStats = await getTableVacuumStats(knex, tableName);

    const duration = Date.now() - startTime;

    // Log maintenance
    await logMaintenanceOperation(knex, {
      table_name: tableName,
      operation: 'vacuum',
      duration_ms: duration,
      dead_tuples_before: beforeStats?.dead_tuples ?? undefined,
      dead_tuples_after: afterStats?.dead_tuples ?? undefined,
      success: true,
    });

    return {
      success: true,
      operation: full ? 'VACUUM FULL' : 'VACUUM ANALYZE',
      table_name: tableName,
      duration_ms: duration,
      message: `Vacuum completed. Dead tuples: ${beforeStats?.dead_tuples ?? 'N/A'} → ${afterStats?.dead_tuples ?? 'N/A'}`,
    };
  } catch (error) {
    const duration = Date.now() - startTime;

    await logMaintenanceOperation(knex, {
      table_name: tableName,
      operation: 'vacuum',
      duration_ms: duration,
      success: false,
      error_message: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      operation: 'VACUUM',
      table_name: tableName,
      duration_ms: duration,
      message: `Vacuum failed: ${error instanceof Error ? error.message : String(error)}`,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * Run ANALYZE on a table (updates statistics)
 */
export async function analyzeTable(
  knex: Knex,
  tableName: string,
  options: Pick<MaintenanceOptions, 'verbose'> = {}
): Promise<MaintenanceResult> {
  // P0-3 FIX: Validate table name before building raw SQL command
  validateTableName(tableName);

  const startTime = Date.now();
  const verbose = options.verbose ?? false;

  try {
    const analyzeCmd = [
      'ANALYZE',
      verbose ? 'VERBOSE' : '',
      knex.raw('??', [tableName]).toString(),
    ].filter(Boolean).join(' ');

    // P1-10 FIX: Execute with statement timeout
    await withStatementTimeout(knex, DEFAULT_TIMEOUT_MS, async () => {
      await knex.raw(analyzeCmd);
    });

    const duration = Date.now() - startTime;

    await logMaintenanceOperation(knex, {
      table_name: tableName,
      operation: 'analyze',
      duration_ms: duration,
      success: true,
    });

    return {
      success: true,
      operation: 'ANALYZE',
      table_name: tableName,
      duration_ms: duration,
      message: 'Statistics updated successfully',
    };
  } catch (error) {
    const duration = Date.now() - startTime;

    return {
      success: false,
      operation: 'ANALYZE',
      table_name: tableName,
      duration_ms: duration,
      message: `Analyze failed: ${error instanceof Error ? error.message : String(error)}`,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * Vacuum all high-churn tables
 */
export async function vacuumHighChurnTables(
  knex: Knex,
  options: MaintenanceOptions = {}
): Promise<MaintenanceResult[]> {
  const results: MaintenanceResult[] = [];

  for (const table of HIGH_CHURN_TABLES) {
    const result = await vacuumAnalyzeTable(knex, table, options);
    results.push(result);
  }

  return results;
}

/**
 * Get tables needing vacuum based on dead tuple ratio
 */
export async function getTablesNeedingVacuum(
  knex: Knex,
  minDeadTupleRatio: number = 10
): Promise<Array<{ table_name: string; dead_tuple_ratio: number; dead_tuples: number }>> {
  const result = await knex.raw<{
    rows: Array<{ table_name: string; dead_tuple_ratio: number; dead_tuples: number }>;
  }>(`
    SELECT
      relname as table_name,
      dead_tuple_ratio,
      n_dead_tup as dead_tuples
    FROM db_vacuum_statistics
    WHERE dead_tuple_ratio >= ?
      OR n_dead_tup > 10000
    ORDER BY dead_tuple_ratio DESC
  `, [minDeadTupleRatio]);
  return result.rows;
}

/**
 * Log a maintenance operation
 */
async function logMaintenanceOperation(
  knex: Knex,
  data: {
    table_name: string;
    operation: 'vacuum' | 'analyze' | 'reindex' | 'cluster';
    duration_ms: number;
    dead_tuples_before?: number | undefined;
    dead_tuples_after?: number | undefined;
    table_size_before?: number | undefined;
    table_size_after?: number | undefined;
    success: boolean;
    error_message?: string | undefined;
  }
): Promise<void> {
  try {
    await knex('db_maintenance_log').insert({
      ...data,
      completed_at: new Date(),
    });
  } catch (err) {
    // P1-9 FIX: Log failure instead of silently swallowing
    // eslint-disable-next-line no-console
    console.error('[vacuumManager] Failed to log maintenance operation:', err instanceof Error ? err.message : String(err));
  }
}

/**
 * Get autovacuum configuration for a table
 */
export async function getTableAutovacuumConfig(
  knex: Knex,
  tableName: string
): Promise<TableAutovacuumConfig | null> {
  const result = await knex.raw<{
    rows: Array<{
      relname: string;
      reloptions: string[] | null;
    }>;
  }>(`
    SELECT
      relname,
      reloptions
    FROM pg_class
    WHERE relname = ?
      AND relkind = 'r'
  `, [tableName]);

  if (!result.rows[0]) return null;

  // Parse reloptions array
  const options = result.rows[0].reloptions ?? [];
  const config: TableAutovacuumConfig = { table_name: tableName };

  for (const option of options) {
    const [key, value] = option.split('=');
    if (value === undefined) continue;
    switch (key) {
      case 'autovacuum_vacuum_scale_factor':
        config.autovacuum_vacuum_scale_factor = parseFloat(value);
        break;
      case 'autovacuum_vacuum_threshold':
        config.autovacuum_vacuum_threshold = parseInt(value, 10);
        break;
      case 'autovacuum_analyze_scale_factor':
        config.autovacuum_analyze_scale_factor = parseFloat(value);
        break;
      case 'autovacuum_analyze_threshold':
        config.autovacuum_analyze_threshold = parseInt(value, 10);
        break;
      case 'autovacuum_vacuum_cost_limit':
        config.autovacuum_vacuum_cost_limit = parseInt(value, 10);
        break;
      case 'autovacuum_vacuum_cost_delay':
        config.autovacuum_vacuum_cost_delay = parseInt(value, 10);
        break;
    }
  }

  return config;
}

/**
 * Set autovacuum configuration for a table
 */
export async function setTableAutovacuumConfig(
  knex: Knex,
  tableName: string,
  config: Partial<Omit<TableAutovacuumConfig, 'table_name'>>
): Promise<void> {
  // P0-3 FIX: Validate table name
  validateTableName(tableName);

  // P0-2 FIX: Use parameterized values with runtime numeric validation
  // to prevent SQL injection via config values interpolated into ALTER TABLE
  const options: string[] = [];
  const values: number[] = [];

  if (config.autovacuum_vacuum_scale_factor !== undefined) {
    const val = validateNumericConfig('autovacuum_vacuum_scale_factor', config.autovacuum_vacuum_scale_factor);
    options.push('autovacuum_vacuum_scale_factor = ?');
    values.push(val);
  }
  if (config.autovacuum_vacuum_threshold !== undefined) {
    const val = validateNumericConfig('autovacuum_vacuum_threshold', config.autovacuum_vacuum_threshold);
    options.push('autovacuum_vacuum_threshold = ?');
    values.push(val);
  }
  if (config.autovacuum_analyze_scale_factor !== undefined) {
    const val = validateNumericConfig('autovacuum_analyze_scale_factor', config.autovacuum_analyze_scale_factor);
    options.push('autovacuum_analyze_scale_factor = ?');
    values.push(val);
  }
  if (config.autovacuum_analyze_threshold !== undefined) {
    const val = validateNumericConfig('autovacuum_analyze_threshold', config.autovacuum_analyze_threshold);
    options.push('autovacuum_analyze_threshold = ?');
    values.push(val);
  }
  if (config.autovacuum_vacuum_cost_limit !== undefined) {
    const val = validateNumericConfig('autovacuum_vacuum_cost_limit', config.autovacuum_vacuum_cost_limit);
    options.push('autovacuum_vacuum_cost_limit = ?');
    values.push(val);
  }
  if (config.autovacuum_vacuum_cost_delay !== undefined) {
    const val = validateNumericConfig('autovacuum_vacuum_cost_delay', config.autovacuum_vacuum_cost_delay);
    options.push('autovacuum_vacuum_cost_delay = ?');
    values.push(val);
  }

  if (options.length === 0) return;

  await knex.raw(
    `ALTER TABLE ?? SET (${options.join(', ')})`,
    [tableName, ...values]
  );
}

/**
 * Run comprehensive vacuum maintenance
 */
export async function runVacuumMaintenance(
  knex: Knex,
  options: {
    minDeadTupleRatio?: number;
    includeHighChurn?: boolean;
    dryRun?: boolean;
  } = {}
): Promise<{
  checked_at: Date;
  tables_checked: number;
  tables_needing_vacuum: number;
  results: MaintenanceResult[];
}> {
  const minRatio = options.minDeadTupleRatio ?? 10;
  const includeHighChurn = options.includeHighChurn ?? true;
  const dryRun = options.dryRun ?? false;

  // Get tables needing vacuum
  const tablesNeedingVacuum = await getTablesNeedingVacuum(knex, minRatio);

  // Add high-churn tables if requested
  const tablesToVacuum = new Set(tablesNeedingVacuum.map(t => t.table_name));
  if (includeHighChurn) {
    HIGH_CHURN_TABLES.forEach(t => tablesToVacuum.add(t));
  }

  const results: MaintenanceResult[] = [];

  if (!dryRun) {
    for (const table of Array.from(tablesToVacuum)) {
      // P0-3 FIX: Validate dynamically-sourced table names from db_vacuum_statistics
      try {
        validateTableName(table);
      } catch {
        // eslint-disable-next-line no-console
        console.error(`[vacuumManager] Skipping table with invalid name from db_vacuum_statistics: ${table}`);
        continue;
      }
      const result = await vacuumAnalyzeTable(knex, table);
      results.push(result);
    }
  }

  return {
    checked_at: new Date(),
    tables_checked: (await getVacuumStatistics(knex)).length,
    tables_needing_vacuum: tablesNeedingVacuum.length,
    results,
  };
}

/**
 * Format vacuum statistics for logging
 */
export function formatVacuumStats(stats: VacuumStatistics): string {
  const status = stats.dead_tuple_ratio >= 30
    ? 'CRITICAL'
    : stats.dead_tuple_ratio >= 15
    ? 'WARNING'
    : 'OK';

  const lastVacuum = stats.last_autovacuum ?? stats.last_vacuum;
  const lastVacuumStr = lastVacuum
    ? new Date(lastVacuum).toLocaleDateString()
    : 'Never';

  return `[${status}] ${stats.table_name}: ${stats.dead_tuple_ratio.toFixed(2)}% dead tuples ` +
    `(${stats.dead_tuples.toLocaleString()} / ${stats.live_tuples.toLocaleString()}) ` +
    `- Last vacuum: ${lastVacuumStr}`;
}

/**
 * Get recommended vacuum schedule
 */
export function getVacuumSchedule(): {
  high_churn: { cron: string; tables: string[] };
  medium_churn: { cron: string; tables: string[] };
  analyze_all: { cron: string; description: string };
} {
  return {
    high_churn: {
      cron: '0 */6 * * *', // Every 6 hours
      tables: HIGH_CHURN_TABLES,
    },
    medium_churn: {
      cron: '0 2 * * *', // Daily at 2 AM
      tables: MEDIUM_CHURN_TABLES,
    },
    analyze_all: {
      cron: '0 3 * * 0', // Weekly on Sunday at 3 AM
      description: 'Analyze all tables for query planner statistics',
    },
  };
}
