/**
 * Distributed Rate Limiting with Redis
 * 
 * P0-FIX: Replaces in-memory LRUCache rate limiting with Redis-backed
 * distributed rate limiting. Essential for serverless environments where
 * multiple instances need shared rate limit state.
 */

import { randomBytes } from 'crypto';
import { LRUCache } from 'lru-cache';
import { getRedis } from './redis';
import { getLogger } from './logger';
import { emitCounter } from './metrics';

export interface RateLimitConfig {
  // Maximum requests allowed in window
  maxRequests: number;
  // Window size in milliseconds
  windowMs: number;
  // Key prefix for Redis (default: 'ratelimit')
  keyPrefix?: string;
}

export interface RateLimitResult {
  // Whether the request is allowed
  allowed: boolean;
  // Remaining requests in current window
  remaining: number;
  // Unix timestamp when window resets
  resetTime: number;
  // Total limit for the window
  limit: number;
}

const DEFAULT_KEY_PREFIX = 'ratelimit';
const logger = getLogger('rateLimiterRedis');

// ============================================================================
// Metrics Hook (set by monitoring package during initialization)
// ============================================================================

type RateLimitMetricsHook = (key: string, allowed: boolean, remaining: number, limit: number) => void;
let _rateLimitMetricsHook: RateLimitMetricsHook | null = null;

/**
 * Register a metrics hook for rate limit checks.
 * Called by the monitoring package during initialization.
 */
export function setRateLimitMetricsHook(hook: RateLimitMetricsHook): void {
  _rateLimitMetricsHook = hook;
}

// ---------------------------------------------------------------------------
// In-memory fallback for Redis outages (CRIT-7)
// ---------------------------------------------------------------------------

interface InMemoryRateLimitEntry {
  count: number;
  windowStart: number;
}

const FALLBACK_CACHE_MAX = 10_000;
const FALLBACK_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const fallbackCache = new LRUCache<string, InMemoryRateLimitEntry>({
  max: FALLBACK_CACHE_MAX,
  ttl: FALLBACK_CACHE_TTL_MS,
});

// Lightweight circuit breaker to avoid hammering a failing Redis.
// After FAILURE_THRESHOLD consecutive failures, skip Redis for RESET_TIMEOUT_MS.
const CB_FAILURE_THRESHOLD = 3;
const CB_RESET_TIMEOUT_MS = 30_000;

let cbFailures = 0;
let cbLastFailureTime = 0;

function cbIsOpen(): boolean {
  if (cbFailures < CB_FAILURE_THRESHOLD) return false;
  return Date.now() - cbLastFailureTime < CB_RESET_TIMEOUT_MS;
}

function cbRecordFailure(): void {
  cbFailures++;
  cbLastFailureTime = Date.now();
}

function cbRecordSuccess(): void {
  cbFailures = 0;
}

/**
 * In-memory rate limit check using a fixed-window counter.
 * Used as a degraded fallback when Redis is unavailable.
 */
function checkRateLimitInMemory(
  key: string,
  config: RateLimitConfig
): RateLimitResult {
  const prefix = config.keyPrefix || DEFAULT_KEY_PREFIX;
  const cacheKey = `${prefix}:${key}`;
  const now = Date.now();

  const entry = fallbackCache.get(cacheKey);

  if (!entry || now - entry.windowStart >= config.windowMs) {
    fallbackCache.set(cacheKey, { count: 1, windowStart: now });
    return {
      allowed: true,
      remaining: config.maxRequests - 1,
      resetTime: now + config.windowMs,
      limit: config.maxRequests,
    };
  }

  entry.count++;
  const allowed = entry.count <= config.maxRequests;
  const remaining = Math.max(0, config.maxRequests - entry.count);
  const resetTime = entry.windowStart + config.windowMs;

  fallbackCache.set(cacheKey, entry);

  return {
    allowed,
    remaining,
    resetTime,
    limit: config.maxRequests,
  };
}

/** @internal Reset fallback state -- for testing only */
export function _resetFallbackState(): void {
  fallbackCache.clear();
  cbFailures = 0;
  cbLastFailureTime = 0;
}

