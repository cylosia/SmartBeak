/**
 * Bloat Detector Utility
 * 
 * Detects and reports table and index bloat.
 * Provides recommendations for maintenance operations.
 * 
 * @module @packages/database/maintenance/bloatDetector
 */

import type { Knex } from 'knex';
import type { TableBloat, IndexUsageStats, MaintenanceResult } from './types';

/** Bloat ratio thresholds */
const BLOAT_THRESHOLDS = {
  CRITICAL: 0.30, // 30% bloat
  WARNING: 0.15,  // 15% bloat
};

/** Minimum dead tuples to consider for critical status */
const MIN_DEAD_TUPLES_CRITICAL = 10000;
const MIN_DEAD_TUPLES_WARNING = 5000;

/**
 * Get bloat information for all tables
 */
export async function getTableBloat(
  knex: Knex
): Promise<TableBloat[]> {
  const result = await knex.raw<{
    rows: TableBloat[];
  }>(`
    SELECT 
      schemaname,
      table_name,
      total_size,
      table_size,
      indexes_size,
      n_live_tup,
      n_dead_tup,
      bloat_ratio,
      status
    FROM db_table_bloat
  `);
  return result.rows;
}

/**
 * Get critical bloat (WARNING or CRITICAL status)
 */
export async function getCriticalBloat(
  knex: Knex
): Promise<TableBloat[]> {
  const result = await knex.raw<{
    rows: TableBloat[];
  }>(`
    SELECT 
      schemaname,
      table_name,
      total_size,
      table_size,
      indexes_size,
      n_live_tup,
      n_dead_tup,
      bloat_ratio,
      status
    FROM db_table_bloat
    WHERE status != 'OK'
    ORDER BY bloat_ratio DESC
  `);
  return result.rows;
}

/**
 * Get bloat for a specific table
 */
export async function getTableBloatByName(
  knex: Knex,
  tableName: string
): Promise<TableBloat | null> {
  const result = await knex.raw<{
    rows: TableBloat[];
  }>(`
    SELECT 
      schemaname,
      table_name,
      total_size,
      table_size,
      indexes_size,
      n_live_tup,
      n_dead_tup,
      bloat_ratio,
      status
    FROM db_table_bloat
    WHERE table_name = ?
  `, [tableName]);
  return result.rows[0] ?? null;
}

/**
 * Get index usage statistics
 */
export async function getIndexUsageStats(
  knex: Knex
): Promise<IndexUsageStats[]> {
  const result = await knex.raw<{
    rows: Array<{
      schemaname: string;
      tablename: string;
      indexname: string;
      index_size: string;
      idx_scan: number;
      idx_tup_read: number;
      idx_tup_fetch: number;
    }>;
  }>(`
    SELECT 
      schemaname,
      tablename,
      indexname,
      pg_size_pretty(pg_relation_size(indexrelid)) as index_size,
      idx_scan,
      idx_tup_read,
      idx_tup_fetch
    FROM pg_stat_user_indexes
    WHERE schemaname = 'public'
    ORDER BY pg_relation_size(indexrelid) DESC
  `);
  return result.rows;
}

/** Unused index info */
export interface UnusedIndexInfo {
  schemaname: string;
  tablename: string;
  indexname: string;
  index_size: string;
  idx_scan: number;
  index_age_days: number;
}

/**
 * Get unused indexes (candidates for removal)
 */
export async function getUnusedIndexes(
  knex: Knex,
  minAgeDays: number = 7
): Promise<UnusedIndexInfo[]> {
  const result = await knex.raw<{
    rows: UnusedIndexInfo[];
  }>(`
    SELECT 
      s.schemaname,
      s.relname as tablename,
      s.indexrelname as indexname,
      pg_size_pretty(pg_relation_size(s.indexrelid)) as index_size,
      s.idx_scan,
      EXTRACT(DAY FROM NOW() - ci.relcreationdate)::int as index_age_days
    FROM pg_stat_user_indexes s
    JOIN pg_index i ON s.indexrelid = i.indexrelid
    JOIN pg_class ci ON s.indexrelid = ci.oid
    WHERE s.schemaname = 'public'
      AND s.idx_scan = 0
      AND NOT i.indisunique
      AND NOT i.indisprimary
      AND ci.relcreationdate < NOW() - INTERVAL '${minAgeDays} days'
    ORDER BY pg_relation_size(s.indexrelid) DESC
  `);
  return result.rows;
}

/**
 * Get duplicate indexes (same columns, different names)
 */
export async function getDuplicateIndexes(
  knex: Knex
): Promise<Array<{
  tablename: string;
  index_columns: string;
  indexes: string;
  total_size: string;
}>> {
  const result = await knex.raw<{
    rows: Array<{
      tablename: string;
      index_columns: string;
      indexes: string;
      total_size: string;
    }>;
  }>(`
    SELECT 
      t.tablename,
      array_agg(a.attname ORDER BY array_position(i.indkey, a.attnum))::text as index_columns,
      string_agg(i.relname, ', ') as indexes,
      pg_size_pretty(sum(pg_relation_size(i.oid))) as total_size
    FROM pg_index ix
    JOIN pg_class i ON ix.indexrelid = i.oid
    JOIN pg_class t ON ix.indrelid = t.oid
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
    WHERE t.relkind = 'r'
      AND NOT ix.indisunique
      AND NOT ix.indisprimary
    GROUP BY t.tablename, ix.indkey
    HAVING count(*) > 1
  `);
  return result.rows;
}

/**
 * Reindex a table (concurrently to avoid locks)
 */
