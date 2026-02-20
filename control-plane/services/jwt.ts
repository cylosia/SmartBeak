import jwt from 'jsonwebtoken';
import Redis from 'ioredis';
import { z } from 'zod';

import { getLogger } from '../../packages/kernel/logger';
import { randomBytes } from 'crypto';
import { AuthError } from '@kernel/auth';
import { rejectDisallowedAlgorithm, verifyToken as securityVerifyToken } from '../../packages/security/jwt';


/**
* JWT Service
* Token generation, revocation with security best practices
*
* DELEGATED: Token verification logic has been moved to packages/security/auth.ts
* This file now focuses on:
* - Token generation (signing)
* - Redis-based token revocation
* - Key management
*/

const logger = getLogger('JwtService');

// Type exports at top level
// P0-FIX: Added 'owner' role to match packages/security/jwt.ts UserRoleSchema
// SECURITY-FIX: Added 'buyer' role — buyer-role JWTs must parse without throwing
export type UserRole = 'admin' | 'editor' | 'viewer' | 'owner' | 'buyer';
// AUDIT-FIX P1: jti, iat, exp are optional in the security package's Zod schema
// (JwtClaimsSchema). Declaring them required here was a type-lie: verifyToken()
// returns the security package's type where these are optional, so callers that
// access claims.jti / claims.iat / claims.exp believing they are guaranteed
// non-undefined can crash or produce NaN. Aligned to match the actual runtime
// shape. Callers MUST null-check before using these fields.
export interface JwtClaims {
  sub: string;
  role: UserRole;
  // P0-5 FIX: orgId is required to match verification schema in packages/security/jwt.ts
  orgId: string;
  // AUDIT-FIX P1: aud type must match packages/security/jwt.ts JwtClaimsSchema which
  // uses z.union([z.string(), z.array(z.string())]). JWT spec (RFC 7519 §4.1.3)
  // allows aud to be a single string or an array of strings. Without the array type,
  // the return from securityVerifyToken was not assignable to this interface.
  aud?: string | string[] | undefined;
  iss?: string | undefined;
  jti?: string | undefined;
  iat?: number | undefined;
  exp?: number | undefined;
  // AUDIT-FIX P1: Added nbf to match security package JwtClaimsSchema
  nbf?: number | undefined;
  boundOrgId?: string | undefined;
}

// Re-export from unified auth package for backward compatibility
export {
  AuthError as JwtError,
};

// ============================================================================
// Zod Schemas
// ============================================================================

// P0-FIX: Added 'owner' to match packages/security/jwt.ts and prevent Zod validation
// failures when creating tokens for org owners.
export const UserRoleSchema = z.enum(['admin', 'editor', 'viewer', 'owner', 'buyer']);

export const JwtClaimsInputSchema = z.object({
  sub: z.string().min(1).max(256),
  role: UserRoleSchema,
  // P0-5 FIX: orgId is required to match verification schema in packages/security/jwt.ts
  // Tokens without orgId will fail Zod validation during verification, causing silent 401s.
  orgId: z.string().min(1).max(256),
  aud: z.string().min(1).max(256).optional(),
  iss: z.string().min(1).max(256).optional(),
  expiresIn: z.string().regex(/^\d+\s*(ms|s|m|h|d|w)$/).optional(),
});

export const VerifyOptionsSchema = z.object({
  audience: z.string().optional(),
  issuer: z.string().optional(),
  // F29-FIX: Removed ignoreExpiration - expired tokens must always be rejected
});

export const TokenMetadataSchema = z.object({
  jti: z.string(),
  iat: z.number(),
  exp: z.number(),
  boundOrgId: z.string().optional(),
});

// ============================================================================
// Type Definitions
// ============================================================================

export type JwtClaimsInput = z.infer<typeof JwtClaimsInputSchema>;
export type VerifyOptions = z.infer<typeof VerifyOptionsSchema>;
export type TokenMetadata = z.infer<typeof TokenMetadataSchema>;

