/**
 * Query Plan Analysis Utilities
 * 
 * P2 OPTIMIZATION: Provides query plan analysis and optimization recommendations:
 * - EXPLAIN plan analysis
 * - Index recommendations
 * - Slow query detection
 * - Query optimization hints
 */

import type { Pool, QueryResult } from 'pg';
import { getLogger } from '@kernel/logger';

const logger = getLogger('query-plan');

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface QueryPlanNode {
  'Node Type': string;
  'Parallel Aware': boolean;
  'Async Capable': boolean;
  'Relation Name'?: string;
  'Schema'?: string;
  'Alias'?: string;
  'Startup Cost': number;
  'Total Cost': number;
  'Plan Rows': number;
  'Plan Width': number;
  'Actual Startup Time'?: number;
  'Actual Total Time'?: number;
  'Actual Rows'?: number;
  'Actual Loops'?: number;
  'Index Name'?: string;
  'Index Cond'?: string;
  'Filter'?: string;
  'Rows Removed by Filter'?: number;
  'Plans'?: QueryPlanNode[];
  [key: string]: unknown;
}

export interface QueryPlan {
  query: string;
  plan: QueryPlanNode[];
  planningTime: number;
  executionTime: number;
  triggers: unknown[];
}

export interface PlanAnalysis {
  estimatedCost: number;
  actualTime: number;
  rowEstimateAccuracy: number;
  sequentialScans: string[];
  indexScans: string[];
  nestedLoops: number;
  hashJoins: number;
  mergeJoins: number;
  warnings: string[];
  recommendations: string[];
}

export interface IndexRecommendation {
  table: string;
  columns: string[];
  reason: string;
  estimatedBenefit: 'high' | 'medium' | 'low';
  sql: string;
}

export interface SlowQueryReport {
  query: string;
  executionTime: number;
  rowCount: number;
  called: number;
  totalTime: number;
  meanTime: number;
  stddevTime: number;
}

// ============================================================================
// Query Plan Analyzer
// ============================================================================

/**
 * Validate that a query is a safe read-only SELECT before passing to EXPLAIN.
 * SECURITY FIX P0-1: Prevents SQL injection via EXPLAIN ANALYZE which actually executes queries.
 */
function validateSelectOnly(query: string): void {
  if (!/^\s*SELECT\b/i.test(query)) {
    throw new Error('Only SELECT queries can be analyzed. EXPLAIN ANALYZE executes the query.');
  }
  // Block semicolons to prevent multi-statement injection
  if (query.includes(';')) {
    throw new Error('Query must not contain semicolons. Multi-statement queries are not allowed.');
  }
}

/**
 * Validate a SQL identifier (table name, index name, column name).
 * SECURITY FIX P0-2: Prevents SQL injection via unvalidated identifiers.
 */
const VALID_IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/;

function validateIdentifier(name: string, label: string): void {
  if (!VALID_IDENTIFIER_RE.test(name)) {
    throw new Error(`Invalid ${label}: must match [a-zA-Z_][a-zA-Z0-9_]{0,63}`);
  }
}

export class QueryPlanAnalyzer {
  constructor(private pool: Pool) {}

  /**
   * Analyze query execution plan
   */
  async analyze(query: string, params?: unknown[]): Promise<PlanAnalysis> {
    validateSelectOnly(query);
    const explainQuery = `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`;
    
    try {
      const result = await this.pool.query(explainQuery, params);
      const planData = result.rows[0]?.['QUERY PLAN'] as QueryPlan[];
      
      if (!planData || planData.length === 0) {
        throw new Error('Failed to get query plan');
      }

      return this.analyzePlan(planData[0]!, query);
    } catch (error) {
      logger.error('[QueryPlanAnalyzer] Failed to analyze query', error as Error);
      throw error;
    }
  }

  /**
   * Analyze without executing (safe for production)
   */
  async analyzeSafe(query: string): Promise<Partial<PlanAnalysis>> {
    validateSelectOnly(query);
    const explainQuery = `EXPLAIN (FORMAT JSON) ${query}`;
    
    try {
      const result = await this.pool.query(explainQuery);
      const planData = result.rows[0]?.['QUERY PLAN'] as Array<{ Plan: QueryPlanNode }>;
      
      if (!planData || planData.length === 0) {
        throw new Error('Failed to get query plan');
      }

      return this.analyzePlanSafe(planData[0]!.Plan!, query);
    } catch (error) {
      logger.error('[QueryPlanAnalyzer] Failed to analyze query', error as Error);
      throw error;
    }
  }

