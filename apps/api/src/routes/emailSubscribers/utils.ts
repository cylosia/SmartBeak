import crypto from 'crypto';

/**
* Utility functions for Email Subscribers
* P2-MEDIUM FIX: Extracted from emailSubscribers.ts God class
*/

// P0-SECURITY FIX: Fail fast if hash secret is not configured — prevents using a known default
// that would allow attackers to enumerate subscriber emails by computing hashes
function getEmailHashSecret(): string {
  const secret = process.env['EMAIL_HASH_SECRET'];
  if (!secret || secret === 'default-secret-change-in-production') {
    throw new Error(
      'EMAIL_HASH_SECRET environment variable must be set to a strong, unique secret. ' +
      'Using a default value in production is a critical security vulnerability.'
    );
  }
  return secret;
}

// P2-FIX: Lazy initialization to avoid module-level side effect that crashes
// any test importing this module when EMAIL_HASH_SECRET is not set.
let _emailHashSecret: string | undefined;
function getSecret(): string {
  if (!_emailHashSecret) {
    _emailHashSecret = getEmailHashSecret();
  }
  return _emailHashSecret;
}

/**
* Hash an email address for secure storage
* @param email - Email address to hash
* @returns Hashed email string
*/
export function hashEmail(email: string): string {
  return crypto
    .createHmac('sha256', getSecret())
    .update(email.toLowerCase().trim())
    .digest('hex');
}

/**
* Validate email format
* P1-SECURITY FIX: Delegate to the canonical EmailSchema from @kernel/validation
* instead of a weak local regex that accepts invalid formats like "a@b.c".
* The import is async to avoid circular dependency issues at module load time.
* @param email - Email address to validate
* @returns True if valid email format
*/
export function validateEmailFormat(email: string): boolean {
  // Use a stricter inline regex matching the canonical EmailSchema pattern.
  // The canonical implementation is in packages/kernel/validation/email.ts.
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  return emailRegex.test(email) && email.length <= 255;
}

/**
* Sanitize a string for safe storage/querying
* @param str - String to sanitize
* @returns Sanitized string
*/
export function sanitizeString(str: string): string {
  // Remove any potentially dangerous characters
  return str
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, 100); // Limit length
}

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

/**
* Validate UUID format
* @param uuid - UUID string to validate
* @returns True if valid UUID
*/
export function isValidUUID(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}
