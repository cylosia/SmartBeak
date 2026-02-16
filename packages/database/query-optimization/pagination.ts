/**
 * Cursor-Based Pagination Implementation
 * 
 * P2 OPTIMIZATION: Replaces OFFSET-based pagination with cursor-based pagination
 * for O(1) performance regardless of page depth.
 */

import type { Pool } from 'pg';

// ============================================================================
// Table Name Validation (Security)
// ============================================================================

const VALID_TABLE_NAMES = [
  // Content & Publishing
  'content_items',
  'content_versions',
  'content_categories',
  'content_tags',
  'publishing_jobs',
  'publishing_logs',
  // Notifications
  'notifications',
  'notification_templates',
  'notification_preferences',
  // Search & SEO
  'search_documents',
  'seo_documents',
  'seo_analytics',
  // Users & Customers
  'authors',
  'customers',
  'users',
  'user_profiles',
  'user_sessions',
  // Domains & Sites
  'domains',
  'sites',
  'site_settings',
  // Media & Assets
  'media',
  'media_folders',
  'assets',
  // Comments & Interactions
  'comments',
  'reviews',
  'ratings',
  // Subscriptions & Billing
  'subscriptions',
  'subscription_plans',
  'invoices',
  'payments',
  // System & Admin
  'audit_logs',
  'system_logs',
  'api_keys',
  'webhooks',
  // Workflows
  'workflows',
  'workflow_runs',
  'tasks',
  'jobs',
  // Analytics
  'analytics_events',
  'page_views',
  'click_events',
] as const;

type ValidTableName = typeof VALID_TABLE_NAMES[number];

/**
 * Validate table name against whitelist (security)
 * Prevents SQL injection via table name parameter
 */
export function validateTableName(table: string): asserts table is ValidTableName {
  if (!VALID_TABLE_NAMES.includes(table as ValidTableName)) {
    throw new Error(
      `Invalid table name: ${table}. Must be one of: ${VALID_TABLE_NAMES.join(', ')}`
    );
  }
}

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface CursorPaginationParams {
  /** Cursor for the current position */
  cursor?: string;
  /** Number of items per page */
  limit?: number;
  /** Direction: next or prev */
  direction?: 'next' | 'prev';
  /** Column to use for cursor (default: created_at) */
  cursorColumn?: string;
  /** Sort order */
  sortOrder?: 'asc' | 'desc';
}

export interface CursorPaginationResult<T> {
  data: T[];
  pagination: {
    hasNext: boolean;
    hasPrev: boolean;
    nextCursor: string | null;
    prevCursor: string | null;
    totalCount?: number;
  };
}

export interface CursorQueryBuilder {
  table: string;
  select?: string[] | undefined;
  where?: string | undefined;
  whereParams?: unknown[] | undefined;
  cursorColumn?: string | undefined;
  cursorValue?: string | undefined;
  limit?: number | undefined;
  direction?: 'next' | 'prev' | undefined;
  sortOrder?: 'asc' | 'desc' | undefined;
}

// ============================================================================
// Cursor Utilities
// ============================================================================

/**
 * Encode cursor value to base64url
 */
export function encodeCursor(value: string | number | Date): string {
  const str = value instanceof Date ? value.toISOString() : String(value);
  return Buffer.from(str).toString('base64url');
}

/**
 * Decode cursor value from base64url
 */
export function decodeCursor(cursor: string): string {
  try {
    return Buffer.from(cursor, 'base64url').toString('utf8');
  } catch {
    throw new Error('Invalid cursor format');
  }
}

/**
 * Validate cursor column (security)
 */
const VALID_CURSOR_COLUMNS = ['id', 'created_at', 'updated_at', 'sort_order', 'timestamp'] as const;
type ValidCursorColumn = typeof VALID_CURSOR_COLUMNS[number];

export function validateCursorColumn(column: string): asserts column is ValidCursorColumn {
  if (!VALID_CURSOR_COLUMNS.includes(column as ValidCursorColumn)) {
    throw new Error(`Invalid cursor column: ${column}. Must be one of: ${VALID_CURSOR_COLUMNS.join(', ')}`);
  }
}

// ============================================================================
// Cursor Pagination Class
// ============================================================================

export class CursorPaginator<T extends Record<string, unknown>> {
  private readonly defaultLimit = 25;
  private readonly maxLimit = 100;

  constructor(private pool: Pool) {}

