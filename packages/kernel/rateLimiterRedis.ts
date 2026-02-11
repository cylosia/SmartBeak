/**
 * Distributed Rate Limiting with Redis
 * 
 * P0-FIX: Replaces in-memory LRUCache rate limiting with Redis-backed
 * distributed rate limiting. Essential for serverless environments where
 * multiple instances need shared rate limit state.
 */

import { getRedis } from './redis';

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
  const redis = await getRedis();
  const prefix = config.keyPrefix || DEFAULT_KEY_PREFIX;
  const redisKey = `${prefix}:${key}`;
  const now = Date.now();
  const windowStart = now - config.windowMs;

  // P0-FIX: Atomic rate limit check using Redis pipeline
  const pipeline = redis.pipeline();
  
  // Remove entries outside the window
  pipeline.zremrangebyscore(redisKey, 0, windowStart);
  
  // Count entries in current window
  pipeline.zcard(redisKey);
  
  // Add current request
  pipeline.zadd(redisKey, now, `${now}-${Math.random()}`);
  
  // Set expiration on the key
  pipeline.pexpire(redisKey, config.windowMs);
  
  const results = await pipeline.exec();
  
  if (!results) {
    // Redis error - fail open to prevent blocking legitimate traffic
    console.error('[rateLimiter] Redis pipeline failed');
    return {
      allowed: true,
      remaining: config.maxRequests - 1,
      resetTime: now + config.windowMs,
      limit: config.maxRequests,
    };
  }

  // Get current count (second command result)
  const currentCount = (results[1]![1] as number) + 1; // +1 for the request we just added
  
  const allowed = currentCount <= config.maxRequests;
  const remaining = Math.max(0, config.maxRequests - currentCount);
  const resetTime = now + config.windowMs;

  // If rate limited, remove the request we just added
  if (!allowed) {
    await redis.zremrangebyscore(redisKey, now, now);
  }

  return {
    allowed,
    remaining,
    resetTime,
    limit: config.maxRequests,
  };
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
  const redis = await getRedis();
  const burstKey = `ratelimit:burst:${key}`;
  const baseKey = `ratelimit:base:${key}`;
  const now = Date.now();
  const windowStart = now - windowMs;

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
