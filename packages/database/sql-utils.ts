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
 * Build safe ILIKE query with ESCAPE clause
 * SECURITY FIX: Complete protection against LIKE injection
 * @param column - Column name to search
 * @param paramIndex - Parameter index for prepared statement
 * @returns Object with SQL fragment and escaped pattern
 */
export function buildSafeIlikeQuery(column: string, paramIndex: number): {
  sql: string;
  wrapPattern: (pattern: string) => string;
} {
  return {
    sql: `${column} ILIKE $${paramIndex} ESCAPE '\\'`,
    wrapPattern: (pattern: string) => `%${escapeLikePattern(pattern)}%`
  };
}
