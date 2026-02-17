import { paginationConfig } from '@config';
import { DB } from '@kernel/constants';

/**
* Pagination utilities
*
* Provides functions for clamping pagination parameters
* to safe and reasonable values.
*

* unbounded OFFSET which causes O(n) scans
*/

// ============================================================================
// Constants
// ============================================================================

// P0-FIX: Whitelist for cursor columns to prevent SQL injection
const ALLOWED_CURSOR_COLUMNS = ['created_at', 'id', 'updated_at', 'timestamp', 'sort_order'] as const;
export type ValidCursorColumn = typeof ALLOWED_CURSOR_COLUMNS[number];

/**
* P0-FIX: Validate cursor column against whitelist
* @throws Error if cursor column is not in the allowed list
*/
function validateCursorColumn(cursorColumn: string): asserts cursorColumn is ValidCursorColumn {
  if (!ALLOWED_CURSOR_COLUMNS.includes(cursorColumn as ValidCursorColumn)) {
    throw new Error(`Invalid cursor column: ${cursorColumn}. Allowed columns: ${ALLOWED_CURSOR_COLUMNS.join(', ')}`);
  }
}

/** Maximum allowed limit for pagination */
const MAX_LIMIT = paginationConfig.maxLimit;

/** Default pagination limit */
const DEFAULT_LIMIT = paginationConfig.defaultLimit;

/** Maximum allowed cursor offset for offset-based pagination */

// ============================================================================
// Offset-Based Pagination Functions (Legacy - use with caution)
// ============================================================================

/**
* Clamp pagination limit to valid range
* @param limit - Requested limit
* @returns Clamped limit value between 1 and MAX_LIMIT
*/
export function clampLimit(limit?: number): number {
  if (!limit || limit < 1) return DEFAULT_LIMIT;
  return Math.min(limit, MAX_LIMIT);
}

/**
* Calculate pagination offset

* @param page - Page number (1-based)
* @param limit - Items per page
* @returns Offset for database query
*/
export function calculateOffset(page?: number, limit?: number): number {
  const validPage = !page || page < 1 ? 1 : page;
  const validLimit = clampLimit(limit);
  const offset = (validPage - 1) * validLimit;

  if (offset > DB.MAX_OFFSET) {
  throw new Error(
    `Offset ${offset} exceeds maximum safe offset ${DB.MAX_OFFSET}. ` +
    `Use cursor-based pagination for large result sets.`
  );
  }

  return offset;
}

/**
* Calculate total pages
* @param total - Total number of items
* @param limit - Items per page
* @returns Total number of pages
*/
export function calculateTotalPages(total: number, limit?: number): number {
  const validLimit = clampLimit(limit);
  return Math.ceil(total / validLimit);
}

/**
* Create pagination metadata
* @param page - Current page
* @param limit - Items per page
* @param total - Total number of items
* @returns Pagination metadata object
*/
export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export function createPaginationMeta(page?: number, limit?: number, total?: number): PaginationMeta {
  const validPage = !page || page < 1 ? 1 : page;
  const validLimit = clampLimit(limit);
  const validTotal = total || 0;

  return {
  page: validPage,
  limit: validLimit,
  total: validTotal,
  totalPages: calculateTotalPages(validTotal, validLimit),
  hasNext: validPage < calculateTotalPages(validTotal, validLimit),
  hasPrev: validPage > 1,
  };
}

// ============================================================================

// ============================================================================

/**
* Cursor structure for cursor-based pagination
*/
export interface Cursor {
  value: string;
  direction: 'asc' | 'desc';
}

/**
* Cursor-based pagination parameters
*/
export interface CursorPaginationParams {
  cursor?: string;
  limit?: number;
  direction?: 'next' | 'prev';
}

/**
* Cursor-based pagination result
*/
export interface CursorPaginationResult<T> {
  data: T[];
  pagination: {
  limit: number;
  hasNext: boolean;
  hasPrev: boolean;
  nextCursor: string | null;
  prevCursor: string | null;
  };
}

/**
* Encode cursor value to base64
*/
export function encodeCursor(value: string): string {
  return Buffer.from(value).toString('base64url');
}

/**
* Decode cursor value from base64
*/
export function decodeCursor(cursor: string): string {
  try {
  return Buffer.from(cursor, 'base64url').toString('utf8');
  } catch {
  throw new Error('Invalid cursor format');
  }
}

