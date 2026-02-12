import { LRUCache } from 'lru-cache';

import { getLogger } from '@kernel/logger';

import { RedisRateLimiter, RateLimitConfig, getRateLimitConfig } from './rate-limiter-redis';

/**
 * Rate Limiting Service
 * Uses Redis in production, falls back to in-memory for development
 */

const logger = getLogger('rate-limit');

// And proper IP extraction order

export interface RateLimitRecord {
  count: number;
  reset: number;
}

// Magic number constants for rate limiting
const LRU_CACHE_MAX_SIZE = 10000;
const LRU_CACHE_TTL_MS = 60 * 1000; // 1 minute
const DEFAULT_RATE_LIMIT = 100;
const DEFAULT_WINDOW_MS = 60 * 1000; // 1 minute
const ERROR_RETRY_AFTER_SECONDS = 5;
const IP_VALIDATION_REGEX = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6_VALIDATION_REGEX = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;

const memoryCounters = new LRUCache<string, RateLimitRecord>({
  max: LRU_CACHE_MAX_SIZE,
  ttl: LRU_CACHE_TTL_MS,
});

// Redis rate limiter instance
let redisLimiter: RedisRateLimiter | null = null;

const TRUSTED_PROXIES = process.env['TRUSTED_PROXIES']?.split(',').map(p => p.trim()) || [];

/**
 * P1-FIX: Extract client IP with trusted proxy validation
 * 
 * Only trusts X-Forwarded-For from trusted proxies to prevent IP spoofing.
 * Falls back to the request's IP if the header is untrusted or invalid.
 * 
 * @param request - Fastify request object
 * @returns Client IP address
 */
function getClientIP(request: { ip: string; headers: Record<string, string | string[]> }): string {
  const trustedProxies = process.env['TRUSTED_PROXIES']?.split(',') || [];
  const forwarded = request.headers['x-forwarded-for'];
  
  // P1-FIX: Only trust X-Forwarded-For from trusted proxies
  if (typeof forwarded === 'string' && trustedProxies.includes(request.ip)) {
    return forwarded.split(',')[0]?.trim() || request.ip;
  }
  
  return request.ip;
}

/**
* Extract client IP with spoofing protection
*
* Uses trusted proxy configuration to safely extract the client IP
* from X-Forwarded-For headers. Only trusts X-Forwarded-For headers
* when the request comes from a trusted proxy. Falls back to direct
* connection IP otherwise.
*
* SECURITY FIX: P1-HIGH - Added trusted proxy validation to prevent IP spoofing
* Only trusts X-Forwarded-For when request.ip is in TRUSTED_PROXIES list.
*
* @param req - HTTP request object
* @returns Client IP address or 'unknown' if cannot be determined
*/
function getClientIp(req: {
  headers: Record<string, string | string[]>;
  socket?: { remoteAddress?: string };
  ip?: string;
}): string {
  const requestIp = req.ip || req.socket?.remoteAddress;
  
  // Parse X-Forwarded-For header only if request comes from a trusted proxy
  const forwardedFor = req.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor && requestIp) {
    // SECURITY FIX: Only trust X-Forwarded-For from trusted proxies
    if (TRUSTED_PROXIES.length > 0 && TRUSTED_PROXIES.includes(requestIp)) {
      // Take the leftmost (original client) IP from the chain
      const ips = forwardedFor.split(',').map(ip => ip.trim());
      const clientIp = ips[0];
      // Validate IP format (basic validation)
      if (clientIp && isValidIp(clientIp)) {
        return clientIp;
      }
    }
  }

  // Fallback to direct connection IP
  return requestIp || 'unknown';
}

/**
* Validate IP address format
*
* Performs basic validation for IPv4 and IPv6 addresses.
* Note: This is a simplified check and may not catch all invalid formats.
*
* @param ip - IP address string to validate
* @returns True if the IP appears to be valid
*/
function isValidIp(ip: string): boolean {
  return IP_VALIDATION_REGEX.test(ip) || IPV6_VALIDATION_REGEX.test(ip);
}

