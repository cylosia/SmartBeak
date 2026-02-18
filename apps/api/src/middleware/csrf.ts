/**
 * CSRF Protection Middleware
 *
 * P1-FIX: Missing CSRF Protection for state-changing operations
 *
 * Validates CSRF tokens for state-changing HTTP methods (POST, PUT, PATCH, DELETE)
 * to prevent cross-site request forgery attacks.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { timingSafeEqual } from 'crypto';
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
async function _cleanupExpiredTokens(): Promise<void> {
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

  // P1-FIX: Use crypto.timingSafeEqual with Buffer padding for true constant-time
  // comparison. The previous implementation had an early return on length mismatch
  // (stored.length !== providedToken.length) that leaked token length via timing.
  const storedBuf = Buffer.from(stored, 'utf8');
  const providedBuf = Buffer.from(providedToken, 'utf8');
  const maxLen = Math.max(storedBuf.length, providedBuf.length);
  if (maxLen === 0) {
    return false;
  }
  const storedPadded = Buffer.alloc(maxLen, 0);
  const providedPadded = Buffer.alloc(maxLen, 0);
  storedBuf.copy(storedPadded);
  providedBuf.copy(providedPadded);
  const isValid = timingSafeEqual(storedPadded, providedPadded) && storedBuf.length === providedBuf.length;

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
    res: FastifyReply
  ): Promise<void> => {
    const method = req["method"]?.toUpperCase();
    // P1-FIX: Strip query parameters before path comparison.
    // Fastify's req.url includes query params (e.g., '/webhook?token=xyz').
    // Without stripping, excluded paths like '/webhook' fail to match when
    // query params are present, causing CSRF to block legitimate webhook POSTs.
    const path = (req["url"] || '').split('?')[0] || '';

    // Skip if method is not protected
    if (!mergedConfig.protectedMethods.includes(method)) {
      return;
    }

    // Skip excluded paths
    // SECURITY FIX: Use exact match or path prefix with separator to prevent bypass via
    // crafted paths like /webhookAdmin. Check for exact match OR path + '/' prefix.
    if (mergedConfig.excludedPaths.some(excluded => path === excluded || path.startsWith(excluded + '/'))) {
      return;
    }

    // P0-002 FIX: Derive sessionId from the Authorization header JWT, not
    // exclusively from req.auth. At onRequest phase, auth middleware has not
    // yet run, so req.auth is always undefined — previously causing every
    // state-changing request to be blocked with 403 CSRF_SESSION_REQUIRED.
    //
    // We decode (no verify) the JWT to extract jti/sub as a stable session ID.
    // The CSRF token stored in Redis under that key is the actual security
    // guarantee: only the server can issue a valid CSRF token for a sessionId.
    let sessionId: string | undefined;

    // Prefer req.auth if a prior hook already set it
    const authUser = (req as { auth?: { userId?: string; sessionId?: string } }).auth;
    sessionId = authUser?.sessionId || authUser?.userId;

    // Fallback: decode (no verify) the Bearer token for session identity
    if (!sessionId) {
      const authHeader = req.headers.authorization;
      if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        const parts = token.split('.');
        if (parts.length === 3) {
          try {
            const payload = JSON.parse(
              Buffer.from(parts[1]!, 'base64url').toString('utf8')
            ) as { jti?: string; sub?: string };
            sessionId = payload.jti || payload.sub;
          } catch { /* malformed JWT — fall through to rejection */ }
        }
      }
    }

    if (!sessionId) {
      return res.status(403).send({
        error: 'CSRF protection: Session ID required',
        code: 'CSRF_SESSION_REQUIRED',
      });
    }

    // Get CSRF token from header
    const providedToken = req.headers[mergedConfig.headerName.toLowerCase()];
    if (typeof providedToken !== 'string') {
      return res.status(403).send({
        error: 'CSRF protection: Token required',
        code: 'CSRF_TOKEN_REQUIRED',
      });
    }

    if (!providedToken) {
      return res.status(403).send({
        error: 'CSRF protection: Token required',
        code: 'CSRF_TOKEN_REQUIRED',
      });
    }

    // CRITICAL-FIX: Validate token with proper await
    try {
      const isValid = await validateCsrfToken(sessionId, providedToken);
      if (!isValid) {
        return res.status(403).send({
          error: 'CSRF protection: Invalid or expired token',
          code: 'CSRF_INVALID_TOKEN',
        });
      }

      // P2-FIX: Removed redundant clearCsrfToken call. validateCsrfToken already
      // deletes the token on success (line 100), so calling clearCsrfToken here was
      // a double-delete — a harmless but wasteful extra Redis DEL command per request.
    } catch (error) {
      // P1-FIX #15: Use structured logging instead of console.error to prevent
      // PII/connection strings leaking to stdout in production container logs.
      const err = error instanceof Error ? error : new Error(String(error));
      // Import would create circular dependency - use minimal safe logging
      process.stderr.write(`[CSRF] Validation error: ${err.message}\n`);
      return res.status(500).send({
        error: 'CSRF protection: Validation error',
        code: 'CSRF_VALIDATION_ERROR',
      });
    }
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
  void res.header('Set-Cookie',
    `${mergedConfig.cookieName}=${token}; Secure; SameSite=Strict; Path=/; Max-Age=3600`
  );

  return token;
}

export default csrfProtection;