/**
 * Check rate limit using sliding window algorithm
 * 
 * P0-FIX: Uses Redis sorted sets for O(log N) sliding window implementation.
 * Each request is added as a score (timestamp) in a sorted set, and we count
 * requests within the window by removing old entries and counting remaining.
 * 
 * @param key - Rate limit key (e.g., 'api:user:123' or 'ip:1.2.3.4')
 * @param config - Rate limit configuration
 * @returns Rate limit result
 * 
 * @example
 * ```typescript
 * const result = await checkRateLimit('api:user:123', {
 *   maxRequests: 100,
 *   windowMs: 60000, // 1 minute
 * });
 * 
 * if (!result.allowed) {
 *   return res.status(429).json({ error: 'Rate limit exceeded' });
 * }
 * ```
 */
export async function checkRateLimit(
  key: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  // CRIT-7: If circuit breaker is open, go directly to in-memory fallback
  // without wasting time on a Redis connection that will likely fail.
  if (cbIsOpen()) {
    logger.warn('[rateLimiter] Circuit breaker open, using in-memory rate limiting', { key });
    emitCounter('rate_limiter_fallback', 1, { reason: 'circuit_open' });
    return checkRateLimitInMemory(key, config);
  }

  try {
    const redis = await getRedis();
    const prefix = config.keyPrefix || DEFAULT_KEY_PREFIX;
    const redisKey = `${prefix}:${key}`;
    const now = Date.now();
    const windowStart = now - config.windowMs;

    // Atomic sliding-window check-and-increment via Lua script.
    // All reads and the conditional write execute inside a single Redis
    // command, eliminating the TOCTOU race between zcard and zadd that
    // existed with the previous pipeline + separate zadd approach.
    //
    // Returns: [allowed (0|1), newCount, windowMs]
    const luaScript = `
local key        = KEYS[1]
local now        = tonumber(ARGV[1])
local windowMs   = tonumber(ARGV[2])
local maxReqs    = tonumber(ARGV[3])
local memberId   = ARGV[4]
local windowStart = now - windowMs

redis.call('ZREMRANGEBYSCORE', key, 0, windowStart)
local count = redis.call('ZCARD', key)

if count < maxReqs then
  redis.call('ZADD', key, now, memberId)
  redis.call('PEXPIRE', key, windowMs)
  return {1, count + 1}
else
  return {0, count}
end
`;
    const memberId = `${now}-${randomBytes(8).toString('hex')}`;
    const rawResult = await redis.eval(
      luaScript,
      1,
      redisKey,
      String(now),
      String(config.windowMs),
      String(config.maxRequests),
      memberId
    );

    // Validate the Lua script response before trusting it.
    // The script returns [allowed (0|1), newCount]. An unexpected response
    // (null, wrong length, non-numeric elements) must be rejected to avoid
    // silently granting or denying requests based on corrupt data.
    if (
      !Array.isArray(rawResult) ||
      rawResult.length < 2 ||
      typeof rawResult[0] !== 'number' ||
      typeof rawResult[1] !== 'number'
    ) {
      throw new Error(
        `Unexpected Lua response from rate-limit script: ${JSON.stringify(rawResult)}`
      );
    }
    const result = rawResult as [number, number];

    const allowedFlag = result[0];
    const newCount = result[1];
    const allowed = allowedFlag === 1;
    const remaining = Math.max(0, config.maxRequests - newCount);
    const resetTime = now + config.windowMs;

    cbRecordSuccess();

    _rateLimitMetricsHook?.(key, allowed, remaining, config.maxRequests);

    return {
      allowed,
      remaining,
      resetTime,
      limit: config.maxRequests,
    };
  } catch (error) {
    // CRIT-7: Redis unavailable -- record failure for circuit breaker and
    // fall back to per-instance in-memory rate limiting. This is degraded
    // (not distributed) but provides protection during Redis outages.
    cbRecordFailure();

    logger.warn('[rateLimiter] Redis unavailable, falling back to in-memory rate limiting', {
      error: error instanceof Error ? error.message : String(error),
      key,
    });

    emitCounter('rate_limiter_fallback', 1, { reason: 'redis_error' });

    return checkRateLimitInMemory(key, config);
  }
}

/**
 * Check rate limit with burst allowance
 * 
 * Allows short bursts above the base rate while maintaining overall limit.
 * 
 * @param key - Rate limit key
 * @param baseRate - Base requests per window
 * @param burstSize - Additional burst allowance
 * @param windowMs - Window size in milliseconds
 */
