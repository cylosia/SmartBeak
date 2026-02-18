import { timingSafeEqual } from 'crypto';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

import { sanitizeForLogging } from './logger';
import { getLogger } from '@kernel/logger';

const logger = getLogger('jwt');

/**
* Centralized JWT Verification Utility
*
* This module provides a unified JWT verification interface for use across
* all route files, ensuring consistent token validation and security practices.
*
* Security features:
* - Constant-time comparison for Bearer prefix validation
* - Explicit algorithm specification (HS256 only)
* - Runtime claim validation with Zod
* - Clock tolerance for time skew
* - Token format validation
* 
* P1-HIGH SECURITY FIX: Issue 2 - JWT validation inconsistency
* This file serves as the single source of truth for JWT validation
*/

// ============================================================================
// Zod Schemas
// ============================================================================

// P0-FIX: Added 'owner' role. Previously this schema only had ['admin', 'editor', 'viewer'],
// while packages/security/auth.ts had ['viewer', 'editor', 'admin', 'owner']. This drift
// caused tokens with role:"owner" to be rejected by verifyToken() (Zod validation failure),
// silently locking org owners out of any code path using jwt.ts for verification.
export const UserRoleSchema = z.enum(['admin', 'editor', 'viewer', 'owner']);

export const JwtClaimsSchema = z.object({
  sub: z.string().min(1).max(256),
  role: UserRoleSchema,
  // F31-FIX: orgId is now required. It was optional in the schema but required
  // by getAuthContext(), causing silent auth failures for tokens without orgId.
  orgId: z.string().min(1).max(256),
  aud: z.string().optional(),
  iss: z.string().optional(),
  jti: z.string().optional(),
  exp: z.number().optional(),
  iat: z.number().optional(),
  boundOrgId: z.string().optional(),
});

// ============================================================================
// Type Definitions
// ============================================================================

export type UserRole = z.infer<typeof UserRoleSchema>;
export type JwtClaims = z.infer<typeof JwtClaimsSchema>;

export interface AuthContext {
  userId: string;
  orgId: string;
  roles: string[];
  sessionId?: string | undefined;
}

export interface VerifyOptions {
  audience?: string | undefined;
  issuer?: string | undefined;
  // F29-FIX: Removed ignoreExpiration. Allowing callers to bypass expiration
  // checks creates indefinite session validity. Token refresh must use a
  // dedicated flow, not a bypass flag on the general verifier.
}

// ============================================================================
// Error Types
// ============================================================================

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export class TokenExpiredError extends AuthError {
  constructor(expiredAt?: Date) {
    super(
      expiredAt ? `Token expired at ${expiredAt.toISOString()}` : 'Token expired',
      'TOKEN_EXPIRED'
    );
    this.name = 'TokenExpiredError';
  }
}

export class TokenInvalidError extends AuthError {
  constructor(reason: string) {
    super(`Invalid token: ${reason}`, 'TOKEN_INVALID');
    this.name = 'TokenInvalidError';
  }
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_AUDIENCE = process.env['JWT_AUDIENCE'] || 'smartbeak';
const DEFAULT_ISSUER = process.env['JWT_ISSUER'] || 'smartbeak-api';
const JWT_CLOCK_TOLERANCE = 30; // 30 seconds clock skew tolerance

// Token format regex: 3 base64url-encoded parts separated by dots
// SECURITY: Simple regex that doesn't cause ReDoS
const TOKEN_FORMAT_REGEX = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

// ============================================================================
// Security Utilities
// ============================================================================

/**
* Constant-time string comparison to prevent timing attacks
*/
export function constantTimeCompare(a: string, b: string): boolean {
  // P1-9 FIX: Explicitly reject empty inputs.
  // timingSafeEqual(Buffer.alloc(0), Buffer.alloc(0)) returns true, and
  // ''.length === ''.length is also true, so ('', '') previously returned true —
  // the opposite of what security-sensitive callers expect. Two empty strings
  // must never be considered a valid secret match.
  if (a.length === 0 || b.length === 0) {
    return false;
  }

  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  const maxLen = Math.max(aBuf.length, bBuf.length);

  const aPadded = Buffer.alloc(maxLen, 0);
  const bPadded = Buffer.alloc(maxLen, 0);
  aBuf.copy(aPadded);
  bBuf.copy(bPadded);

  try {
    return timingSafeEqual(aPadded, bPadded) && a.length === b.length;
  } catch {
    return false;
  }
}

/**
* Validate Authorization header format using constant-time comparison
* SECURITY FIX: Issue 2 - Constant-time comparison for security
*/
export function validateAuthHeaderConstantTime(authHeader: string | undefined): boolean {
  if (!authHeader) {
    return false;
  }

  const prefix = 'Bearer ';
  if (authHeader.length <= prefix.length) {
    return false;
  }

  const actualPrefix = authHeader.slice(0, prefix.length);
  return constantTimeCompare(actualPrefix, prefix);
}

/**
* Validate JWT token format
* SECURITY FIX: Issue 2 - Token format validation
*/
export function validateTokenFormat(token: string): boolean {
  return TOKEN_FORMAT_REGEX.test(token);
}

/**
 * SECURITY: Allowed JWT algorithms whitelist.
 * Only HS256 is permitted. This prevents algorithm confusion attacks where
 * an attacker switches to RS256 (using a leaked public key as HMAC secret)
 * or "none" (removing signature verification entirely).
 */
const ALLOWED_ALGORITHMS = new Set(['HS256']);

/**
 * Pre-verification algorithm check (defense-in-depth).
 * Decodes the JWT header WITHOUT signature verification and rejects
 * disallowed algorithms BEFORE passing to jwt.verify(). This catches
 * algorithm confusion attacks even if the jsonwebtoken library has a
 * bypass bug in its algorithms option.
 *
 * @param token - Raw JWT string (already format-validated)
 * @throws {TokenInvalidError} if algorithm is not in ALLOWED_ALGORITHMS
 */
export function rejectDisallowedAlgorithm(token: string): void {
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || typeof decoded === 'string') {
    throw new TokenInvalidError('Unable to decode token header');
  }
  const alg = decoded.header?.alg;
  if (!alg || !ALLOWED_ALGORITHMS.has(alg)) {
    throw new TokenInvalidError(`Disallowed algorithm: ${alg || 'none'}`);
  }
}