/**
* Build WHERE clause for cursor-based pagination

*
* @param cursorColumn - Column to use for cursor (e.g., 'created_at', 'id')
* @param cursorValue - Decoded cursor value
* @param direction - Sort direction
* @param sortOrder - Query sort order
* @returns SQL WHERE clause fragment
*/
export function buildCursorWhereClause(
  cursorColumn: string,
  cursorValue: string,
  direction: 'next' | 'prev',
  sortOrder: 'asc' | 'desc' = 'desc'
): { clause: string; params: (string | number)[] } {
  // P0-FIX: Validate cursor column against whitelist to prevent SQL injection
  validateCursorColumn(cursorColumn);

  // Determine effective direction based on cursor direction and sort order
  const effectiveDirection = direction === 'next'
  ? sortOrder
  : (sortOrder === 'asc' ? 'desc' : 'asc');

  const operator = effectiveDirection === 'asc' ? '>' : '<';

  return {
  clause: `${cursorColumn} ${operator} $1`,
  params: [cursorValue],
  };
}

/**
* Build ORDER BY clause for cursor-based pagination
*/
export function buildCursorOrderBy(
  cursorColumn: string,
  sortOrder: 'asc' | 'desc' = 'desc'
): string {
  // P0-FIX: Validate cursor column against whitelist to prevent SQL injection
  validateCursorColumn(cursorColumn);
  return `${cursorColumn} ${sortOrder.toUpperCase()}`;
}

/**
* Process query results for cursor-based pagination
*/
export function processCursorResults<T extends Record<string, unknown>>(
  rows: T[],
  cursorColumn: string,
  limit: number,
  hasPrevCursor: boolean
): CursorPaginationResult<T> {
  const safeLimit = clampLimit(limit);

  // Check if there are more results
  const hasNext = rows.length > safeLimit;
  const hasPrev = hasPrevCursor;

  // Remove the extra row used for checking hasNext
  const data = hasNext ? rows.slice(0, safeLimit) : rows;

  // Generate cursors
  const nextCursor = hasNext && data.length > 0 && data[data.length - 1]
  ? encodeCursor(String(data[data.length - 1]![cursorColumn]))
  : null;

  const prevCursor = hasPrev && data.length > 0 && data[0]
  ? encodeCursor(String(data[0]![cursorColumn]))
  : null;

  return {
  data,
  pagination: {
    limit: safeLimit,
    hasNext,
    hasPrev,
    nextCursor,
    prevCursor,
  },
  };
}

/**

*
* Use this for new pagination implementations instead of offset-based pagination.
* This provides O(1) performance regardless of page depth.
*
* Example usage:
* ```typescript
* const result = await createCursorQuery({
*   pool,
*   table: 'content_items',
*   cursorColumn: 'created_at',
*   cursor: req.query.cursor,
*   limit: 20,
*   whereClause: 'status = $1',
*   whereParams: ['published'],
*   sortOrder: 'desc'
* });
* ```
*/
export interface CursorQueryOptions {
  cursor?: string;
  limit?: number;
  cursorColumn?: string;
  sortOrder?: 'asc' | 'desc';
  direction?: 'next' | 'prev';
}

export function createCursorQuery(options: CursorQueryOptions): {
  whereClause: string;
  orderByClause: string;
  limitClause: string;
  params: (string | number)[];
  hasPrevCursor: boolean;
} {
  const {
  limit = DEFAULT_LIMIT,
  cursorColumn = 'created_at',
  sortOrder = 'desc',
  direction = 'next',
  cursor,
  } = options;

  const safeLimit = clampLimit(limit);
  const hasPrevCursor = !!cursor;

  let whereClause = '';
  const params: (string | number)[] = [];

  if (cursor) {
  const decodedCursor = decodeCursor(cursor);
  const cursorWhere = buildCursorWhereClause(
    cursorColumn,
    decodedCursor,
    direction,
    sortOrder
  );
  whereClause = `WHERE ${cursorWhere.clause}`;
  params.push(...cursorWhere.params);
  }

  const orderByClause = `ORDER BY ${buildCursorOrderBy(cursorColumn, sortOrder)}`;
  // Fetch one extra row to determine if there's a next page
  const limitClause = `LIMIT $${params.length + 1}`;
  params.push(safeLimit + 1);

  return {
  whereClause,
  orderByClause,
  limitClause,
  params,
  hasPrevCursor,
  };
}

/**
* Validate cursor pagination parameters
*/
export function validateCursorParams(params: CursorPaginationParams): {
  valid: boolean;
  error?: string | undefined;
  cursor?: string | undefined;
  limit: number;
  direction: 'next' | 'prev';
} {
  const limit = params.limit ?? DEFAULT_LIMIT;
  const direction = params.direction ?? 'next';

  if (limit < 1 || limit > MAX_LIMIT) {
  return {
    valid: false,
    error: `Limit must be between 1 and ${MAX_LIMIT}`,
    limit: DEFAULT_LIMIT,
    direction,
  };
  }

  if (direction !== 'next' && direction !== 'prev') {
  return {
    valid: false,
    error: "Direction must be 'next' or 'prev'",
    cursor: params.cursor,
    limit,
    direction: 'next',
  };
  }

  return {
  valid: true,
  cursor: params.cursor,
  limit,
  direction,
  };
}