export async function checkBurstRateLimit(
  key: string,
  baseRate: number,
  burstSize: number,
  windowMs: number
): Promise<RateLimitResult> {
  // Check burst allowance first
  const burstResult = await checkRateLimit(key, {
    maxRequests: baseRate + burstSize,
    windowMs,
    keyPrefix: 'ratelimit:burst',
  });

  // If burst allowed, also check base rate
  if (burstResult.allowed) {
    const baseResult = await checkRateLimit(key, {
      maxRequests: baseRate,
      windowMs,
      keyPrefix: 'ratelimit:base',
    });

    return {
      allowed: baseResult.allowed,
      remaining: Math.min(burstResult.remaining, baseResult.remaining),
      resetTime: Math.max(burstResult.resetTime, baseResult.resetTime),
      limit: baseRate + burstSize,
    };
  }

  return burstResult;
}

/**
 * Get current rate limit status without consuming a request
 * 
 * @param key - Rate limit key
 * @param config - Rate limit configuration
 * @returns Current rate limit status
 */
export async function getRateLimitStatus(
  key: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  const redis = await getRedis();
  const prefix = config.keyPrefix || DEFAULT_KEY_PREFIX;
  const redisKey = `${prefix}:${key}`;
  const now = Date.now();
  const windowStart = now - config.windowMs;

  // Clean old entries and count
  await redis.zremrangebyscore(redisKey, 0, windowStart);
  const currentCount = await redis.zcard(redisKey);

  const remaining = Math.max(0, config.maxRequests - currentCount);
  
  // Get oldest entry to calculate reset time
  const oldestEntries = await redis.zrange(redisKey, 0, 0, 'WITHSCORES');
  const oldestTimestamp = oldestEntries.length > 0 
    ? parseInt(oldestEntries[1] as string, 10) 
    : now;
  
  const resetTime = oldestTimestamp + config.windowMs;

  return {
    allowed: currentCount < config.maxRequests,
    remaining,
    resetTime,
    limit: config.maxRequests,
  };
}

/**
 * Reset rate limit for a key
 * 
 * @param key - Rate limit key
 * @param keyPrefix - Optional key prefix
 */
export async function resetRateLimit(
  key: string,
  keyPrefix?: string
): Promise<void> {
  const redis = await getRedis();
  const prefix = keyPrefix || DEFAULT_KEY_PREFIX;
  const redisKey = `${prefix}:${key}`;
  await redis.del(redisKey);
}

/**
 * Rate limit middleware for Fastify/Express
 * 
 * @param config - Rate limit configuration
 * @param keyGenerator - Function to generate rate limit key from request
 * @returns Middleware function
 * 
 * @example
 * ```typescript
 * app.use(rateLimitMiddleware(
 *   { maxRequests: 100, windowMs: 60000 },
 *   (req) => req.user?.id || req.ip
 * ));
 * ```
 */
export function rateLimitMiddleware<T>(
  config: RateLimitConfig,
  keyGenerator: (req: T) => string
) {
  return async (req: T, res: {
    status: (code: number) => unknown;
    json: (data: unknown) => unknown;
    setHeader: (name: string, value: string | number) => void;
  }, next: () => void) => {
    try {
      const key = keyGenerator(req);
      const result = await checkRateLimit(key, config);

      // Add rate limit headers
      res.setHeader('X-RateLimit-Limit', result.limit);
      res.setHeader('X-RateLimit-Remaining', result.remaining);
      res.setHeader('X-RateLimit-Reset', Math.ceil(result.resetTime / 1000));

      if (!result.allowed) {
        res.status(429);
        res.json({
          error: 'Too Many Requests',
          message: 'Rate limit exceeded. Please try again later.',
          retryAfter: Math.ceil((result.resetTime - Date.now()) / 1000),
        });
        return;
      }

      next();
    } catch (error) {
      // SECURITY FIX: Fail closed — deny request when rate limiter errors unexpectedly.
      // Previously called next() (fail-open), which allowed unlimited traffic on failure.
      logger.error('[rateLimiter] Unexpected error in rate limit middleware - failing closed (denying request)', undefined, {
        error: error instanceof Error ? error.message : String(error),
      });
      emitCounter('rate_limiter_middleware_error', 1);
      res.status(503);
      res.json({ error: 'Service temporarily unavailable' });
    }
  };
}

/**
 * Create a rate limiter instance with fixed configuration
 * 
 * @param config - Rate limit configuration
 * @returns Rate limiter object
 */
export function createRateLimiter(config: RateLimitConfig) {
  return {
    check: (key: string) => checkRateLimit(key, config),
    status: (key: string) => getRateLimitStatus(key, config),
    reset: (key: string) => resetRateLimit(key, config.keyPrefix),
  };
}