// ============================================================================
// Key Management
// ============================================================================

/**
 * SECURITY: Detect PEM-formatted keys to prevent algorithm confusion.
 * If an RSA/EC public key is used as an HS256 secret, an attacker who
 * knows the public key can forge tokens.
 */
// Use literal spaces instead of \s+ to avoid nested quantifiers (ReDoS).
// PEM headers use single spaces per RFC 7468.
const PEM_PATTERN = /-----BEGIN (?:RSA )?(?:PUBLIC|PRIVATE|CERTIFICATE|EC) KEY-----/i;

function isPemKey(key: string): boolean {
  return PEM_PATTERN.test(key.trim());
}

function getKeys(): string[] {
  const key1 = process.env['JWT_KEY_1'];
  const key2 = process.env['JWT_KEY_2'];
  const keys: string[] = [];

  if (key1 && key1.length >= 32) {
    if (isPemKey(key1)) {
      throw new TokenInvalidError(
        'JWT_KEY_1 appears to be a PEM-formatted key. ' +
        'HS256 requires a symmetric secret, not an asymmetric key. ' +
        'Using a PEM key with HS256 enables algorithm confusion attacks.'
      );
    }
    keys.push(key1);
  }
  if (key2 && key2.length >= 32) {
    if (isPemKey(key2)) {
      throw new TokenInvalidError(
        'JWT_KEY_2 appears to be a PEM-formatted key. ' +
        'HS256 requires a symmetric secret, not an asymmetric key.'
      );
    }
    keys.push(key2);
  }

  return keys;
}

// P1-FIX: Support for key rotation without restart
// Store keys in a mutable array that can be reloaded
let currentKeys = getKeys();
let lastKeyReload = Date.now();
const KEY_RELOAD_INTERVAL_MS = 60000; // Reload every 60 seconds

/**
 * P1-FIX: Reload JWT keys from environment
 * Call this periodically to support hot key rotation
 */
export function reloadKeys(): void {
  currentKeys = getKeys();
  lastKeyReload = Date.now();
  logger.info('[jwt] Keys reloaded successfully');
}

/**
 * P1-FIX: Get current keys with automatic reload
 */
function getCurrentKeys(): string[] {
  const now = Date.now();
  if (now - lastKeyReload > KEY_RELOAD_INTERVAL_MS) {
    reloadKeys();
  }
  return currentKeys;
}

// F30-FIX: Removed `const KEYS = currentKeys` backward-compat export.
// It captured the array reference at module load time and was never
// refreshed by reloadKeys(), causing key rotation failure for any
// code that imported KEYS directly.

// ============================================================================
// Token Verification
// ============================================================================

/**
* Verify JWT claims structure using Zod
*/
function verifyJwtClaims(payload: unknown): JwtClaims {
  const result = JwtClaimsSchema.safeParse(payload);
  if (!result.success) {
    throw new TokenInvalidError(`Invalid claims: ${result.error.message}`);
  }
  return result.data;
}

