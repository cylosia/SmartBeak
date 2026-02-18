/**
 * SQL utility functions for safe query construction.
 * Extracted from apps/api/src/routes/emailSubscribers/utils.ts
 * to prevent cross-layer imports from test/ and other packages.
 */

/**
 * Escape LIKE/ILIKE pattern special characters
 * SECURITY FIX: Prevents wildcard injection attacks
 * @param pattern - The search pattern to escape
 * @param escapeChar - The escape character to use (default: '\')
 * @returns Escaped pattern safe for LIKE/ILIKE queries
 */
export function escapeLikePattern(pattern: string, escapeChar: string = '\\'): string {
  if (!pattern) return pattern;

  // Escape special LIKE characters: % (percent), _ (underscore), and the escape char itself
  // Order matters: escape the escape char first to avoid double-escaping
  const escaped = pattern
    .replace(/\\/g, escapeChar + escapeChar)  // Escape backslashes first
    .replace(/%/g, escapeChar + '%')          // Escape percent wildcards
    .replace(/_/g, escapeChar + '_');         // Escape underscore wildcards

  return escaped;
}

/**
 * Safe PostgreSQL identifier pattern.
 * Allows letters, digits, and underscores; must start with a letter or underscore.
 * This matches unquoted identifiers PostgreSQL accepts and prevents SQL injection
 * via column name interpolation.
 */
const SAFE_IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Build safe ILIKE query with ESCAPE clause.
 * SECURITY FIX (P1-2): Validate the column name against a strict identifier
 * pattern before interpolating into SQL. Without this check, a caller passing
 * user-controlled column names could inject arbitrary SQL through the column
 * position (the LIKE pattern is parameterised, but the column name is not).
 *
 * @param column - Column name to search (must match [a-zA-Z_][a-zA-Z0-9_]*)
 * @param paramIndex - Parameter index for the prepared statement placeholder
 * @returns Object with SQL fragment and a pattern-wrapping helper
 * @throws Error if column does not match the safe identifier pattern
 */
export function buildSafeIlikeQuery(column: string, paramIndex: number): {
  sql: string;
  wrapPattern: (pattern: string) => string;
} {
  if (!SAFE_IDENTIFIER_RE.test(column)) {
    throw new Error(
      `buildSafeIlikeQuery: unsafe column name '${column}'. ` +
      'Column names must match [a-zA-Z_][a-zA-Z0-9_]*.'
    );
  }
  return {
    sql: `${column} ILIKE $${paramIndex} ESCAPE '\\'`,
    wrapPattern: (pattern: string) => `%${escapeLikePattern(pattern)}%`
  };
}
