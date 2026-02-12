/**
 * CSRF Protection Middleware
 *
 * P1-FIX: Missing CSRF Protection for state-changing operations
 *
 * Validates CSRF tokens for state-changing HTTP methods (POST, PUT, PATCH, DELETE)
 * to prevent cross-site request forgery attacks.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { getRedis } from '@kernel/redis';

// Secure token generation using crypto
function generateToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

// P1-FIX: Use Redis for CSRF token storage instead of in-memory Map
// In-memory storage loses tokens on server restart, breaking user sessions
// Redis provides persistence and works across serverless instances

// Token expiration time (1 hour)
const TOKEN_EXPIRY_MS = 60 * 60 * 1000;
const CSRF_KEY_PREFIX = 'csrf:';

export interface CsrfConfig {
  // Cookie name for CSRF token
  cookieName?: string;
  // Header name for CSRF token
  headerName?: string;
  // Methods that require CSRF protection
  protectedMethods?: string[];
  // Paths to exclude from CSRF protection
  excludedPaths?: string[];
}

const DEFAULT_CONFIG: Required<CsrfConfig> = {
  cookieName: 'csrf_token',
  headerName: 'x-csrf-token',
  protectedMethods: ['POST', 'PUT', 'PATCH', 'DELETE'],
  excludedPaths: ['/webhook', '/api/auth/login', '/api/auth/register'],
};

/**
 * P1-FIX: Clean expired tokens from Redis
 * Uses TTL in Redis, so no manual cleanup needed
 */
async function cleanupExpiredTokens(): Promise<void> {
  // Redis automatically expires keys with TTL
  // This function kept for API compatibility
}

/**
 * P1-FIX: Generate a new CSRF token for a session using Redis
 */
export async function generateCsrfToken(sessionId: string): Promise<string> {
  const redis = await getRedis();
  const token = generateToken();
  const key = `${CSRF_KEY_PREFIX}${sessionId}`;
  
  // Store in Redis with TTL
  await redis.setex(key, TOKEN_EXPIRY_MS / 1000, token);

  return token;
}

/**
 * P1-FIX: Validate a CSRF token using Redis
 */
export async function validateCsrfToken(
  sessionId: string, 
  providedToken: string
): Promise<boolean> {
  const redis = await getRedis();
  const key = `${CSRF_KEY_PREFIX}${sessionId}`;
  
  const stored = await redis.get(key);
  if (!stored) {
    return false;
  }

  // Constant-time comparison to prevent timing attacks
  if (stored.length !== providedToken.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < stored.length; i++) {
    result |= stored.charCodeAt(i) ^ providedToken.charCodeAt(i);
  }

  const isValid = result === 0;

  // F27-FIX: Invalidate token after successful validation. Previously the token
  // remained valid for the full 1-hour TTL, allowing unlimited replay attacks.
  // CSRF tokens MUST be single-use.
  if (isValid) {
    await redis.del(key);
  }

  return isValid;
}

/**
 * P1-FIX: Clear CSRF token for a session using Redis
 */
export async function clearCsrfToken(sessionId: string): Promise<void> {
  const redis = await getRedis();
  const key = `${CSRF_KEY_PREFIX}${sessionId}`;
  await redis.del(key);
}

/**
 * CSRF protection middleware for Fastify
 */
export function csrfProtection(config: CsrfConfig = {}) {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };

  return async (
    req: FastifyRequest,
    res: FastifyReply,
    done: () => void
  ): Promise<void> => {
    const method = req["method"]?.toUpperCase();
    const path = req["url"] || '';

    // Skip if method is not protected
    if (!mergedConfig.protectedMethods.includes(method)) {
      done();
      return;
    }

    // Skip excluded paths
    // SECURITY FIX: Use exact match or path prefix with separator to prevent bypass via
    // crafted paths like /webhookAdmin. Check for exact match OR path + '/' prefix.
    if (mergedConfig.excludedPaths.some(excluded => path === excluded || path.startsWith(excluded + '/'))) {
      done();
      return;
    }

    // F28-FIX: Derive session ID from authenticated JWT claims, NOT from the
    // client-controlled x-session-id header. Using a client header allows an
    // attacker to generate a CSRF token with their own session ID and use it
    // against a victim's authenticated request, completely bypassing CSRF protection.
    const authUser = (req as { auth?: { userId?: string; sessionId?: string } }).auth;
    const sessionId = authUser?.sessionId || authUser?.userId;

    if (!sessionId) {
      res.status(403).send({
        error: 'CSRF protection: Session ID required',
        code: 'CSRF_SESSION_REQUIRED',
      });
      return;
    }

    // Get CSRF token from header
    const providedToken = req.headers[mergedConfig.headerName.toLowerCase()];
    if (typeof providedToken !== 'string') {
      res.status(403).send({
        error: 'CSRF protection: Token required',
        code: 'CSRF_TOKEN_REQUIRED',
      });
      return;
    }

    if (!providedToken) {
      res.status(403).send({
        error: 'CSRF protection: Token required',
        code: 'CSRF_TOKEN_REQUIRED',
      });
      return;
    }

    // CRITICAL-FIX: Validate token with proper await
    try {
      const isValid = await validateCsrfToken(sessionId, providedToken);
      if (!isValid) {
        res.status(403).send({
          error: 'CSRF protection: Invalid or expired token',
          code: 'CSRF_INVALID_TOKEN',
        });
        return;
      }

      // P1-FIX #14: Invalidate the CSRF token after successful validation.
      // Previously tokens could be reused for multiple requests within their 1-hour TTL.
      // Single-use tokens prevent CSRF replay attacks.
      await clearCsrfToken(sessionId);
    } catch (error) {
      // P1-FIX #15: Use structured logging instead of console.error to prevent
      // PII/connection strings leaking to stdout in production container logs.
      const err = error instanceof Error ? error : new Error(String(error));
      // Import would create circular dependency - use minimal safe logging
      process.stderr.write(`[CSRF] Validation error: ${err.message}\n`);
      res.status(500).send({
        error: 'CSRF protection: Validation error',
        code: 'CSRF_VALIDATION_ERROR',
      });
      return;
    }

    done();
  };
}

/**
 * Generate and set CSRF token cookie
 */
export async function setCsrfCookie(
  res: FastifyReply,
  sessionId: string,
  config: CsrfConfig = {}
): Promise<string> {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  const token = await generateCsrfToken(sessionId);

  // SECURITY FIX: Remove HttpOnly so client JS can read the token to send in x-csrf-token header.
  // HttpOnly prevented JS from reading the cookie, breaking the double-submit CSRF pattern entirely.
  // SameSite=Strict + Secure still protect against cross-origin cookie submission.
  res.header('Set-Cookie',
    `${mergedConfig.cookieName}=${token}; Secure; SameSite=Strict; Path=/; Max-Age=3600`
  );

  return token;
}

export default csrfProtection;