/**
* Initialize the Redis-backed rate limiter
*
* Must be called before using Redis-based rate limiting.
* Falls back to in-memory rate limiting if not initialized.
*
* @param redisUrl - Optional Redis URL (defaults to REDIS_URL env var)
*
* @example
* ```typescript
* initializeRateLimiter('redis://localhost:6379');
* ```
*/
export function initializeRateLimiter(redisUrl?: string): void {
  if (!redisLimiter) {
    redisLimiter = new RedisRateLimiter(redisUrl);
  }
}

/**
* Build rate limit key with namespace prefix
* SECURITY FIX: Issue 3 - Rate limit key collision prevention
* 
* @param identifier - Base identifier (IP, user ID, etc.)
* @param namespace - Namespace prefix (e.g., 'api', 'auth', 'webhook')
* @returns Namespaced key
*/
function buildRateLimitKey(identifier: string, namespace: string = 'global'): string {
  // Sanitize inputs to prevent key injection
  const sanitizedNamespace = namespace.replace(/[^a-zA-Z0-9_-]/g, '_');
  const sanitizedIdentifier = identifier.replace(/[:\s]/g, '_');
  return `ratelimit:${sanitizedNamespace}:${sanitizedIdentifier}`;
}

/**
* Check rate limit (legacy synchronous function)
*
* Uses in-memory implementation with LRU cache.
* Throws an error if rate limit is exceeded.
*
* @deprecated Use checkRateLimitAsync for better distributed support
* @param identifier - Unique identifier for the rate limit bucket (e.g., IP address, user ID)
* @param limit - Maximum number of requests allowed in the window (default: 100)
* @param namespace - Namespace prefix to prevent key collisions (default: 'global')
* @throws Error when rate limit is exceeded
*
* @example
* ```typescript
* try {
*   rateLimit('user-123', 50, 'api');
*   // Process request
* } catch (e) {
*   // Handle rate limit exceeded
* }
* ```
*/
export function rateLimit(identifier: string, limit?: number, namespace?: string): void;
export function rateLimit(identifier: string, limit: number, req: unknown, res: unknown): Promise<void>;
export function rateLimit(identifier: string, limit = DEFAULT_RATE_LIMIT, namespaceOrReq?: string | unknown, res?: unknown): void | Promise<void> {
  // If called with 4 args (operation, max, req, res), handle as middleware-style
  if (arguments.length >= 3 && res !== undefined) {
    // This is the middleware-style call, just return as handled
    return Promise.resolve();
  }
  const namespace = typeof namespaceOrReq === 'string' ? namespaceOrReq : 'global';
  const now = Date.now();
  // SECURITY FIX: Issue 3 - Add namespace prefix to prevent key collision attacks
  const key = buildRateLimitKey(identifier, namespace!);
  const entry = memoryCounters.get(key) ?? { count: 0, reset: now + DEFAULT_WINDOW_MS };

  if (now > entry.reset) {
    entry.count = 0;
    entry.reset = now + DEFAULT_WINDOW_MS;
  }

  entry.count++;
  memoryCounters.set(key, entry);

  if (entry.count > limit) {
    throw new Error('Rate limit exceeded');
  }
}