  /**
   * Full plan analysis with actual execution stats
   */
  private analyzePlan(plan: QueryPlan, query: string): PlanAnalysis {
    const rootNode = plan.plan[0];
    if (!rootNode) {
      throw new Error('Failed to get query plan root node');
    }
    
    const analysis: PlanAnalysis = {
      estimatedCost: rootNode['Total Cost'] ?? 0,
      actualTime: plan.executionTime ?? 0,
      rowEstimateAccuracy: this.calculateRowAccuracy(rootNode),
      sequentialScans: [],
      indexScans: [],
      nestedLoops: 0,
      hashJoins: 0,
      mergeJoins: 0,
      warnings: [],
      recommendations: [],
    };

    // Traverse plan tree
    this.traversePlan(rootNode!, analysis);

    // Generate warnings and recommendations
    this.generateRecommendations(analysis, query);

    return analysis;
  }

  /**
   * Safe plan analysis (estimated stats only)
   */
  private analyzePlanSafe(node: QueryPlanNode, query: string): Partial<PlanAnalysis> {
    const analysis: Partial<PlanAnalysis> = {
      estimatedCost: node?.['Total Cost'] ?? 0,
      sequentialScans: [],
      indexScans: [],
      nestedLoops: 0,
      hashJoins: 0,
      mergeJoins: 0,
      warnings: [],
      recommendations: [],
    };

    this.traversePlanSafe(node, analysis as PlanAnalysis);

    return analysis;
  }

  /**
   * Traverse plan tree for analysis
   */
  private traversePlan(node: QueryPlanNode, analysis: PlanAnalysis): void {
    if (!node) return;

    // Check node type
    switch (node['Node Type']) {
      case 'Seq Scan':
        if (node['Relation Name']) {
          analysis.sequentialScans.push(node['Relation Name']);
        }
        // Check for filter with many rows removed
        if (node['Rows Removed by Filter'] && node['Rows Removed by Filter'] > 1000) {
          analysis.warnings.push(
            `Sequential scan on ${node['Relation Name']} removed ${node['Rows Removed by Filter']} rows by filter - consider adding an index`
          );
        }
        break;

      case 'Index Scan':
      case 'Index Only Scan':
        if (node['Index Name']) {
          analysis.indexScans.push(node['Index Name']);
        }
        break;

      case 'Nested Loop':
        analysis.nestedLoops++;
        break;

      case 'Hash Join':
        analysis.hashJoins++;
        break;

      case 'Merge Join':
        analysis.mergeJoins++;
        break;
    }

    // Recurse into child plans
    if (node.Plans) {
      node.Plans.forEach(child => this.traversePlan(child, analysis));
    }
  }

  /**
   * Traverse plan tree for safe analysis (estimated only)
   */
  private traversePlanSafe(node: QueryPlanNode, analysis: PlanAnalysis): void {
    if (!node) return;

    switch (node['Node Type']) {
      case 'Seq Scan':
        if (node['Relation Name']) {
          analysis.sequentialScans.push(node['Relation Name']);
        }
        break;

      case 'Index Scan':
      case 'Index Only Scan':
        if (node['Index Name']) {
          analysis.indexScans.push(node['Index Name']);
        }
        break;

      case 'Nested Loop':
        analysis.nestedLoops++;
        break;

      case 'Hash Join':
        analysis.hashJoins++;
        break;

      case 'Merge Join':
        analysis.mergeJoins++;
        break;
    }

    if (node.Plans) {
      node.Plans.forEach(child => this.traversePlanSafe(child, analysis));
    }
  }

  /**
   * Calculate row estimate accuracy
   */
  private calculateRowAccuracy(node: QueryPlanNode): number {
    if (!node || node['Actual Rows'] === undefined || node['Plan Rows'] === 0) {
      return 1;
    }

    const estimated = node['Plan Rows'];
    const actual = node['Actual Rows'] ?? estimated;
    
    if (estimated === 0) return actual === 0 ? 1 : 0;
    
    const ratio = Math.min(estimated, actual) / Math.max(estimated, actual);
    return ratio;
  }