/**
* Sign token input (without auto-generated fields)
*/
export interface SignTokenInput {
  sub: string;
  role: UserRole;
  // P0-5 FIX: orgId is required to match verification schema
  orgId: string;
  aud?: string;
  iss?: string;
  expiresIn?: string;
}

/**
* Token verification result with decoded claims
*/
export interface VerifyResult {
  claims: JwtClaims;
  isValid: boolean;
  isExpired: boolean;
  isRevoked: boolean;
}

/**
* Token metadata for external storage
*/
// AUDIT-FIX C2: isRevoked changed to `boolean | null`. getTokenInfo() uses
// jwt.decode() which cannot determine revocation status (requires Redis).
// Returning `false` or casting `undefined as unknown as boolean` was a type-lie
// that made revoked tokens appear valid to consumers.
export interface TokenInfo {
  jti: string;
  sub: string;
  role: UserRole;
  orgId?: string | undefined;
  issuedAt: Date;
  expiresAt: Date;
  /** null = unknown (no Redis check performed). Use verifyToken() for authoritative status. */
  isRevoked: boolean | null;
}

/**
* Circuit breaker state
*/
export interface CircuitBreakerState {
  failures: number;
  lastFailure: number;
  isOpen: boolean;
}

/**
* Time unit for parseMs function
*/
export type TimeUnit = 'ms' | 's' | 'm' | 'h' | 'd' | 'w';

// ============================================================================
// Error Types (additional service-specific errors)
// ============================================================================

class TokenInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenInvalidError';
  }
}

export class InvalidKeyError extends AuthError {
  override name: string;
  constructor(message: string) {
  super(message, 'INVALID_KEY');
  this.name = 'InvalidKeyError';
  }
}

// ============================================================================
// Constants
// ============================================================================

const MAX_TOKEN_LIFETIME = '24h';
const DEFAULT_TOKEN_LIFETIME = '1h';
// AUDIT-FIX P2: Use ?? so an empty-string env var surfaces as a mismatch
// instead of silently falling through to hardcoded defaults.
const DEFAULT_AUDIENCE = process.env['JWT_AUDIENCE'] ?? 'smartbeak';
const DEFAULT_ISSUER = process.env['JWT_ISSUER'] ?? 'smartbeak-api';

const REVOCATION_KEY_PREFIX = 'jwt:revoked:';
const REVOCATION_TTL_SECONDS = 86400 * 7; // 7 days

const CIRCUIT_BREAKER_THRESHOLD = 5;
const CIRCUIT_BREAKER_TIMEOUT = 30000; // 30 seconds

// ============================================================================
// Time Parsing
// ============================================================================

/**
* Parse time strings like '1h', '24h', '7d' to milliseconds
* SECURITY FIX: Simple ms parser to avoid external dependency
*
* @param timeStr - Time string to parse
* @returns Milliseconds
*/
function parseMs(timeStr: string): number {
  const match = timeStr.match(/^(\d+)\s*(ms|s|m|h|d|w)$/i);
  if (!match) {
    // AUDIT-FIX P2: Throw on invalid input instead of silently defaulting.
    // For a security-sensitive function controlling token lifetime, a silent
    // 1h default could grant longer access than intended.
    throw new TokenInvalidError(
      `Invalid time string: "${timeStr}". Expected format: <number><unit> (e.g., "1h", "30m", "7d")`
    );
  }

  const value = parseInt(match[1]!, 10);
  const unit = match[2]!.toLowerCase() as TimeUnit;

  const multipliers: Record<TimeUnit, number> = {
  ms: 1,
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
  };

  return value * multipliers[unit];
}

// ============================================================================
// Key Management
// ============================================================================