/**
* Centralized JWT token verification
* Supports key rotation by trying multiple keys
*
* @param token - JWT token string
* @param options - Verification options
* @returns Verified JWT claims
* @throws {TokenInvalidError} When token is invalid
* @throws {TokenExpiredError} When token is expired
* 
* SECURITY FIX: Issue 2 - Centralized JWT validation
*/
export function verifyToken(
  token: string,
  options: VerifyOptions = {}
): JwtClaims {
  // P1-FIX: Get current keys with automatic reload
  const keys = getCurrentKeys();
  
  // Check if keys are configured
  if (keys.length === 0) {
    throw new TokenInvalidError('JWT signing keys not configured');
  }

  // Validate token format first
  if (!validateTokenFormat(token)) {
    throw new TokenInvalidError('Invalid token format');
  }

  // SECURITY FIX: Pre-verification algorithm check (defense-in-depth)
  // Reject disallowed algorithms before attempting signature verification
  rejectDisallowedAlgorithm(token);

  // SECURITY FIX: Constant-time verification to prevent timing attacks
  // Process all keys regardless of success/failure to maintain consistent timing
  let successResult: JwtClaims | null = null;
  let lastError: Error | null = null;

  for (const key of keys) {
    try {
      // SECURITY: Explicitly specify allowed algorithms to prevent algorithm confusion
      const payload = jwt.verify(token, key, {
        audience: options.audience || DEFAULT_AUDIENCE,
        issuer: options.issuer || DEFAULT_ISSUER,
        algorithms: ['HS256'],
        clockTolerance: JWT_CLOCK_TOLERANCE,
        // F29-FIX: ignoreExpiration removed - expired tokens must always be rejected
      });

      // Runtime validation with Zod
      const claims = verifyJwtClaims(payload);

      // Validate required claims
      if (!claims.sub) {
        lastError = new TokenInvalidError('Token missing required claim: sub');
      } else if (successResult === null) {
        // Store first successful result but continue processing for constant-time
        successResult = claims;
      }
    } catch (error) {
      // Continue to next key (constant-time behavior)
      if (error instanceof jwt.TokenExpiredError) {
        lastError = new TokenExpiredError(new Date(error.expiredAt));
      } else if (error instanceof AuthError) {
        lastError = error;
      } else {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }
  }

  // Return success if any key worked
  if (successResult !== null) {
    return successResult;
  }

  // Throw appropriate error
  throw lastError || new TokenInvalidError('verification failed');
}

/**
* Extract Bearer token from Authorization header
* Returns just the token string without verification
*
* @param authHeader - Authorization header value
* @returns Token string or null if invalid format
* SECURITY FIX: Issue 2 - Consistent token extraction
*/
export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader || !validateAuthHeaderConstantTime(authHeader)) {
    return null;
  }
  
  const token = authHeader.slice(7);
  
  if (!token || token.length < 10 || !validateTokenFormat(token)) {
    return null;
  }
  
  return token;
}

/**
* Extract and verify Bearer token from Authorization header
*
* @param authHeader - Authorization header value
* @returns Object with validation result and token/error
* SECURITY FIX: Issue 2 - Consistent token extraction
*/
export function extractAndVerifyToken(authHeader: string | undefined): {
  valid: boolean;
  claims?: JwtClaims;
  error?: string;
} {
  // Use constant-time comparison for header validation
  if (!authHeader || !validateAuthHeaderConstantTime(authHeader)) {
    return { valid: false, error: 'Missing or invalid Authorization header' };
  }

  const token = authHeader.slice(7);

  // Validate token format
  if (!token || token.length < 10 || !validateTokenFormat(token)) {
    return { valid: false, error: 'Invalid token format' };
  }

  try {
    const claims = verifyToken(token);
    return { valid: true, claims };
  } catch (error) {
    if (error instanceof TokenExpiredError) {
      return { valid: false, error: 'Token expired' };
    }
    if (error instanceof TokenInvalidError) {
      return { valid: false, error: error.message };
    }
    return { valid: false, error: 'Token verification failed' };
  }
}

/**
* Get authentication context from request headers
* Centralized auth extraction for use in route handlers
*
* @param headers - Request headers containing authorization
* @returns AuthContext or null if authentication fails
* SECURITY FIX: Issue 2 - Consistent auth context extraction
*/
export function getAuthContext(
  headers: { authorization?: string }
): AuthContext | null {
  const result = extractAndVerifyToken(headers.authorization);

  if (!result.valid || !result.claims) {
    return null;
  }

  const claims = result.claims;

  if (!claims.sub || !claims.orgId) {
    return null;
  }

  return {
    userId: claims.sub,
    orgId: claims.orgId,
    roles: claims.role ? [claims.role] : [],
    sessionId: claims.jti,
  };
}

/**
* Require authentication - throws if auth is missing or invalid
*
* @param headers - Request headers
* @returns AuthContext
* @throws {TokenInvalidError} When authentication fails
* SECURITY FIX: Issue 2 - Consistent auth requirement
*/
export function requireAuthContext(
  headers: { authorization?: string }
): AuthContext {
  const auth = getAuthContext(headers);

  if (!auth) {
    throw new TokenInvalidError('Authentication required');
  }

  return auth;
}

/**
 * Log auth event securely (sanitizes sensitive data)
 * @param event - Event type
 * @param data - Event data (will be sanitized)
 */
export function logAuthEvent(event: string, data: Record<string, unknown>): void {
  const sanitized = sanitizeForLogging(data);
  logger.info(`[Auth:${event}]`, sanitized as Record<string, unknown>);
}

// ============================================================================
// Re-export for backward compatibility
// ============================================================================

export { UserRoleSchema as RoleSchema };
