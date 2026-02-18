/**
 * Shared UUID validation utilities for the web application.
 *
 * FIX BUG-12: UUID_RE was duplicated in keywords.tsx, keywords-decay.tsx, and
 * keywords-map.tsx (and additional pages) with no single source of truth.
 * A divergent edit (e.g., narrowing to version-4 only) would only apply to
 * the files where it was manually updated. This module is the canonical location.
 */

/**
 * Matches a standard UUID (any version, any variant).
 * Case-insensitive; groups: time_low - time_mid - time_hi_and_version - clock_seq - node.
 */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