/**
* Get JWT signing keys from environment
* Require explicit keys - no fallbacks for security
*
* @returns Array of signing keys
* @throws {InvalidKeyError} When keys are invalid
*/
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

  if (!key1 || key1.length < 32) {
  throw new InvalidKeyError(
    'JWT_KEY_1 environment variable is required and must be at least 32 characters long. ' +
    "Generate a secure key with: node -e 'process.stdout.write(require(\"crypto\").randomBytes(32).toString(\"hex\"))'"
  );
  }

  if (!key2 || key2.length < 32) {
  throw new InvalidKeyError(
    'JWT_KEY_2 environment variable is required and must be at least 32 characters long. ' +
    "This key is used for key rotation. Generate with: node -e 'process.stdout.write(require(\"crypto\").randomBytes(32).toString(\"hex\"))'"
  );
  }

  // P0-3 FIX: Use word-boundary anchors to prevent false positives.
  // The previous regex `/placeholder|example|test|demo|secret|key/i` matched the
  // substring "key" within randomly generated hex strings (e.g. "a1b2...keY5f6..."),
  // causing startup crashes after key rotation. Now uses `\b` word boundaries
  // consistent with packages/config/env.ts PLACEHOLDER_PATTERN.
  const placeholderPatterns = /\bplaceholder\b|\bexample\b|^test$|^demo$|^secret$|\bchangeme\b/i;
  if (placeholderPatterns.test(key1) || key1.includes('your_')) {
  throw new InvalidKeyError('JWT_KEY_1 appears to be a placeholder value. Please set a secure random key.');
  }
  if (placeholderPatterns.test(key2) || key2.includes('your_')) {
  throw new InvalidKeyError('JWT_KEY_2 appears to be a placeholder value. Please set a secure random key.');
  }

  // SECURITY FIX: Reject PEM-formatted keys to prevent algorithm confusion.
  // Using an RSA/EC public key as HS256 secret enables token forgery.
  if (isPemKey(key1)) {
  throw new InvalidKeyError(
    'JWT_KEY_1 appears to be a PEM-formatted key. ' +
    'HS256 requires a symmetric secret, not an asymmetric key.'
  );
  }
  if (isPemKey(key2)) {
  throw new InvalidKeyError(
    'JWT_KEY_2 appears to be a PEM-formatted key. ' +
    'HS256 requires a symmetric secret, not an asymmetric key.'
  );
  }

  return [key1, key2];
}

// AUDIT-FIX H3: Support key rotation without restart. Previously used static
// `const KEYS = getKeys()` that was loaded once at module init. After key
// rotation, the signing module would use stale keys that the verification
// module no longer accepts, causing complete auth outage.
// AUDIT-FIX H14: Typed as readonly tuple to prevent KEYS[0]! on empty array.
// Previously `KEYS[0]!` would pass `undefined` to jwt.sign, signing with
// "undefined" string — trivially forgeable tokens.
let signingKeys: readonly string[] = getKeys();
let lastSigningKeyReload = Date.now();
const SIGNING_KEY_RELOAD_INTERVAL_MS = 60000; // Reload every 60 seconds

function getCurrentSigningKeys(): readonly string[] {
  const now = Date.now();
  if (now - lastSigningKeyReload > SIGNING_KEY_RELOAD_INTERVAL_MS) {
    try {
      signingKeys = getKeys();
      lastSigningKeyReload = now;
      logger.info('[jwt] Signing keys reloaded successfully');
    } catch (err) {
      logger.error('[jwt] Failed to reload signing keys, keeping existing keys',
        err instanceof Error ? err : new Error(String(err)));
      lastSigningKeyReload = now; // Prevent retry storm
    }
  }
  return signingKeys;
}

// P2-A FIX: Removed dead `const KEYS = signingKeys` backward-compat alias.
// It captured the array reference at module load time and was never refreshed
// by getCurrentSigningKeys(), creating a stale-key hazard after rotation.

// ============================================================================
// Redis Connection (Lazy Initialization)
// ============================================================================

// P1-5 FIX: Defer Redis connection to first use instead of module-level throw.
// Module-level throw crashes any file that imports this module (tests, CLI tools,
// type-only imports) if REDIS_URL is not set.
// AUDIT-FIX M14: Use a pending promise to prevent duplicate connections from
// concurrent calls during initialization.
let redis: Redis | null = null;
// P2-B FIX: Removed dead `redisInitPromise` variable. getRedisClient() is
// synchronous (ioredis connects lazily), so the async init promise was never
// assigned or used. Dead code that misleads maintainers into thinking there's
// an async initialization path.