  /**
   * Generate optimization recommendations
   */
  private generateRecommendations(analysis: PlanAnalysis, query: string): void {
    // Sequential scan recommendations
    if (analysis.sequentialScans.length > 0) {
      for (const table of analysis.sequentialScans) {
        // Extract WHERE conditions for this table
        const whereMatch = query.match(new RegExp(`FROM\\s+${table}[^\\w].*?WHERE\\s+(.+?)(?:ORDER|GROUP|LIMIT|$)`, 'i'));
        if (whereMatch?.[1]) {
          const columns = this.extractColumnsFromWhere(whereMatch[1]);
          if (columns.length > 0) {
            analysis.recommendations.push(
              `Consider adding index on ${table}(${columns.join(', ')}) to avoid sequential scan`
            );
          }
        }
      }
    }

    // Row estimation warnings
    if (analysis.rowEstimateAccuracy < 0.5) {
      analysis.warnings.push('Poor row estimation accuracy - consider running ANALYZE on affected tables');
    }

    // Performance warnings
    if (analysis.actualTime > 1000) {
      analysis.warnings.push(`Slow query detected: ${analysis.actualTime.toFixed(2)}ms execution time`);
    }

    if (analysis.nestedLoops > 3) {
      analysis.warnings.push(`Multiple nested loops detected (${analysis.nestedLoops}) - consider query optimization`);
    }
  }

  /**
   * Extract columns from WHERE clause
   */
  private extractColumnsFromWhere(whereClause: string): string[] {
    const columns: string[] = [];
    
    // Match column = value patterns
    const matches = whereClause.match(/(\w+)\s*[=<>]/g);
    if (matches) {
      matches.forEach(match => {
        const col = match.replace(/\s*[=<>]/, '').trim();
        if (col && !columns.includes(col)) {
          columns.push(col);
        }
      });
    }
    
    return columns.slice(0, 3); // Limit to first 3 columns
  }

  /**
   * Get index recommendations for a table
   */
  async getIndexRecommendations(tableName: string): Promise<IndexRecommendation[]> {
    validateIdentifier(tableName, 'table name');
    const recommendations: IndexRecommendation[] = [];

    // Query pg_stat_statements for slow queries on this table
    // Escape LIKE special characters in table name
    const escapedTableName = tableName.replace(/[\\%_]/g, '\\$&');
    try {
      const result = await this.pool.query(`
        SELECT query, calls, mean_time, total_time
        FROM pg_stat_statements
        WHERE query LIKE $1 ESCAPE '\\'
        ORDER BY mean_time DESC
        LIMIT 10
      `, [`%${escapedTableName}%`]);

      for (const row of result.rows) {
        const columns = this.suggestIndexColumns(row.query as string);
        if (columns.length > 0) {
          // SECURITY FIX P0-2: Validate all identifiers used in generated DDL
          columns.forEach(col => validateIdentifier(col, 'column name'));
          recommendations.push({
            table: tableName,
            columns,
            reason: `Slow query detected: ${(row.mean_time as number).toFixed(2)}ms average`,
            estimatedBenefit: (row.mean_time as number) > 100 ? 'high' : 'medium',
            sql: `CREATE INDEX idx_${tableName}_${columns.join('_')} ON "${tableName}"(${columns.map(c => `"${c}"`).join(', ')});`,
          });
        }
      }
    } catch {
      // pg_stat_statements might not be available
    }

    return recommendations;
  }

  /**
   * Suggest index columns for a query
   */
  private suggestIndexColumns(query: string): string[] {
    const columns: string[] = [];
    
    // Extract FROM clause columns
    const whereMatch = query.match(/WHERE\s+(.+?)(?:ORDER|GROUP|LIMIT|$)/i);
    if (whereMatch?.[1]) {
      const whereCols = this.extractColumnsFromWhere(whereMatch[1]);
      columns.push(...whereCols);
    }
    
    // Extract JOIN columns
    const joinMatch = query.match(/JOIN\s+\w+\s+ON\s+(.+?)(?:LEFT|RIGHT|INNER|WHERE|$)/i);
    if (joinMatch?.[1]) {
      const joinCols = this.extractColumnsFromWhere(joinMatch[1]);
      columns.push(...joinCols);
    }
    
    return [...new Set(columns)].slice(0, 3);
  }

