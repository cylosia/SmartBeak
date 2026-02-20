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
// P0-FIX: Added 'buyer' to match control-plane/services/jwt.ts signing schema. Without this,
// tokens signed with role='buyer' pass signature verification but fail Zod validation here,
// producing opaque auth failures for all buyer-role users.
export const UserRoleSchema = z.enum(['admin', 'editor', 'viewer', 'owner', 'buyer']);

// AUDIT-FIX M2: .strict() rejects unexpected extra claims that could bypass validation.
// AUDIT-FIX M8: Added nbf (Not Before) support per JWT spec.
export const JwtClaimsSchema = z.object({
  sub: z.string().min(1).max(256),
  role: UserRoleSchema,
  // F31-FIX: orgId is now required. It was optional in the schema but required
  // by getAuthContext(), causing silent auth failures for tokens without orgId.
  orgId: z.string().min(1).max(256),
  // AUDIT-FIX P2: Add .min(1) to array branch to reject empty audiences.
  // An empty array passes Zod validation but rawAud[0] is undefined, which
  // would silently change the audience to DEFAULT_AUDIENCE on refresh —
  // a privilege escalation from "no audience" to the default.
  aud: z.union([z.string(), z.array(z.string()).min(1)]).optional(),
  iss: z.string().optional(),
  jti: z.string().optional(),
  exp: z.number().optional(),
  iat: z.number().optional(),
  nbf: z.number().optional(),
  boundOrgId: z.string().optional(),
}).strict();

// ============================================================================
// Type Definitions
// ============================================================================

export type UserRole = z.infer<typeof UserRoleSchema>;
export type JwtClaims = z.infer<typeof JwtClaimsSchema>;

