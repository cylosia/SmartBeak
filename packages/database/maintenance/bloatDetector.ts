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
import { getLogger } from '@kernel/logger';

const logger = getLogger('bloatDetector');

// P0-FIX (P0-5): Maximum wall-clock time for any single maintenance query.
// Without this, a query on a very large pg_stat_user_indexes or db_table_bloat
// view can run for hours, holding a connection and blocking the entire pool.
const BLOAT_QUERY_TIMEOUT_MS = 30_000; // 30 seconds

/**
 * Set a session-level statement timeout and return it so callers can reset it.
 * Using SET LOCAL scopes the timeout to the current transaction only (safer).
 */
async function withStatementTimeout<T>(knex: Knex, fn: () => Promise<T>): Promise<T> {
  await knex.raw('SET LOCAL statement_timeout = ?', [BLOAT_QUERY_TIMEOUT_MS]);
  return fn();
}

/**
 * Get bloat information for all tables
 */
export async function getTableBloat(
  knex: Knex
): Promise<TableBloat[]> {
  return knex.transaction(trx =>
    withStatementTimeout(trx, async () => {
      const result = await trx.raw<{ rows: TableBloat[] }>(`
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
    })
  );
}

/**
 * Get critical bloat (WARNING or CRITICAL status)
 */
export async function getCriticalBloat(
  knex: Knex
): Promise<TableBloat[]> {
  return knex.transaction(trx =>
    withStatementTimeout(trx, async () => {
      const result = await trx.raw<{ rows: TableBloat[] }>(`
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
    })
  );
}

/**
 * Get bloat for a specific table
 */
export async function getTableBloatByName(
  knex: Knex,
  tableName: string
): Promise<TableBloat | null> {
  return knex.transaction(trx =>
    withStatementTimeout(trx, async () => {
      const result = await trx.raw<{ rows: TableBloat[] }>(`
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
    })
  );
}

/**
 * Get index usage statistics
 */
export async function getIndexUsageStats(
  knex: Knex
): Promise<IndexUsageStats[]> {
  return knex.transaction(trx =>
    withStatementTimeout(trx, async () => {
      const result = await trx.raw<{
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
    })
  );
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
  if (!Number.isInteger(minAgeDays) || minAgeDays < 0 || minAgeDays > 365) {
    throw new Error('minAgeDays must be an integer between 0 and 365');
  }

  // P2-FIX: pg_class does not have a 'relcreationdate' column in standard PostgreSQL.
  // Use pg_stat_user_tables stats_reset as a proxy for table age, or filter on
  // last_idx_scan instead. Here we use the index scan count + pg_stat_user_tables
  // last_analyze time as a reasonable proxy for index staleness.
  return knex.transaction(trx =>
    withStatementTimeout(trx, async () => {
      const result = await trx.raw<{ rows: UnusedIndexInfo[] }>(`
        SELECT
          s.schemaname,
          s.relname as tablename,
          s.indexrelname as indexname,
          pg_size_pretty(pg_relation_size(s.indexrelid)) as index_size,
          s.idx_scan,
          -- P2-FIX: Use 9999 as sentinel for never-analyzed tables instead of 0.
          -- COALESCE(..., 0) made a table that was never analyzed appear to be
          -- 0 days old, causing DBA tooling to treat ancient unused indexes as
          -- recently created and skip dropping them.
          COALESCE(EXTRACT(DAY FROM NOW() - st.last_analyze), 9999)::int as index_age_days
        FROM pg_stat_user_indexes s
        JOIN pg_index i ON s.indexrelid = i.indexrelid
        LEFT JOIN pg_stat_user_tables st ON s.relid = st.relid
        WHERE s.schemaname = 'public'
          AND s.idx_scan = 0
          AND NOT i.indisunique
          AND NOT i.indisprimary
          AND (st.last_analyze IS NULL OR st.last_analyze < NOW() - (? * INTERVAL '1 day'))
        ORDER BY pg_relation_size(s.indexrelid) DESC
      `, [minAgeDays]);
      return result.rows;
    })
  );
}

/**
 * Get duplicate indexes (same columns, different names)
 */
export async function getDuplicateIndexes(
  knex: Knex
): Promise<Array<{
  tablename: string;
  // P2-FIX (P2-7): array_agg()::text returns SQL NULL when the aggregation
  // produces an empty set. The previous type (string) caused runtime surprises
  // when callers tried to split or pattern-match on the value.
  index_columns: string | null;
  indexes: string;
  total_size: string;
}>> {
  return knex.transaction(trx =>
    withStatementTimeout(trx, async () => {
      const result = await trx.raw<{
        rows: Array<{
          tablename: string;
          index_columns: string | null;
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
    })
  );
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
    // Get indexes for table — scoped timeout applies to this lookup
    const indexes = await knex.transaction(trx =>
      withStatementTimeout(trx, () =>
        trx.raw<{ rows: Array<{ indexname: string }> }>(`
          SELECT indexname
          FROM pg_indexes
          WHERE tablename = ? AND schemaname = 'public'
        `, [tableName])
      )
    );

    // REINDEX CONCURRENTLY cannot run inside a transaction, so we cannot use
    // SET LOCAL. Instead, acquire a dedicated connection for each index so that
    // SET statement_timeout and REINDEX share one session — and that session is
    // destroyed afterwards, guaranteeing the timeout never leaks into the pool.
    //
    // P2-FIX (P2-6): The previous implementation called knex.raw() three times
    // (SET / REINDEX / RESET). Each knex.raw() acquires a DIFFERENT connection
    // from Knex's pool: SET ran on connection A (setting its timeout), REINDEX
    // ran on connection B (no timeout applied!), and RESET ran on connection C.
    // Additionally, if REINDEX threw between SET and RESET, connection A was
    // returned to the pool with the 30-s cap still active.
    const kClient = knex.client as {
      acquireConnection(): Promise<unknown>;
      query(conn: unknown, obj: { sql: string; bindings: unknown[] }): Promise<unknown>;
      destroyRawConnection(conn: unknown): Promise<void>;
    };

    for (const { indexname } of indexes.rows) {
      const conn = await kClient.acquireConnection();
      try {
        await kClient.query(conn, {
          sql: 'SET statement_timeout = ?',
          bindings: [BLOAT_QUERY_TIMEOUT_MS],
        });
        await kClient.query(conn, {
          sql: 'REINDEX INDEX CONCURRENTLY ??',
          bindings: [indexname],
        });
      } finally {
        // Destroy (not release) so the session-scoped SET doesn't leak back.
        await kClient.destroyRawConnection(conn).catch(() => { /* best effort */ });
      }
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
    // P2-FIX (P2-9): Log the error so DBAs can diagnose reindex failures.
    // Previously the catch block swallowed the error silently.
    logger.error('reindexTable failed', error instanceof Error ? error : new Error(String(error)), { tableName });

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
  // Split on whitespace to avoid nested quantifiers in regex (ReDoS)
  const sizeParts = bloat.indexes_size.trim().split(/\s+/);
  const sizeStr = sizeParts[0];
  const unit = sizeParts[1];
  if (sizeStr && unit && /^\d+\.?\d*$/.test(sizeStr)) {
    const size = parseFloat(sizeStr);
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
  const totalBloatRatio = allBloat.length > 0
    ? allBloat.reduce((sum, b) => sum + b.bloat_ratio, 0) / allBloat.length
    : 0;
  
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
  // P3-FIX (P3-1): Use text indicators instead of emoji — emoji can corrupt
  // log aggregators and monitoring systems that don't handle UTF-8 emoji ranges.
  const status = bloat.status === 'CRITICAL'
    ? '[CRITICAL]'
    : bloat.status === 'WARNING'
    ? '[WARNING]'
    : '[OK]';
  
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
    return '[OK] Database bloat check: All tables healthy';
  }

  let message = `[ALERT] Database Bloat Report\n\n`;
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