export async function reindexTable(
  knex: Knex,
  tableName: string
): Promise<MaintenanceResult> {
  const startTime = Date.now();
  
  try {
    // Get indexes for table
    const indexes = await knex.raw<{
      rows: Array<{ indexname: string }>;
    }>(`
      SELECT indexname 
      FROM pg_indexes 
      WHERE tablename = ? AND schemaname = 'public'
    `, [tableName]);
    
    // Reindex each index concurrently
    for (const { indexname } of indexes.rows) {
      await knex.raw('REINDEX INDEX CONCURRENTLY ??', [indexname]);
    }
    
    const duration = Date.now() - startTime;
    
    return {
      success: true,
      operation: 'REINDEX CONCURRENTLY',
      table_name: tableName,
      duration_ms: duration,
      message: `Reindexed ${indexes.rows.length} indexes`,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    
    return {
      success: false,
      operation: 'REINDEX',
      table_name: tableName,
      duration_ms: duration,
      message: `Reindex failed: ${error instanceof Error ? error.message : String(error)}`,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * Get bloat recommendations for a table
 */
export function getBloatRecommendations(
  bloat: TableBloat
): string[] {
  const recommendations: string[] = [];
  
  if (bloat.status === 'CRITICAL') {
    recommendations.push(
      `URGENT: Table ${bloat.table_name} has ${bloat.bloat_ratio.toFixed(1)}% bloat. ` +
      `Consider VACUUM FULL during maintenance window.`
    );
  } else if (bloat.status === 'WARNING') {
    recommendations.push(
      `Table ${bloat.table_name} has ${bloat.bloat_ratio.toFixed(1)}% bloat. ` +
      `Schedule VACUUM ANALYZE during off-peak hours.`
    );
  }
  
  // Check index bloat (estimated from index size)
  const indexSizeMatch = bloat.indexes_size.match(/^(\d+(?:\.\d+)?)\s*(\w+)$/);
  if (indexSizeMatch) {
    const size = parseFloat(indexSizeMatch[1]!);
    const unit = indexSizeMatch[2]!;
    const sizeInMB = unit === 'GB' ? size * 1024 : unit === 'KB' ? size / 1024 : size;
    
    if (sizeInMB > 1000) { // Over 1GB in indexes
      recommendations.push(
        `Consider REINDEX for ${bloat.table_name} - indexes are ${bloat.indexes_size}`
      );
    }
  }
  
  return recommendations;
}

/**
 * Run comprehensive bloat analysis
 */
export async function runBloatAnalysis(
  knex: Knex
): Promise<{
  checked_at: Date;
  total_tables: number;
  critical_count: number;
  warning_count: number;
  total_bloat_ratio: number;
  recommendations: string[];
  critical_tables: TableBloat[];
}> {
  const allBloat = await getTableBloat(knex);
  const critical = allBloat.filter(b => b.status === 'CRITICAL');
  const warning = allBloat.filter(b => b.status === 'WARNING');
  
  // Calculate average bloat ratio
  const totalBloatRatio = allBloat.reduce((sum, b) => sum + b.bloat_ratio, 0) / allBloat.length;
  
  // Generate recommendations
  const recommendations: string[] = [];
  for (const table of [...critical, ...warning]) {
    recommendations.push(...getBloatRecommendations(table));
  }
  
  // Check for unused indexes
  const unusedIndexes = await getUnusedIndexes(knex, 7);
  if (unusedIndexes.length > 0) {
    recommendations.push(
      `Found ${unusedIndexes.length} unused indexes older than 7 days. ` +
      `Consider removing them to save space.`
    );
  }
  
  return {
    checked_at: new Date(),
    total_tables: allBloat.length,
    critical_count: critical.length,
    warning_count: warning.length,
    total_bloat_ratio: totalBloatRatio,
    recommendations,
    critical_tables: critical,
  };
}

/**
 * Format bloat information for logging
 */
export function formatBloatInfo(bloat: TableBloat): string {
  const status = bloat.status === 'CRITICAL' 
    ? '🔴 CRITICAL' 
    : bloat.status === 'WARNING' 
    ? '🟡 WARNING' 
    : '🟢 OK';
  
  return `[${status}] ${bloat.table_name}: ${bloat.bloat_ratio.toFixed(2)}% bloat ` +
    `(Size: ${bloat.total_size}, Dead: ${bloat.n_dead_tup.toLocaleString()})`;
}

/**
 * Create bloat alert message for notifications
 */
export function createBloatAlertMessage(
  analysis: Awaited<ReturnType<typeof runBloatAnalysis>>
): string {
  if (analysis.critical_count === 0 && analysis.warning_count === 0) {
    return '✅ Database bloat check: All tables healthy';
  }
  
  let message = `⚠️ Database Bloat Report\n\n`;
  message += `Critical: ${analysis.critical_count} tables\n`;
  message += `Warning: ${analysis.warning_count} tables\n`;
  message += `Average Bloat: ${analysis.total_bloat_ratio.toFixed(2)}%\n\n`;
  
  if (analysis.critical_tables.length > 0) {
    message += `Critical Tables:\n`;
    for (const table of analysis.critical_tables.slice(0, 5)) {
      message += `  - ${table.table_name}: ${table.bloat_ratio.toFixed(1)}%\n`;
    }
  }
  
  if (analysis.recommendations.length > 0) {
    message += `\nRecommendations:\n`;
    for (const rec of analysis.recommendations.slice(0, 3)) {
      message += `  • ${rec}\n`;
    }
  }
  
  return message;
}
