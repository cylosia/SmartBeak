import { randomBytes } from 'crypto';
import { LRUCache } from 'lru-cache';

import Redis from 'ioredis';
import { getLogger } from '@kernel/logger';

/**
* Rate Limiting for Read Operations
* Uses Redis in production for distributed rate limiting across instances
* Falls back to in-memory only for development/single-instance deployments
*
* This implementation uses Redis when available for proper distributed rate limiting
*/

// AUDIT-FIX P2-03: Use structured logger instead of console.log/warn/error
const logger = getLogger('RateLimitRead');

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_WINDOW_MS = 60_000; // 1 minute
const DEFAULT_MAX = 60; // 60 requests per minute

// LRU cache for in-memory fallback (size limited to prevent memory exhaustion)
const memoryCache = new LRUCache<string, { count: number; resetTime: number }>({
  max: 10000,
  ttl: DEFAULT_WINDOW_MS,
});

// Redis client (lazy initialized)
let redisClient: Redis | null = null;
let redisAvailable = false;

// ============================================================================
// Redis Initialization
// ============================================================================

function getRedisClient(): Redis | null {
  if (redisClient) {
  return redisClient;
  }

  const redisUrl = process.env['REDIS_URL'] || 'redis://localhost:6379';

  try {
  redisClient = new Redis(redisUrl, {
    retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
    },
    maxRetriesPerRequest: 3,
    enableOfflineQueue: false,
    connectTimeout: 5000,
  });

  redisClient.on('connect', () => {
    redisAvailable = true;
    logger.info('Redis connected for distributed rate limiting');
  });

  redisClient.on('error', (err) => {
    redisAvailable = false;
    // Only log once to prevent spam
    if (err.message?.includes('ECONNREFUSED')) {
    logger.warn('Redis unavailable, using in-memory fallback');
    }
  });

  return redisClient;
  } catch (error) {
  logger.error('Failed to initialize Redis', error instanceof Error ? error : new Error(String(error)));
  redisAvailable = false;
  return null;
  }
}

// Initialize Redis on module load
getRedisClient();

// ============================================================================
// In-Memory Rate Limit (Fallback)
// ============================================================================

function checkMemoryRateLimit(
  key: string,
  max: number,
  windowMs: number
): { allowed: boolean; remaining: number; resetTime: number } {
  const now = Date.now();
  const entry = memoryCache.get(key);

  if (!entry || now > entry.resetTime) {
  // First request or window expired
  memoryCache.set(key, { count: 1, resetTime: now + windowMs });
  return {
    allowed: true,
    remaining: max - 1,
    resetTime: now + windowMs,
  };
  }

  // Increment count
  entry.count++;
  memoryCache.set(key, entry);

  if (entry.count > max) {
  return {
    allowed: false,
    remaining: 0,
    resetTime: entry.resetTime,
  };
  }

  return {
  allowed: true,
  remaining: max - entry.count,
  resetTime: entry.resetTime,
  };
}

// ============================================================================
// Redis Rate Limit (Production)
// ============================================================================

async function checkRedisRateLimit(
  key: string,
  max: number,
  windowMs: number
): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
  const redis = getRedisClient();

  if (!redis || !redisAvailable) {
  throw new Error('Redis not available');
  }

  const now = Date.now();
  const windowStart = now - windowMs;
  const redisKey = `ratelimit:read:${key}`;

  // Use unique member to prevent collisions
  const memberId = `${now}-${randomBytes(8).toString('hex')}`;

  const multi = redis.multi();

  // Remove old entries outside the window
  multi.zremrangebyscore(redisKey, 0, windowStart);

  // Count current entries in window
  multi.zcard(redisKey);

  // Add current request with unique member
  multi.zadd(redisKey, now, memberId);

  // Set expiry on the key
  multi.pexpire(redisKey, windowMs);

  const results = await multi.exec();

  if (!results) {
  throw new Error('Redis transaction returned null');
  }

  // Check for errors
  for (const [err] of results) {
  if (err) {
    throw new Error(`Redis transaction failed: ${err}`);
  }
  }

  // Results[1] contains the count before adding current request
  const currentCount = results[1]![1] as number;
  const totalCount = currentCount + 1;

  if (currentCount >= max) {
  return {
    allowed: false,
    remaining: 0,
    resetTime: Date.now() + windowMs,
  };
  }

  return {
  allowed: true,
  remaining: Math.max(0, max - totalCount),
  resetTime: Date.now() + windowMs,
  };
}

// ============================================================================
// Main Rate Limit Function
// ============================================================================

/**
* Check rate limit for read operations
* Uses Redis in production, falls back to in-memory for development
*
* @param key - Rate limit identifier (e.g., user ID or IP address)
* @param max - Maximum requests allowed in window (default: 60)
* @param windowMs - Window duration in milliseconds (default: 60000)
* @throws Error if rate limit exceeded
*
* Previous implementation used in-memory Map which didn't work across instances
*/
export async function readRateLimit(
  key: string,
  max: number = DEFAULT_MAX,
  windowMs: number = DEFAULT_WINDOW_MS
): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
  // Try Redis first if available
  if (redisAvailable && redisClient) {
  try {
    return await checkRedisRateLimit(key, max, windowMs);
  } catch (error) {
    // Fall back to memory if Redis fails
    logger.warn('Redis failed, using memory fallback');
  }
  }

  // Use in-memory fallback
  return checkMemoryRateLimit(key, max, windowMs);
}

/**
* Synchronous version for backward compatibility
* Uses in-memory only - prefer readRateLimit() for new code
* @deprecated Use readRateLimit() instead for async Redis support
*/
export function readRateLimitSync(
  key: string,
  max: number = DEFAULT_MAX,
  windowMs: number = DEFAULT_WINDOW_MS
): { allowed: boolean; remaining: number; resetTime: number } {
  return checkMemoryRateLimit(key, max, windowMs);
}

/**
* Check if Redis rate limiting is available
*/
export function isRedisRateLimitAvailable(): boolean {
  return redisAvailable;
}

/**
* Get rate limit status for a key (doesn't increment counter)
*/
export async function getRateLimitStatus(
  key: string,
  max: number = DEFAULT_MAX,
  windowMs: number = DEFAULT_WINDOW_MS
): Promise<{ remaining: number; resetTime: number; limited: boolean }> {
  const redis = getRedisClient();
  const redisKey = `ratelimit:read:${key}`;
  const windowStart = Date.now() - windowMs;

  if (redis && redisAvailable) {
  try {
    // Clean old entries and get count
    await redis.zremrangebyscore(redisKey, 0, windowStart);
    const count = await redis.zcard(redisKey);
    const ttl = await redis.pttl(redisKey);
    const resetTime = Date.now() + Math.max(0, ttl);
    return {
    remaining: Math.max(0, max - count),
    limited: count >= max,
    resetTime,
    };
  } catch (error) {
    // Fall through to memory
  }
  }

  // Memory fallback
  const entry = memoryCache.get(key);
  const now = Date.now();

  if (!entry || now > entry.resetTime) {
  return {
    remaining: max,
    resetTime: now + windowMs,
    limited: false,
  };
  }

  return {
  remaining: Math.max(0, max - entry.count),
  resetTime: entry.resetTime,
  limited: entry.count >= max,
  };
}

/**
* Reset rate limit for a key
*/
export async function resetRateLimit(key: string): Promise<void> {
  const redis = getRedisClient();
  const redisKey = `ratelimit:read:${key}`;

  if (redis && redisAvailable) {
  try {
    await redis.del(redisKey);
  } catch (error) {
    // Ignore errors
  }
  }

  memoryCache.delete(key);
}