// Circuit breaker state
const circuitBreaker: CircuitBreakerState = {
  failures: 0,
  lastFailure: 0,
  isOpen: false,
};

// AUDIT-FIX M14: Prevent duplicate Redis connections from concurrent calls.
function getRedisClient(): Redis {
  if (redis) return redis;

  // Synchronous init (ioredis connects lazily, so this is safe)
  const url = process.env['REDIS_URL'];
  if (!url) {
    throw new Error('REDIS_URL environment variable is required');
  }

  // AUDIT-FIX P3: Removed dead double-check. Node.js is single-threaded and no
  // async operation occurs between the first `if (redis)` check and this point,
  // so no other code can initialize redis in the interim.

  const client = new Redis(url, {
    retryStrategy: (times: number): number => Math.min(times * 50, 2000),
    maxRetriesPerRequest: 3,
  });

  client.on('error', (err: Error) => {
    logger.error('Redis connection error', err);
  });

  redis = client;
  return redis;
}

// ============================================================================
// Token Generation
// ============================================================================

/**
* Generate a unique token ID using cryptographically secure randomness
* SECURITY FIX: Replaced Math.random() with crypto.randomBytes
*
* @returns Unique token ID
*/
function generateTokenId(): string {
  return `${Date.now()}-${randomBytes(16).toString('hex')}`;
}

/**
* Calculate token expiration in milliseconds
* Enforces maximum 24h lifetime
*
* @param requestedExpiry - Requested expiration time string
* @returns Expiration time in milliseconds
*/
function calculateExpiration(requestedExpiry?: string): number {
  const requested = requestedExpiry || DEFAULT_TOKEN_LIFETIME;
  const requestedMs = parseMs(requested);
  const maxMs = parseMs(MAX_TOKEN_LIFETIME);
  return Math.min(requestedMs, maxMs);
}

/**
* Sign a JWT token with claims
* SECURITY FIX: Enforce maximum 24h token lifetime
*
* @param claimsInput - Token claims (without auto-generated fields)
* @returns Signed JWT token string
* @throws {InvalidKeyError} When signing keys are invalid
*/
export function signToken(claimsInput: SignTokenInput): string {
  // Validate input
  const validated = JwtClaimsInputSchema.parse(claimsInput);

  // AUDIT-FIX P2: Use ?? to prevent empty-string values from falling through.
  const tokenAud = validated.aud ?? DEFAULT_AUDIENCE;
  const tokenIss = validated.iss ?? DEFAULT_ISSUER;

  // SECURITY FIX: Enforce maximum token lifetime of 24 hours
  const expiresInMs = calculateExpiration(validated.expiresIn);

  // AUDIT-FIX L4: Removed redundant double-cast.
  const payload = {
  sub: validated.sub,
  role: validated.role,
  orgId: validated["orgId"],
  jti: generateTokenId(),
  boundOrgId: validated["orgId"],
  };

  // AUDIT-FIX H3/H14: Use getCurrentSigningKeys() for hot reload support.
  const keys = getCurrentSigningKeys();
  const primaryKey = keys[0];
  if (!primaryKey) {
    throw new TokenInvalidError('No signing keys available');
  }
  // AUDIT-FIX P3: Removed double `as` cast. Assign to typed variable so
  // TypeScript checks the options object structurally.
  const signOptions: jwt.SignOptions = {
    algorithm: 'HS256',
    expiresIn: Math.floor(expiresInMs / 1000),
    audience: tokenAud,
    issuer: tokenIss,
  };
  return jwt.sign(payload, primaryKey, signOptions);
}

// ============================================================================
// Token Revocation
// ============================================================================

/**
* Check if circuit breaker is open
*/
function isCircuitOpen(): boolean {
  if (!circuitBreaker.isOpen) return false;

  const now = Date.now();
  if (now - circuitBreaker.lastFailure < CIRCUIT_BREAKER_TIMEOUT) {
  return true;
  }

  // Reset circuit breaker
  circuitBreaker.isOpen = false;
  circuitBreaker.failures = 0;
  return false;
}