  /**
   * Execute cursor-based paginated query
   */
  async paginate(params: CursorPaginationParams & {
    table: string;
    select?: string[];
    where?: string;
    whereParams?: unknown[];
    orderBy?: string[];
  }): Promise<CursorPaginationResult<T>> {
    const {
      table,
      select = ['*'],
      where,
      whereParams = [],
      orderBy,
      cursor,
      limit = this.defaultLimit,
      direction = 'next',
      cursorColumn = 'created_at',
      sortOrder = 'desc',
    } = params;

    // Validate inputs
    validateTableName(table);
    validateCursorColumn(cursorColumn);
    const safeLimit = Math.min(Math.max(1, limit), this.maxLimit);

    // Build query
    const queryBuilder: CursorQueryBuilder & { orderBy?: string[] } = {
      table,
      select,
      where: where ?? '',
      whereParams,
      cursorColumn,
      cursorValue: cursor ? decodeCursor(cursor) : undefined,
      limit: safeLimit,
      direction,
      sortOrder,
    };
    if (orderBy !== undefined) {
      queryBuilder.orderBy = orderBy;
    }
    const query = this.buildQuery(queryBuilder);

    // Execute query (fetch one extra to determine if there's more)
    const result = await this.pool.query<T>(query.sql, query.params);
    const rows = result.rows;

    // Determine pagination state
    const hasMore = rows.length > safeLimit;
    const data = hasMore ? rows.slice(0, safeLimit) : rows;

    // Generate cursors
    const hasNext = direction === 'next' ? hasMore : !!cursor;
    const hasPrev = direction === 'prev' ? hasMore : !!cursor;

    // P1-FIX: Add bounds check before array access
    const lastRow = data.length > 0 ? data[data.length - 1] : undefined;
    const nextCursor = hasNext && lastRow !== undefined && cursorColumn in lastRow
      ? encodeCursor(String(lastRow[cursorColumn]))
      : null;

    const prevCursor = hasPrev && data.length > 0
      ? encodeCursor(String(data[0]![cursorColumn]))
      : null;

    return {
      data: data as T[],
      pagination: {
        hasNext,
        hasPrev,
        nextCursor,
        prevCursor,
      },
    };
  }

  /**
   * Build paginated SQL query
   */
  private buildQuery(builder: CursorQueryBuilder & { orderBy?: string[] }): { sql: string; params: unknown[] } {
    const {
      table,
      select = ['*'],
      where,
      whereParams = [],
      cursorColumn = 'created_at',
      cursorValue,
      limit = 25,
      direction = 'next',
      sortOrder = 'desc',
      orderBy,
    } = builder;

    // Validate table name before using in SQL
    validateTableName(table);

    // Build WHERE clause with cursor
    let whereClause = where || '';
    const params: unknown[] = [...whereParams];

    if (cursorValue) {
      const operator = this.getCursorOperator(direction, sortOrder);
      const cursorCondition = `${cursorColumn} ${operator} $${params.length + 1}`;
      params.push(cursorValue);

      whereClause = whereClause
        ? `${whereClause} AND ${cursorCondition}`
        : `WHERE ${cursorCondition}`;
    } else if (whereClause) {
      whereClause = `WHERE ${whereClause}`;
    }

    // Build ORDER BY
    const effectiveSortOrder = direction === 'prev'
      ? (sortOrder === 'asc' ? 'desc' : 'asc')
      : sortOrder;

    // P0-8 FIX: Validate ORDER BY entries to prevent SQL injection
    // Split column from direction to avoid nested quantifiers (ReDoS)
    if (orderBy && orderBy.length > 0) {
      const VALID_COLUMN_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_.]*$/;
      const VALID_DIRECTION = /^(?:ASC|DESC)$/i;
      for (const entry of orderBy) {
        const parts = entry.trim().split(/\s+/);
        const column = parts[0];
        if (!column || !VALID_COLUMN_PATTERN.test(column) || parts.length > 2
            || (parts.length === 2 && !VALID_DIRECTION.test(parts[1]!))) {
          throw new Error(`Invalid ORDER BY entry: "${entry}". Must be a column name optionally followed by ASC/DESC.`);
        }
      }
    }

    let orderByClause = orderBy && orderBy.length > 0
      ? `ORDER BY ${orderBy.join(', ')}`
      : `ORDER BY ${cursorColumn} ${effectiveSortOrder.toUpperCase()}`;

    // If using custom order by, ensure cursor column is last for consistency
    if (orderBy && orderBy.length > 0 && !orderBy.some(o => o.includes(cursorColumn))) {
      orderByClause += `, ${cursorColumn} ${effectiveSortOrder.toUpperCase()}`;
    }

    // Build final query (fetch one extra to detect hasMore)
    const sql = `
      SELECT ${select.join(', ')}
      FROM ${table}
      ${whereClause}
      ${orderByClause}
      LIMIT $${params.length + 1}
    `;
    params.push(limit + 1);

    return { sql, params };
  }

  /**
   * Get cursor comparison operator
   */
  private getCursorOperator(direction: 'next' | 'prev', sortOrder: 'asc' | 'desc'): string {
    if (direction === 'next') {
      return sortOrder === 'asc' ? '>' : '<';
    } else {
      return sortOrder === 'asc' ? '<' : '>';
    }
  }

  /**
   * Get total count (for UI display)
   * Note: This is separate from paginated query for performance
   */
  async getTotalCount(table: string, where?: string, whereParams?: unknown[]): Promise<number> {
    // Validate table name before using in SQL
    validateTableName(table);

    const whereClause = where ? `WHERE ${where}` : '';
    const result = await this.pool.query(
      `SELECT COUNT(*) as count FROM ${table} ${whereClause}`,
      whereParams || []
    );
    // P1-FIX: Use string for bigint, handle potential overflow
    const countValue = result.rows[0]?.count;
    if (countValue === undefined || countValue === null) {
      return 0;
    }
    // Handle bigint as string to prevent overflow, cap at Number.MAX_SAFE_INTEGER
    const countStr = String(countValue);
    const countNum = Number(countStr);
    if (countNum > Number.MAX_SAFE_INTEGER) {
      return Number.MAX_SAFE_INTEGER;
    }
    return countNum;
  }
}

