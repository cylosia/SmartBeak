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
// In-Memory Fallback for Redis Unavailability
// ============================================================================

interface FallbackEntry {
// ---------------------------------------------------------------------------
// In-memory fallback for Redis outages (CRIT-7)
// ---------------------------------------------------------------------------

interface InMemoryRateLimitEntry {
  count: number;
  windowStart: number;
}

const fallbackCounters = new LRUCache<string, FallbackEntry>({
  max: 10000,
  ttl: 300000, // 5 min safety TTL
});

/**
 * In-memory rate limit check used when Redis is unavailable.
 * Maintains rate enforcement (fail-closed) while surviving Redis outages.
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
  const now = Date.now();
  const prefix = config.keyPrefix || DEFAULT_KEY_PREFIX;
  const fullKey = `${prefix}:${key}`;
  const entry = fallbackCounters.get(fullKey);

  if (!entry || (now - entry.windowStart) > config.windowMs) {
    fallbackCounters.set(fullKey, { count: 1, windowStart: now });
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
  return {
    allowed,
    remaining: Math.max(0, config.maxRequests - entry.count),
    resetTime: entry.windowStart + config.windowMs,
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
  let redis;
  try {
    redis = await getRedis();
  } catch (redisError) {
    // Redis unavailable - fall back to in-memory rate limiting
    logger.warn(`[rateLimiter] Redis unavailable, using in-memory fallback: ${redisError instanceof Error ? redisError.message : String(redisError)}`);
    return checkRateLimitInMemory(key, config);
  }

  const prefix = config.keyPrefix || DEFAULT_KEY_PREFIX;
  const redisKey = `${prefix}:${key}`;
  const now = Date.now();
  const windowStart = now - config.windowMs;
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

    // AUDIT-FIX P0-02/P0-03: Rewritten to fix critical issues:
    // - Use crypto.randomBytes for member uniqueness (was Math.random)
    // - Check count before adding request (was add-then-remove race)

    // Step 1: Clean old entries and get current count BEFORE adding
    const pipeline = redis.pipeline();
    pipeline.zremrangebyscore(redisKey, 0, windowStart);
    pipeline.zcard(redisKey);

  try {
    // Step 1: Clean old entries and get current count BEFORE adding
    const pipeline = redis.pipeline();
    pipeline.zremrangebyscore(redisKey, 0, windowStart);
    pipeline.zcard(redisKey);

    const results = await pipeline.exec();

    if (!results) {
      // AUDIT-FIX P0-01: Fail CLOSED on Redis error - deny request
      logger.error('[rateLimiter] Redis pipeline failed - failing closed');
      return {
        allowed: false,
        remaining: 0,
        resetTime: now + config.windowMs,
        limit: config.maxRequests,
      };
    }

    const results = await pipeline.exec();

    if (!results) {
      // Pipeline returned null -- treat as Redis failure
      throw new Error('Redis pipeline returned null');
    }

    const currentCount = results[1]![1] as number;
    const allowed = currentCount < config.maxRequests;
    const remaining = Math.max(0, config.maxRequests - currentCount - (allowed ? 1 : 0));
    const resetTime = now + config.windowMs;

    // Step 2: Only add the request if allowed (fixes P0-03 race condition)
    if (allowed) {
      // AUDIT-FIX P0-02: Use crypto.randomBytes instead of Math.random for member uniqueness
      const memberId = `${now}-${randomBytes(8).toString('hex')}`;
      await redis.zadd(redisKey, now, memberId);
      await redis.pexpire(redisKey, config.windowMs);
    }

    cbRecordSuccess();

    return {
      allowed,
      remaining,
      resetTime,
      limit: config.maxRequests,
    };
  } catch (redisError) {
    // Redis command error - fall back to in-memory rate limiting
    logger.warn(`[rateLimiter] Redis command error, using in-memory fallback: ${redisError instanceof Error ? redisError.message : String(redisError)}`);
  } catch (error) {
    // CRIT-7: Redis unavailable -- record failure for circuit breaker and
    // fall back to per-instance in-memory rate limiting. This is degraded
    // (not distributed) but provides protection during Redis outages.
    cbRecordFailure();

    logger.warn('[rateLimiter] Redis unavailable, falling back to in-memory rate limiting', {
      error: error instanceof Error ? error.message : String(error),
      key,
    });

  _rateLimitMetricsHook?.(key, allowed, remaining, config.maxRequests);

  return {
    allowed,
    remaining,
    resetTime,
    limit: config.maxRequests,
  };
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
      logger.error('[rateLimiter] Unexpected error in rate limit middleware - failing closed (denying request)', {
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