/**
* Record a failure and potentially open the circuit
*/
function recordFailure(error: unknown): void {
  circuitBreaker.failures++;
  circuitBreaker.lastFailure = Date.now();

  if (circuitBreaker.failures >= CIRCUIT_BREAKER_THRESHOLD) {
  circuitBreaker.isOpen = true;
  logger.error('Circuit breaker opened due to persistent Redis failures', new Error('CircuitBreakerOpen'));
  }

  logger.error('Redis unavailable for revocation check, rejecting token (fail-closed)', error instanceof Error ? error : new Error(String(error)));
}

/**
 * Check if a specific token JTI is revoked in Redis.
 * Also checks for user-wide revocation (revokeAllUserTokens).
 *
 * P0-FIX: Was previously prefixed `_isTokenRevoked` (dead-code convention) and
 * never called. `verifyToken` delegated to securityVerifyToken with NO revocation
 * check, making `revokeToken`/`revokeAllUserTokens` completely non-functional.
 *
 * @param jti    - The token's unique ID (jti claim)
 * @param userId - The token's subject (sub claim) — used for user-wide revocation
 * @returns Whether the token should be treated as revoked
 */
export async function isTokenRevoked(jti: string, userId: string): Promise<boolean> {
  // P0-2 FIX: Fail-closed when Redis is unavailable. When the circuit breaker
  // is open, we cannot verify revocation status, so we MUST reject the token.
  // Previously this returned false (fail-open), meaning revoked tokens were
  // accepted during any Redis outage.
  if (isCircuitOpen()) {
    logger.error('Circuit breaker open, rejecting token (fail-closed: cannot verify revocation)');
    throw new AuthError('Token verification unavailable (revocation check failed)', 'REVOCATION_CHECK_FAILED');
  }

  // AUDIT-FIX M16: Validate token ID and user ID to prevent key injection.
  // Colons in jti/userId could collide with the namespace separator.
  // P2-C FIX: Validation errors are thrown BEFORE the try/catch block so they
  // don't trigger recordFailure(). Previously, input validation errors incremented
  // the circuit breaker's failure counter, allowing an attacker with a valid signing
  // key to poison the circuit breaker by sending tokens with ':' in jti/userId,
  // opening the breaker and denying service to ALL users for 30 seconds.
  if (jti.includes(':') || userId.includes(':')) {
    throw new AuthError('Invalid token identifier', 'INVALID_TOKEN_ID');
  }

  try {
    const client = getRedisClient();

    // Check both per-token revocation AND user-wide revocation in a single pipeline
    const results = await client.pipeline()
      .exists(`${REVOCATION_KEY_PREFIX}${jti}`)
      .exists(`jwt:revoked:user:${userId}`)
      .exec();

    // AUDIT-FIX H4: Validate pipeline results are non-null and check per-command
    // error tuples. If pipeline.exec() returns null (connection lost mid-pipeline),
    // or if any command errored, fail-closed instead of treating as "not revoked".
    if (!results || results.length < 2) {
      throw new AuthError('Revocation check failed: incomplete pipeline result', 'REVOCATION_CHECK_FAILED');
    }
    // AUDIT-FIX P1: Replace non-null assertions with explicit null guards.
    // TypeScript can't narrow array element types from a length check, so
    // destructured values are `T | undefined`. Explicit guards prevent
    // TypeError if Redis returns malformed pipeline data.
    const jtiRevoked = results[0];
    const userRevoked = results[1];
    if (!jtiRevoked || !userRevoked) {
      throw new AuthError('Revocation check failed: malformed pipeline result', 'REVOCATION_CHECK_FAILED');
    }
    if (jtiRevoked[0] || userRevoked[0]) {
      throw new AuthError('Revocation check failed: pipeline command error', 'REVOCATION_CHECK_FAILED');
    }

    // Success - reset failure count
    circuitBreaker.failures = 0;

    // Pipeline results are [error, value] tuples
    const jtiResult = jtiRevoked[1];
    const userResult = userRevoked[1];
    return jtiResult === 1 || userResult === 1;
  } catch (error) {
    // AUDIT-FIX P2: Don't count our own AuthErrors (pipeline validation failures)
    // toward the circuit breaker. Those are expected fail-closed responses, not
    // infrastructure failures. Counting them allows transient Redis pipeline
    // anomalies to open the circuit breaker, causing a 30s full auth outage.
    //
    // AUDIT-FIX P1: Use name-based check as secondary guard for cross-module
    // AuthError class mismatch. This file imports AuthError from @kernel/auth,
    // but packages/security/jwt.ts defines its own AuthError. If a refactor
    // introduces security-module errors into this try block, instanceof would
    // silently fail, routing auth errors into recordFailure() and polluting
    // the circuit breaker. The name check catches both class variants.
    if (error instanceof AuthError || (error instanceof Error && error.name === 'AuthError')) {
      throw error;
    }
    recordFailure(error);
    // P0-2 FIX: Fail-closed — reject token when revocation status cannot be determined.
    // Token signature verification alone is insufficient when revocation is a security control.
    throw new AuthError('Token verification unavailable (revocation check failed)', 'REVOCATION_CHECK_FAILED');
  }
}