// ============================================================================
// Keyset Pagination (Alternative for complex sorting)
// ============================================================================

export interface KeysetPaginationParams {
  /** Multiple column values for the cursor */
  cursor?: Record<string, string>;
  limit?: number;
  direction?: 'next' | 'prev';
  sortColumns: Array<{ column: string; order: 'asc' | 'desc' }>;
}

/**
 * Build keyset pagination WHERE clause
 * Handles multi-column sorting correctly
 */
export function buildKeysetWhereClause(
  cursor: Record<string, string>,
  sortColumns: Array<{ column: string; order: 'asc' | 'desc' }>,
  direction: 'next' | 'prev'
): { clause: string; params: string[] } {
  const _conditions: string[] = [];
  const params: string[] = [];

  // Build row comparison for keyset pagination
  const comparisons: string[] = [];
  
  for (let i = 0; i < sortColumns.length; i++) {
    const col = sortColumns[i];
    if (!col) continue;
    const { column, order } = col;
    const value = cursor[column];
    
    if (value === undefined) continue;

    const effectiveOrder = direction === 'prev'
      ? (order === 'asc' ? 'desc' : 'asc')
      : order;
    
    const operator = effectiveOrder === 'asc' ? '>' : '<';

    if (i === 0) {
      comparisons.push(`${column} ${operator} $${params.length + 1}`);
      params.push(value);
    } else {
      // For subsequent columns, add equality checks for previous columns
      const equalities = sortColumns
        .slice(0, i)
        .map(c => {
          const col = c!.column;
          const val = cursor[col];
          return `${col} = $${val !== undefined ? params.indexOf(val) + 1 : 0}`;
        })
        .join(' AND ');
      
      comparisons.push(`(${equalities} AND ${column} ${operator} $${params.length + 1})`);
      params.push(value);
    }
  }

  if (comparisons.length > 0) {
    return {
      clause: `(${comparisons.join(' OR ')})`,
      params,
    };
  }

  return { clause: '', params: [] };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create cursor from row data
 */
export function createCursorFromRow(
  row: Record<string, unknown>,
  cursorColumn: string
): string {
  const value = row[cursorColumn];
  if (value === undefined) {
    throw new Error(`Cursor column '${cursorColumn}' not found in row`);
  }
  return encodeCursor(String(value));
}

/**
 * Create multi-column cursor
 */
export function createMultiColumnCursor(
  row: Record<string, unknown>,
  columns: string[]
): string {
  const values: Record<string, string> = {};
  
  for (const col of columns) {
    const value = row[col];
    if (value === undefined) {
      throw new Error(`Cursor column '${col}' not found in row`);
    }
    values[col] = String(value);
  }

  return encodeCursor(JSON.stringify(values));
}

/**
 * Decode multi-column cursor
 */
export function decodeMultiColumnCursor(cursor: string): Record<string, string> {
  const decoded = decodeCursor(cursor);
  try {
    return JSON.parse(decoded);
  } catch {
    throw new Error('Invalid multi-column cursor format');
  }
}

// ============================================================================
// Comparison: OFFSET vs Cursor Pagination
// ============================================================================

export const paginationComparison = {
  /**
   * Performance comparison between OFFSET and cursor pagination
   */
  performance: {
    offset: {
      timeComplexity: 'O(offset + limit)',
      bestFor: ['Small offsets (< 1000)', 'Random access', 'Jump to specific page'],
      issues: ['Slow with large offsets', 'Inconsistent results with concurrent writes', 'Inefficient'],
    },
    cursor: {
      timeComplexity: 'O(limit)',
      bestFor: ['Large datasets', 'Infinite scroll', 'Consistent results'],
      issues: ['No random access', 'Complex with multi-column sorting', 'Cursor can become stale'],
    },
  },

  /**
   * Choose pagination strategy based on use case
   */
  chooseStrategy: (params: {
    estimatedTotalRows?: number;
    averagePageSize?: number;
    needsRandomAccess?: boolean;
    needsRealTimeConsistency?: boolean;
  }): 'offset' | 'cursor' => {
    const { estimatedTotalRows, needsRandomAccess, needsRealTimeConsistency } = params;

    if (needsRandomAccess) return 'offset';
    if (estimatedTotalRows && estimatedTotalRows > 10000) return 'cursor';
    if (needsRealTimeConsistency) return 'cursor';
    
    return 'offset';
  },
};
