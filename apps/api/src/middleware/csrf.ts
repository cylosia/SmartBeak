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
 * Lua script for atomic CSRF token validation + deletion.
 *
 * SECURITY: A plain GET → compare → DEL sequence has a TOCTOU race window:
 * two concurrent requests carrying the same token can both pass the GET before
 * either DEL fires, allowing the token to be used twice.  The Lua script runs
 * atomically on the Redis server — no other command can interleave between the
 * GET and the DEL.
 *
 * Returns the stored token string, or null if the key does not exist.
 * The key is ALWAYS deleted (single-use) regardless of whether the token
 * matches; this prevents an attacker from probing the stored value by sending
 * intentionally wrong tokens without consuming it.
 */
const GET_AND_DELETE_LUA = `
local val = redis.call('GET', KEYS[1])
if val ~= false then
  redis.call('DEL', KEYS[1])
end
return val
`;

/**
 * P1-FIX: Validate a CSRF token using an atomic Redis Lua script.
 * The token is consumed (deleted) atomically during validation to prevent
 * replay attacks and TOCTOU races.
 */
export async function validateCsrfToken(
  sessionId: string,
  providedToken: string
): Promise<boolean> {
  const redis = await getRedis();
  const key = `${CSRF_KEY_PREFIX}${sessionId}`;

  // Atomically retrieve and delete the stored token.
  // ioredis.Redis.eval(script, numkeys, ...keys): returns the stored value or null.
  const stored = await redis.eval(GET_AND_DELETE_LUA, 1, key) as string | null;

  if (!stored) {
    return false;
  }

  // Constant-time comparison with Buffer padding to prevent timing attacks
  // that leak token length via early exit.
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
  // Also verify equal lengths to reject padded-match false positives.
  return timingSafeEqual(storedPadded, providedPadded) && storedBuf.length === providedBuf.length;
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

    // F28-FIX: Derive session ID from authenticated JWT claims, NOT from the
    // client-controlled x-session-id header. Using a client header allows an
    // attacker to generate a CSRF token with their own session ID and use it
    // against a victim's authenticated request, completely bypassing CSRF protection.
    const authUser = (req as { auth?: { userId?: string; sessionId?: string } }).auth;
    const sessionId = authUser?.sessionId || authUser?.userId;

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