/**
* Revoke a token by its ID
*
* @param tokenId - Token ID to revoke
* @throws {JwtError} When revocation fails
*/
export async function revokeToken(tokenId: string): Promise<void> {
  // AUDIT-FIX M16: Validate tokenId to prevent Redis key injection via colons.
  if (tokenId.includes(':')) {
    throw new AuthError('Invalid token identifier', 'INVALID_TOKEN_ID');
  }
  try {
  await getRedisClient().setex(`${REVOCATION_KEY_PREFIX}${tokenId}`, REVOCATION_TTL_SECONDS, '1');
  } catch (error) {
  logger.error('Error revoking token', error instanceof Error ? error : new Error(String(error)));
  throw new AuthError('Failed to revoke token', 'REVOCATION_FAILED');
  }
}

/**
* Revoke all tokens for a user
* Adds user ID to a revocation list that can be checked during verification
*
* @param userId - User ID to revoke all tokens for
* @throws {JwtError} When revocation fails
*/
export async function revokeAllUserTokens(userId: string): Promise<void> {
  // AUDIT-FIX M16: Validate userId to prevent Redis key injection via colons.
  if (userId.includes(':')) {
    throw new AuthError('Invalid user identifier', 'INVALID_USER_ID');
  }
  try {
  const key = `jwt:revoked:user:${userId}`;
  await getRedisClient().setex(key, REVOCATION_TTL_SECONDS, Date.now().toString());
  // P2-1 FIX: Avoid logging userId directly (potential PII)
  logger.info('Revoked all tokens for user', { userId: userId.substring(0, 8) + '...' });
  } catch (error) {
  logger.error('Error revoking user tokens', error instanceof Error ? error : new Error(String(error)));
  throw new AuthError('Failed to revoke user tokens', 'USER_REVOCATION_FAILED');
  }
}

// ============================================================================
// Token Verification (DELEGATED to unified auth package)
// ============================================================================

/**
 * Verify a JWT token including Redis revocation check.
 * Delegates signature verification to packages/security/jwt.ts, then checks
 * per-token and user-wide revocation lists.
 *
 * P0-FIX: Previously synchronous and skipped the revocation check entirely,
 * making revokeToken() and revokeAllUserTokens() security theatre.
 *
 * @param token - JWT token string
 * @param aud   - Expected audience
 * @param iss   - Expected issuer
 * @returns Verified claims
 * @throws {TokenInvalidError} When token is invalid or revoked
 */