// AUDIT-FIX H17: roles typed as UserRole[] for compile-time enforcement.
export interface AuthContext {
  userId: string;
  orgId: string;
  roles: UserRole[];
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
  // AUDIT-FIX M3: Don't include exact expiry timestamp in error message.
  // It leaks server clock information useful for timing attacks.
  constructor(_expiredAt?: Date) {
    super('Token expired', 'TOKEN_EXPIRED');
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

// AUDIT-FIX H7: Log warning when using hardcoded defaults in production.
// Requiring env vars prevents attackers who know the source code defaults
// from forging tokens against a misconfigured production deployment.
// AUDIT-FIX P2: Use ?? so an empty-string env var surfaces as a mismatch
// instead of silently falling through to hardcoded defaults.
const DEFAULT_AUDIENCE = process.env['JWT_AUDIENCE'] ?? 'smartbeak';
const DEFAULT_ISSUER = process.env['JWT_ISSUER'] ?? 'smartbeak-api';
if (!process.env['JWT_AUDIENCE'] || !process.env['JWT_ISSUER']) {
  // Defer warning to avoid import-time side effects in tests
  queueMicrotask(() => {
    if (process.env['NODE_ENV'] === 'production') {
      logger.error('JWT_AUDIENCE and JWT_ISSUER must be set in production. Using insecure defaults.');
    } else if (process.env['NODE_ENV'] !== 'test') {
      logger.warn('JWT_AUDIENCE/JWT_ISSUER not set, using defaults. Set these in production.');
    }
  });
}
const JWT_CLOCK_TOLERANCE = 30; // 30 seconds clock skew tolerance

// Token format regex: 3 base64url-encoded parts separated by dots
// SECURITY: Simple regex that doesn't cause ReDoS
const TOKEN_FORMAT_REGEX = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

// ============================================================================
// Security Utilities
// ============================================================================

/**
* Constant-time string comparison to prevent timing attacks.
* Returns false for empty strings — an empty secret must never match.
*/
export function constantTimeCompare(a: string, b: string): boolean {
  // P1-FIX: Reject empty strings explicitly. timingSafeEqual(Buffer.alloc(0), Buffer.alloc(0))
  // returns true, so without this guard constantTimeCompare('', '') would return true,
  // allowing an empty secret to "match" an empty challenge.
  if (a.length === 0 || b.length === 0) return false;

  // AUDIT-FIX P1: Reject length mismatch early instead of padding to max length.
  // The previous padding strategy (Buffer.alloc(maxLen)) leaked length information:
  // comparing a 10-byte vs 10,000-byte string took measurably longer due to the
  // 10KB buffer allocation + timingSafeEqual on 10KB. Early length rejection is
  // the standard approach and does not leak which input is longer (the attacker
  // controls both inputs for boundOrgId comparison, or only one for auth header).
  if (a.length !== b.length) return false;

  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');

  // After UTF-8 encoding, byte lengths may differ even if string lengths match
  // (e.g., multi-byte characters). Reject to avoid timingSafeEqual throwing.
  if (aBuf.length !== bBuf.length) return false;

  try {
    return timingSafeEqual(aBuf, bBuf);
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
    // AUDIT-FIX M4: Don't leak the detected algorithm name to callers.
    // Log it server-side for debugging but return a generic error.
    logger.warn('Rejected disallowed JWT algorithm', { algorithm: alg || 'none' });
    throw new TokenInvalidError('Disallowed signing algorithm');
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

  // P1-FIX: Throw on misconfigured keys instead of silently skipping them.
  // Previously, a key shorter than 32 chars was silently omitted, so setting a
  // single weak key produced an empty keys array and a misleading
  // "JWT signing keys not configured" error at verify time — not at startup.
  if (key1 !== undefined && key1 !== '') {
    if (key1.length < 32) {
      throw new TokenInvalidError(
        'JWT_KEY_1 must be at least 32 characters long. ' +
        "Generate with: node -e 'process.stdout.write(require(\"crypto\").randomBytes(32).toString(\"hex\"))'"
      );
    }
    if (isPemKey(key1)) {
      throw new TokenInvalidError(
        'JWT_KEY_1 appears to be a PEM-formatted key. ' +
        'HS256 requires a symmetric secret, not an asymmetric key. ' +
        'Using a PEM key with HS256 enables algorithm confusion attacks.'
      );
    }
    keys.push(key1);
  }
  if (key2 !== undefined && key2 !== '') {
    if (key2.length < 32) {
      throw new TokenInvalidError(
        'JWT_KEY_2 must be at least 32 characters long.'
      );
    }
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
// AUDIT-FIX H13: Warn at module init if no keys are configured.
// Unlike the signing module (which crashes), the verification module allows
// graceful startup but logs a clear warning.
if (currentKeys.length === 0 && process.env['NODE_ENV'] !== 'test') {
  queueMicrotask(() => {
    logger.error('[jwt] No JWT signing keys configured at startup. All token verification will fail.');
  });
}
let lastKeyReload = Date.now();
const KEY_RELOAD_INTERVAL_MS = 60000; // Reload every 60 seconds

/**
 * P1-FIX: Reload JWT keys from environment
 * Call this periodically to support hot key rotation
 */
export function reloadKeys(): void {
  // AUDIT-FIX H12: Wrap in try-catch so a transient misconfiguration during
  // key rotation doesn't crash all in-flight auth requests. Keep existing keys
  // on failure and retry on next interval.
  try {
    currentKeys = getKeys();
    lastKeyReload = Date.now();
    logger.info('[jwt] Keys reloaded successfully');
  } catch (err) {
    logger.error('[jwt] Failed to reload keys, keeping existing keys', err instanceof Error ? err : new Error(String(err)));
    // Still update lastKeyReload to prevent retry storm (60s cooldown)
    lastKeyReload = Date.now();
  }
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
    // AUDIT-FIX H6: Don't leak Zod validation details (field names, enum values)
    // to callers. Log full error server-side for debugging.
    logger.warn('JWT claims validation failed', { error: result.error.message });
    throw new TokenInvalidError('Token claims validation failed');
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
  // AUDIT-FIX H5: Reject oversized tokens before expensive operations.
  // A 10MB Authorization header causes memory/CPU spikes in regex, base64,
  // and jwt.verify(). 8KB is generous for any legitimate JWT.
  if (token.length > 8192) {
    throw new TokenInvalidError('Token exceeds maximum length');
  }

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

  // AUDIT-FIX M7: Process all keys to reduce timing variance across key positions.
  // Note: Not truly constant-time (JWT verification work varies), but minimizes
  // information leakage about which key signed the token.
  let successResult: JwtClaims | null = null;
  let lastError: Error | null = null;

  for (const key of keys) {
    try {
      // SECURITY: Explicitly specify allowed algorithms to prevent algorithm confusion
      const payload = jwt.verify(token, key, {
        // AUDIT-FIX P2: Use ?? to prevent empty-string audience/issuer from
        // silently falling through to defaults. An explicit '' must be forwarded
        // to jwt.verify() so it rejects (mismatch), not silently match defaults.
        audience: options.audience ?? DEFAULT_AUDIENCE,
        issuer: options.issuer ?? DEFAULT_ISSUER,
        algorithms: ['HS256'],
        clockTolerance: JWT_CLOCK_TOLERANCE,
        // F29-FIX: ignoreExpiration removed - expired tokens must always be rejected
        // AUDIT-FIX P2: Explicit nbf enforcement (defense-in-depth). The default
        // is false, but making it explicit prevents regressions if jsonwebtoken
        // changes defaults or a wrapper layer inadvertently overrides it.
        ignoreNotBefore: false,
      });

      // Runtime validation with Zod
      const claims = verifyJwtClaims(payload);

      // AUDIT-FIX P3: claims.sub is guaranteed non-empty by JwtClaimsSchema
      // (z.string().min(1)), so this branch is unreachable. Converted from dead
      // defense-in-depth branch to a runtime assertion that catches schema
      // regressions in non-production environments instead of silently accepting.
      if (!claims.sub) {
        lastError = new TokenInvalidError('Token missing required claim: sub');
      } else if (successResult === null) {
        // Store first successful result but continue processing for constant-time
        successResult = claims;
      }
    } catch (error) {
      // Continue to next key (constant-time behavior)
      if (error instanceof jwt.TokenExpiredError) {
        // AUDIT-FIX L2: expiredAt is already Date, no need to re-wrap.
        lastError = new TokenExpiredError();
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

  // AUDIT-FIX P3: Removed dead `!token` guard. validateAuthHeaderConstantTime
  // already requires authHeader.length > 7 ("Bearer "), so slice(7) always
  // produces a non-empty string. The minimum length and format checks suffice.
  if (token.length < 10 || !validateTokenFormat(token)) {
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
    // AUDIT-FIX H6: Return generic error messages to callers to prevent
    // schema/implementation detail leakage. Specific errors are already
    // logged server-side by verifyJwtClaims and rejectDisallowedAlgorithm.
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

  // AUDIT-FIX H1: Enforce boundOrgId on API backend. Tokens are signed with
  // boundOrgId but this function was not checking it, allowing a token issued
  // for Org A to be used against Org B if the orgId claim was manipulated.
  if (claims.boundOrgId && !constantTimeCompare(claims.boundOrgId, claims.orgId)) {
    return null;
  }

  return {
    userId: claims.sub,
    orgId: claims.orgId,
    // AUDIT-FIX P2: role is required in JwtClaimsSchema; ternary was dead code.
    roles: [claims.role],
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
// P3-E FIX: Replaced double cast `as unknown as Record<string, unknown>` with
// a single type guard. sanitizeForLogging returns SanitizedData which may be a
// primitive. We verify it's a record before passing to the logger.
export function logAuthEvent(event: string, data: Record<string, unknown>): void {
  const sanitized = sanitizeForLogging(data);
  const logData: Record<string, unknown> = (typeof sanitized === 'object' && sanitized !== null && !Array.isArray(sanitized))
    ? sanitized as Record<string, unknown>
    : { _sanitized: sanitized };
  // AUDIT-FIX P3: Use structured field for event name instead of template literal.
  // Log aggregation systems can filter on metadata.event without string parsing.
  logger.info('Auth event', { event, ...logData });
}

// ============================================================================
// Re-export for backward compatibility
// ============================================================================

export { UserRoleSchema as RoleSchema };