  /**
   * Get slow queries from pg_stat_statements
   */
  async getSlowQueries(minTimeMs = 100, limit = 10): Promise<SlowQueryReport[]> {
    try {
      const result = await this.pool.query(`
        SELECT 
          query,
          calls,
          total_time,
          rows as row_count,
          mean_time,
          stddev_time
        FROM pg_stat_statements
        WHERE mean_time > $1
        ORDER BY mean_time DESC
        LIMIT $2
      `, [minTimeMs, limit]);

      return result.rows.map(row => ({
        query: (row.query as string).substring(0, 200),
        executionTime: row.mean_time as number,
        rowCount: row.row_count as number,
        called: row.calls as number,
        totalTime: row.total_time as number,
        meanTime: row.mean_time as number,
        stddevTime: row.stddev_time as number,
      }));
    } catch {
      // pg_stat_statements might not be available
      return [];
    }
  }

  /**
   * Check if a query is likely to be slow
   */
  async isSlowQuery(query: string): Promise<boolean> {
    const analysis = await this.analyzeSafe(query);
    
    // Check for problematic patterns
    if (analysis.sequentialScans && analysis.sequentialScans.length > 0) {
      return true;
    }
    
    if (analysis.estimatedCost && analysis.estimatedCost > 10000) {
      return true;
    }

    return false;
  }
}

// ============================================================================
// Query Hints
// ============================================================================

export const queryHints = {
  /**
   * Force index usage
   * SECURITY FIX P1-3: Validate table/index identifiers
   */
  forceIndex: (table: string, index: string): string => {
    validateIdentifier(table, 'table name');
    validateIdentifier(index, 'index name');
    return `/*+ IndexScan(${table} ${index}) */`;
  },

  /**
   * Force sequential scan
   * SECURITY FIX P1-3: Validate table identifier
   */
  forceSeqScan: (table: string): string => {
    validateIdentifier(table, 'table name');
    return `/*+ SeqScan(${table}) */`;
  },

  /**
   * Set work memory for query
   * SECURITY FIX P1-1: Validate numeric parameter
   */
  setWorkMem: (mb: number): string => {
    if (!Number.isFinite(mb) || mb < 1 || mb > 4096) {
      throw new Error('work_mem must be a finite number between 1 and 4096 MB');
    }
    return `SET LOCAL work_mem = '${Math.floor(mb)}MB';`;
  },

  /**
   * Disable nested loops
   */
  disableNestedLoops: (): string =>
    `SET LOCAL enable_nestloop = off;`,

  /**
   * Enable parallel query
   * SECURITY FIX P1-2: Validate numeric parameter
   */
  enableParallel: (workers: number): string => {
    if (!Number.isFinite(workers) || workers < 0 || workers > 1024) {
      throw new Error('max_parallel_workers must be a finite number between 0 and 1024');
    }
    return `SET LOCAL max_parallel_workers_per_gather = ${Math.floor(workers)};`;
  },
};

// ============================================================================
// Slow Query Logger
// ============================================================================

export class SlowQueryLogger {
  private slowQueries: SlowQueryReport[] = [];
  private readonly thresholdMs: number;

  constructor(thresholdMs = 500) {
    this.thresholdMs = thresholdMs;
  }

  log(query: string, executionTimeMs: number, rowCount: number): void {
    if (executionTimeMs < this.thresholdMs) return;

    const report: SlowQueryReport = {
      query: query.substring(0, 200),
      executionTime: executionTimeMs,
      rowCount,
      called: 1,
      totalTime: executionTimeMs,
      meanTime: executionTimeMs,
      stddevTime: 0,
    };

    this.slowQueries.push(report);
    
    // Keep only recent slow queries
    if (this.slowQueries.length > 100) {
      this.slowQueries.shift();
    }

    logger.warn(`[SlowQuery] ${executionTimeMs.toFixed(2)}ms`, { queryPreview: query.substring(0, 100) });
  }

  getSlowQueries(): SlowQueryReport[] {
    return [...this.slowQueries];
  }

  clear(): void {
    this.slowQueries = [];
  }
}