export async function verifyToken(
  token: string,
  aud: string = DEFAULT_AUDIENCE,
  iss: string = DEFAULT_ISSUER
): Promise<JwtClaims> {
  // Step 1: verify signature and standard claims (synchronous, throws on failure)
  // AUDIT-FIX M9: securityVerifyToken returns Zod-validated claims. The `as JwtClaims`
  // cast masked the optional/required field mismatch. This is now safe since both
  // schemas are aligned (jti/iat/exp are optional in verification but present in signed tokens).
  const claims = securityVerifyToken(token, { audience: aud, issuer: iss });

  // Step 2: check revocation lists (async Redis lookup)
  // P2-D FIX: Log a warning when jti is missing. Without jti, the token cannot
  // be individually revoked and revokeToken() is ineffective for it. signToken()
  // always generates a jti, so a missing jti indicates a non-standard token source.
  // User-wide revocation (revokeAllUserTokens) still works via the sub claim.
  if (claims.jti) {
    const revoked = await isTokenRevoked(claims.jti, claims.sub);
    if (revoked) {
      throw new AuthError('Token has been revoked', 'TOKEN_REVOKED');
    }
  } else {
    // AUDIT-FIX P2: Even without jti, check user-wide revocation.
    // Previously the entire revocation check was skipped, allowing tokens
    // without jti to bypass revokeAllUserTokens() — a security gap.
    try {
      const client = getRedisClient();
      const userRevoked = await client.exists(`jwt:revoked:user:${claims.sub}`);
      if (userRevoked === 1) {
        throw new AuthError('Token has been revoked', 'TOKEN_REVOKED');
      }
    } catch (err) {
      // AUDIT-FIX P1: Name-based secondary guard (same cross-module rationale as isTokenRevoked)
      if (err instanceof AuthError || (err instanceof Error && err.name === 'AuthError')) throw err;
      // Fail-closed: if Redis is unavailable, reject the token
      throw new AuthError('Token verification unavailable (revocation check failed)', 'REVOCATION_CHECK_FAILED');
    }
    logger.warn('[jwt] Token verified without jti claim — individual revocation is not possible for this token', {
      sub: claims.sub.substring(0, 8) + '...',
    });
  }

  return claims;
}

// ============================================================================
// Token Utilities
// ============================================================================

/**
* Get token expiration time
*
* @param token - JWT token string
* @returns Expiration date or null if unable to parse
*/
// AUDIT-FIX M10: Safer type narrowing instead of unsafe `as` cast.
export function getTokenExpiration(token: string): Date | null {
  try {
    const decoded = jwt.decode(token);
    if (decoded && typeof decoded === 'object' && 'exp' in decoded && typeof decoded['exp'] === 'number') {
      return new Date(decoded['exp'] * 1000);
    }
    return null;
  } catch {
    return null;
  }
}

/**
* Check if token is expired
*
* @param token - JWT token string
* @returns Whether the token is expired
*/
export function isTokenExpired(token: string): boolean {
  const exp = getTokenExpiration(token);
  if (!exp) return true;
  return exp.getTime() < Date.now();
}

/**
* AUDIT-FIX H16: Renamed from getTokenInfo to unsafeDecodeTokenInfo to make it
* clear this uses jwt.decode() (NO signature verification). The returned data
* is unverified and MUST NOT be used for authorization decisions.
*
* AUDIT-FIX C2: isRevoked is now `null` (unknown) instead of
* `undefined as unknown as boolean` which was a type-lie.
*
* @param token - JWT token string
* @returns Token info or null if invalid. Data is UNVERIFIED.
*/
export function unsafeDecodeTokenInfo(token: string): TokenInfo | null {
  // P2-E FIX: jwt.decode() returns JwtPayload | string | null. The previous
  // `as { ... } | null` cast hid the string case, which would produce an object
  // with all-undefined properties (silently wrong data). Use proper narrowing.
  const raw = jwt.decode(token);
  if (!raw || typeof raw === 'string') return null;
  const decoded = raw as { jti?: string; sub?: string; role?: string; orgId?: string; iat?: number; exp?: number };

  // AUDIT-FIX P2: Reject tokens with unknown/invalid roles instead of silently
  // assigning 'viewer'. A token with role: "superadmin" was previously downgraded
  // to viewer, granting read access to an unrecognized principal.
  const roleResult = UserRoleSchema.safeParse(decoded['role']);
  if (!roleResult.success) {
    return null;
  }
  const role: UserRole = roleResult.data;

  // AUDIT-FIX P3: Reject tokens missing required claims instead of fabricating
  // data. Empty-string jti could collide with revocation keys. Fabricated
  // new Date() for iat/exp makes tokens appear freshly issued and not expired.
  if (!decoded['jti'] || !decoded['sub'] || !decoded['iat'] || !decoded['exp']) {
    return null;
  }

  return {
    jti: decoded['jti'] as string,
    sub: decoded['sub'] as string,
    role,
    orgId: decoded['orgId'] as string | undefined,
    issuedAt: new Date((decoded['iat'] as number) * 1000),
    expiresAt: new Date((decoded['exp'] as number) * 1000),
    // AUDIT-FIX C2: null = unknown. Cannot determine revocation without Redis.
    isRevoked: null,
  };
}

