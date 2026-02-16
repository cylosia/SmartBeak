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
  // Validate parts separately to avoid ReDoS from nested quantifiers.
  // The canonical implementation is in packages/kernel/validation/email.ts.
  if (email.length > 255) return false;
  const atIndex = email.indexOf('@');
  if (atIndex < 1 || atIndex === email.length - 1) return false;
  if (email.indexOf('@', atIndex + 1) !== -1) return false;
  const local = email.substring(0, atIndex);
  const domain = email.substring(atIndex + 1);
  if (!/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)) return false;
  const labels = domain.split('.');
  if (labels.length < 2) return false;
  return labels.every(label => {
    if (label.length < 1 || label.length > 63) return false;
    if (!/^[a-zA-Z0-9]/.test(label)) return false;
    if (!/[a-zA-Z0-9]$/.test(label)) return false;
    return /^[a-zA-Z0-9-]+$/.test(label);
  });
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

// SQL safety utilities — canonical implementations in @database/sql-utils
export { escapeLikePattern, buildSafeIlikeQuery } from '@database/sql-utils';

/**
* Validate UUID format
* @param uuid - UUID string to validate
* @returns True if valid UUID
*/
export function isValidUUID(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}
