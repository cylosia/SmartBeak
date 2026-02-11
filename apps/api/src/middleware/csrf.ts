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

  return result === 0;
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
    if (mergedConfig.excludedPaths.some(excluded => path.startsWith(excluded))) {
      done();
      return;
    }

    // Get session ID from auth context or cookie
    const sessionId = typeof req.headers['x-session-id'] === 'string' ? req.headers['x-session-id'] : undefined;

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
    // Previously this was not awaited, causing a validation bypass
    // (Promise object is always truthy, so the check would never fail)
    try {
      const isValid = await validateCsrfToken(sessionId, providedToken);
      if (!isValid) {
        res.status(403).send({
          error: 'CSRF protection: Invalid or expired token',
          code: 'CSRF_INVALID_TOKEN',
        });
        return;
      }
    } catch (error) {
      console.error('[CSRF] Validation error:', error);
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

  res.header('Set-Cookie',
    `${mergedConfig.cookieName}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=3600`
  );

  return token;
}

export default csrfProtection;