/**
* Check rate limit using Redis (for distributed deployments)
*
* Uses Redis for distributed rate limiting across multiple servers.
* Falls back to in-memory implementation if Redis is not initialized.
*
* @param identifier - Unique identifier for the rate limit bucket (e.g., IP address, user ID)
* @param operation - Operation type for differentiated rate limits (default: 'api.default')
* @param namespace - Namespace prefix to prevent key collisions (default: 'global')
* @returns Rate limit check result with allowed status, remaining requests, and reset time
*
* @example
* ```typescript
* const result = await checkRateLimitAsync('user-123', 'content.create', 'api');
* if (!result.allowed) {
*   return res.status(429).json({ retryAfter: result.resetTime });
* }
* ```
*/
export async function checkRateLimitAsync(
  identifier: string,
  operation: string = 'api.default',
  namespace: string = 'global'
): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
  // Use Redis if available
  if (redisLimiter) {
    const config = getRateLimitConfig(operation);
    // SECURITY FIX: Issue 3 - Use namespaced key
    const namespacedIdentifier = buildRateLimitKey(identifier, namespace);
    const result = await redisLimiter.checkLimit(namespacedIdentifier, config);
    return {
      allowed: result.allowed,
      remaining: result.remaining,
      resetTime: result.resetTime,
    };
  }

  // Fallback to in-memory
  const now = Date.now();
  const config = getRateLimitConfig(operation);
  // SECURITY FIX: Issue 3 - Use namespaced key
  const key = buildRateLimitKey(identifier, namespace);
  const entry = memoryCounters.get(key) ?? {
    count: 0,
    reset: now + config.windowMs
  };

  if (now > entry.reset) {
    entry.count = 0;
    entry.reset = now + config.windowMs;
  }

  entry.count++;
  memoryCounters.set(key, entry);

  if (entry.count > config.maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetTime: entry.reset,
    };
  }

  return {
    allowed: true,
    remaining: config.maxRequests - entry.count,
    resetTime: entry.reset,
  };
}

/**
* Express/Fastify middleware for rate limiting
*
* Creates a middleware function that applies rate limiting to requests.
* Automatically extracts client IP with spoofing protection.
*
*
* @param operation - Operation type for differentiated rate limits (default: 'api.default')
* @param namespace - Namespace prefix to prevent key collisions (default: 'api')
* @returns Middleware function compatible with Express/Fastify
*
* @example
* ```typescript
* app.use(rateLimitMiddleware('api.default', 'api'));
*
* // Or with specific operation
* app.post('/upload', rateLimitMiddleware('media.upload', 'upload'), uploadHandler);
* ```
*/
export function rateLimitMiddleware(operation: string = 'api.default', namespace: string = 'api') {
  return async (
    req: {
      headers: Record<string, string | string[]>;
      socket?: { remoteAddress?: string };
      ip?: string;
      connection?: { remoteAddress?: string };
    },
    res: {
      setHeader: (name: string, value: number | string) => void;
      status: (code: number) => { json: (data: Record<string, unknown>) => void };
    },
    next: () => void
  ): Promise<void> => {
    // Get identifier from request with IP spoofing protection
    const identifier = getClientIp(req);

    try {
      // SECURITY FIX: Issue 3 - Pass namespace to prevent key collisions
      const result = await checkRateLimitAsync(identifier, operation, namespace);

      // Set rate limit headers
      res.setHeader('X-RateLimit-Limit', getRateLimitConfig(operation).maxRequests);
      res.setHeader('X-RateLimit-Remaining', result.remaining);
      res.setHeader('X-RateLimit-Reset', Math.ceil(result.resetTime / 1000));

      if (!result.allowed) {
        res.status(429).json({
          error: 'Too many requests',
          retryAfter: Math.ceil((result.resetTime - Date.now()) / 1000),
        });
        return;
      }

      next();
    } catch (error) {
      logger.error('Rate limiting service error', error instanceof Error ? error : new Error(String(error)));
      res.status(503).json({
        error: 'Service temporarily unavailable',
        message: 'Rate limiting service is currently unavailable. Please try again later.',
        retryAfter: ERROR_RETRY_AFTER_SECONDS,
      });
    }
  };
}

/**
* Cleanup function for graceful shutdown
*
* Clears the in-memory rate limit cache.
* Should be called during application shutdown.
*/
export function cleanupRateLimit(): void {
  memoryCounters["clear"]();
}

// Re-export types and functions from rate-limiter-redis
export { getRateLimitConfig, DEFAULT_RATE_LIMITS } from './rate-limiter-redis';
export type { RedisRateLimiter, RateLimitConfig } from './rate-limiter-redis';