/** @deprecated Use unsafeDecodeTokenInfo instead. This alias exists for backward compatibility. */
export const getTokenInfo = unsafeDecodeTokenInfo;

/**
* Refresh a token
* Creates a new token with the same claims but extended expiration
*
* @param token - Existing JWT token
* @param expiresIn - New expiration time
* @returns New signed token
*/
/**
 * AUDIT-FIX C1: refreshToken is now ASYNC and delegates to verifyToken()
 * which includes Redis revocation checks. Previously synchronous and only
 * checked the signature, allowing revoked tokens to be refreshed into new
 * valid tokens — completely defeating the revocation system.
 *
 * AUDIT-FIX H15: Role is validated with UserRoleSchema.parse() instead of
 * an unsafe `as UserRole` cast that could silently upgrade empty/unknown roles.
 *
 * AUDIT-FIX M11: Uses verifyToken() which tries all keys uniformly,
 * eliminating the timing side-channel that revealed which key signed the token.
 *
 * AUDIT-FIX M12: Handles JWT spec aud as string | string[].
 * AUDIT-FIX M15: Preserves original error details instead of swallowing them.
 */
export async function refreshToken(token: string): Promise<string> {
  // SECURITY FIX: Pre-verification algorithm check (defense-in-depth)
  rejectDisallowedAlgorithm(token);

  // C1-FIX: Use verifyToken() which includes revocation check via Redis.
  // Previously used raw jwt.verify() which only checked the signature,
  // allowing revoked tokens to be refreshed into new valid tokens.
  const claims = await verifyToken(token);

  const sub = claims.sub;
  // AUDIT-FIX H15: Validate role with Zod schema instead of unsafe cast.
  // Previously `(verified['role'] || 'viewer') as UserRole` silently upgraded
  // tokens with empty or unknown roles to 'viewer'.
  const role = UserRoleSchema.parse(claims.role);
  // P3-A FIX: orgId is required `string` in the verified JwtClaims schema.
  // The previous `as string | undefined` widening was misleading and the
  // subsequent null check was dead code. Use the value directly.
  const orgId = claims['orgId'];
  // AUDIT-FIX M12: JWT spec allows aud to be string | string[]. Extract first.
  // AUDIT-FIX P2: Guard against empty array — rawAud[0] is undefined for [].
  // Without this, a token with aud:[] would silently change to DEFAULT_AUDIENCE.
  const rawAud = claims.aud;
  const aud = Array.isArray(rawAud)
    ? (rawAud.length > 0 ? rawAud[0] : undefined)
    : rawAud;
  const iss = claims.iss;

  // sub is guaranteed non-empty by JwtClaimsSchema (z.string().min(1)),
  // but defensive check is kept as belt-and-suspenders for a security path.
  if (!sub) {
    throw new TokenInvalidError('Token missing required claim: sub');
  }

  return signToken({
    sub,
    role,
    orgId,
    // Only include aud/iss if defined; omitting delegates to DEFAULT_AUDIENCE/DEFAULT_ISSUER
    ...(aud !== undefined && { aud }),
    ...(iss !== undefined && { iss }),
  });
}

// ============================================================================
// Cleanup
// ============================================================================

/**
* Close Redis connection gracefully
*/
export async function closeJwtRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
    // P2-B FIX: Removed `redisInitPromise = null` — variable was removed (dead code).
  }
}
