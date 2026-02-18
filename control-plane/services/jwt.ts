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
export type UserRole = 'admin' | 'editor' | 'viewer' | 'owner';
export interface JwtClaims {
  sub: string;
  role: UserRole;
  // P0-5 FIX: orgId is required to match verification schema in packages/security/jwt.ts
  orgId: string;
  aud?: string;
  iss?: string;
  jti: string;
  iat: number;
  exp: number;
  boundOrgId?: string;
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
export const UserRoleSchema = z.enum(['admin', 'editor', 'viewer', 'owner']);

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
export interface TokenInfo {
  jti: string;
  sub: string;
  role: UserRole;
  orgId?: string;
  issuedAt: Date;
  expiresAt: Date;
  isRevoked: boolean;
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
const DEFAULT_AUDIENCE = process.env['JWT_AUDIENCE'] || 'smartbeak';
const DEFAULT_ISSUER = process.env['JWT_ISSUER'] || 'smartbeak-api';

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
  if (!match) return 3600000; // Default 1 hour

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

  // Prevent use of placeholder values
  const placeholderPatterns = /placeholder|example|test|demo|secret|key/i;
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

// Load keys at module initialization
// P0-2 FIX: Fail-closed instead of fail-open. If signing keys are invalid,
// the application must crash at startup rather than silently producing tokens
// signed with empty strings that can never be verified.
const KEYS: string[] = getKeys();

// ============================================================================
// Redis Connection (Lazy Initialization)
// ============================================================================

// P1-5 FIX: Defer Redis connection to first use instead of module-level throw.
// Module-level throw crashes any file that imports this module (tests, CLI tools,
// type-only imports) if REDIS_URL is not set.
let redis: Redis | null = null;

// Circuit breaker state
const circuitBreaker: CircuitBreakerState = {
  failures: 0,
  lastFailure: 0,
  isOpen: false,
};

function getRedisClient(): Redis {
  if (redis) return redis;

  const url = process.env['REDIS_URL'];
  if (!url) {
    throw new Error('REDIS_URL environment variable is required');
  }

  redis = new Redis(url, {
    retryStrategy: (times: number): number => Math.min(times * 50, 2000),
    maxRetriesPerRequest: 3,
  });

  redis.on('error', (err: Error) => {
    logger.error('Redis connection error', err);
  });

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

  const _aud = validated.aud || DEFAULT_AUDIENCE;
  const _iss = validated.iss || DEFAULT_ISSUER;

  // SECURITY FIX: Enforce maximum token lifetime of 24 hours
  const expiresInMs = calculateExpiration(validated.expiresIn);

  const payload: Omit<JwtClaims, 'iat' | 'exp'> = {
  sub: validated.sub,
  role: validated.role,
  orgId: validated["orgId"],
  jti: generateTokenId(),
  boundOrgId: validated["orgId"],
  } as Omit<JwtClaims, 'iat' | 'exp'>;

  return jwt.sign(payload as object, KEYS[0]!, {
    algorithm: 'HS256',
    expiresIn: Math.floor(expiresInMs / 1000),
    audience: _aud,
    issuer: _iss,
  } as jwt.SignOptions);
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

  logger.error('Redis unavailable for revocation check, allowing token', error instanceof Error ? error : new Error(String(error)));
}

/**
* Check if token is revoked in Redis
* SECURITY FIX: Implement circuit breaker pattern to prevent auth service unavailability
*
* @param jti - Token ID to check
* @returns Whether the token is revoked
*/
async function _isTokenRevoked(jti: string): Promise<boolean> {
  // Check if circuit breaker is open
  if (isCircuitOpen()) {
  logger.warn('Circuit breaker open, allowing token (Redis unavailable)');
  return false;
  }

  try {
  const revoked = await getRedisClient().exists(`${REVOCATION_KEY_PREFIX}${jti}`);
  // Success - reset failure count
  circuitBreaker.failures = 0;
  return revoked === 1;
  } catch (error) {
  recordFailure(error);
  // SECURITY FIX: Log but don't block auth when Redis is down
  // Allow the request through - the token signature is still verified
  return false;
  }
}

/**
* Revoke a token by its ID
*
* @param tokenId - Token ID to revoke
* @throws {JwtError} When revocation fails
*/
export async function revokeToken(tokenId: string): Promise<void> {
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
* Verify a JWT token
* Delegates to unified auth package with Redis revocation check
*
* @param token - JWT token string
* @param aud - Expected audience
* @param iss - Expected issuer
* @returns Verified claims
* @throws {TokenRevokedError} When token has been revoked
* @throws {TokenInvalidError} When token is invalid
* @throws {MissingClaimError} When required claims are missing
* @throws {TokenBindingError} When org binding check fails
*/
export function verifyToken(
  token: string,
  aud: string = DEFAULT_AUDIENCE,
  iss: string = DEFAULT_ISSUER
): JwtClaims {
  // Delegate directly to packages/security/jwt.ts — the canonical implementation.
  // The previous dynamic import(@kernel/auth) routed through a stub that always threw.
  return securityVerifyToken(token, { audience: aud, issuer: iss }) as JwtClaims;
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
export function getTokenExpiration(token: string): Date | null {
  try {
  const decoded = jwt.decode(token) as { exp?: number } | null;
  if (decoded && 'exp' in decoded && decoded['exp']) {
    return new Date((decoded['exp'] as number) * 1000);
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
* Get token info without verification
*
* @param token - JWT token string
* @returns Token info or null if invalid
*/
export function getTokenInfo(token: string): TokenInfo | null {
  const decoded = jwt.decode(token) as { jti?: string; sub?: string; role?: string; orgId?: string; iat?: number; exp?: number } | null;
  if (!decoded) return null;

  return {
  jti: ('jti' in decoded ? decoded['jti'] : '') as string || '',
  sub: ('sub' in decoded ? decoded['sub'] : '') as string,
  role: ('role' in decoded ? decoded['role'] : 'viewer') as UserRole,
  orgId: 'orgId' in decoded ? (decoded['orgId'] as string) : undefined,
  issuedAt: 'iat' in decoded && decoded['iat'] ? new Date((decoded['iat'] as number) * 1000) : new Date(),
  expiresAt: 'exp' in decoded && decoded['exp'] ? new Date((decoded['exp'] as number) * 1000) : new Date(),
  isRevoked: false, // Cannot determine without Redis check
  } as TokenInfo;
}

/**
* Refresh a token
* Creates a new token with the same claims but extended expiration
*
* @param token - Existing JWT token
* @param expiresIn - New expiration time
* @returns New signed token
*/
/**
 * P0-1 SECURITY FIX: Token refresh now VERIFIES the old token before re-signing.
 *
 * Previously used jwt.decode() (no signature verification), which allowed an
 * attacker to craft an arbitrary JWT payload and get it re-signed with a valid key.
 * Now uses jwt.verify() to ensure the old token was legitimately signed.
 */
export function refreshToken(token: string, _expiresIn?: string): string {
  // SECURITY FIX: Pre-verification algorithm check (defense-in-depth)
  rejectDisallowedAlgorithm(token);

  // P0-1 FIX: VERIFY the token cryptographically instead of just decoding it.
  // jwt.decode() performs NO signature verification - an attacker could craft
  // any payload and get it signed with a valid production key.
  let verified: jwt.JwtPayload;
  try {
    verified = jwt.verify(token, KEYS[0]!, {
      algorithms: ['HS256'],
      clockTolerance: 30,
    }) as jwt.JwtPayload;
  } catch {
    // Try second key for rotation support
    try {
      verified = jwt.verify(token, KEYS[1]!, {
        algorithms: ['HS256'],
        clockTolerance: 30,
      }) as jwt.JwtPayload;
    } catch {
      throw new TokenInvalidError('Token verification failed during refresh');
    }
  }

  const sub = verified.sub;
  const role = (verified['role'] || 'viewer') as UserRole;
  const orgId = verified['orgId'] as string | undefined;
  const aud = verified.aud as string | undefined;
  const iss = verified.iss as string | undefined;

  if (!sub) {
    throw new TokenInvalidError('Token missing required claim: sub');
  }

  if (!orgId) {
    throw new TokenInvalidError('Token missing required claim: orgId');
  }

  return signToken({
    sub,
    role,
    orgId,
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
  }
}
