import Redis from 'ioredis';

import { getLogger } from '@kernel/logger';

import { randomBytes } from 'crypto';


/**
* Redis-based Rate Limiting Service
* Distributed rate limiting for multi-node deployments
*/

const logger = getLogger('rate-limiter-redis');

// Magic number constants for rate limit configuration
const ONE_MINUTE_MS = 60 * 1000;
const REDIS_RETRY_DELAY_MULTIPLIER = 50;
const REDIS_MAX_RETRY_DELAY_MS = 2000;
const REDIS_MAX_RETRIES = 3;

// Rate limit defaults
const RATE_LIMIT_CONTENT_DEFAULT = 50;
const RATE_LIMIT_CONTENT_PUBLISH = 20;
const RATE_LIMIT_PUBLISHING = 10;
const RATE_LIMIT_MEDIA_UPLOAD = 30;
const RATE_LIMIT_API_DEFAULT = 100;
const RATE_LIMIT_AI_GENERATE = 10;
const RATE_LIMIT_EXPORT_LARGE = 5;

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: number;
  limit: number;
}

export class RateLimitError extends Error {
  constructor(message: string) {
  super(message);
  this.name = 'RateLimitError';
  }
}

export class RedisRateLimiter {
  private redis: Redis;
  private closed = false;

  constructor(redisUrl?: string) {
  const url = redisUrl || process.env['REDIS_URL'];
  if (!url) {
    throw new Error('Redis URL is required: pass redisUrl parameter or set REDIS_URL environment variable');
  }
  this.redis = new Redis(url, {
    retryStrategy: (times) => {
    const delay = Math.min(times * REDIS_RETRY_DELAY_MULTIPLIER, REDIS_MAX_RETRY_DELAY_MS);
    return delay;
    },
    maxRetriesPerRequest: REDIS_MAX_RETRIES,
  });

  this.redis.on('error', (err) => {
    logger.error('Redis connection error', err instanceof Error ? err : new Error(String(err)));
  });
  }

  /**
  * Check if request should be allowed
  * Uses Redis sorted sets for sliding window rate limiting
  */
  async checkLimit(
  identifier: string,
  config: RateLimitConfig
  ): Promise<RateLimitResult> {
  if (this.closed) {
    throw new RateLimitError('Rate limiter is closed');
  }

  const now = Date.now();
  const windowStart = now - config.windowMs;
  const resetTime = now + config.windowMs;
  const key = `ratelimit:${identifier}`;

  const memberId = `${now}-${this.generateUniqueId()}`;

  // Use Redis multi for atomic operations
  const multi = this["redis"].multi();

  // Remove old entries outside the window
  multi.zremrangebyscore(key, 0, windowStart);

  // Count current entries in window
  multi.zcard(key);

  // Add current request with unique member
  multi.zadd(key, now, memberId);

  // Set expiry on the key
  multi.pexpire(key, config.windowMs);

  const results = await multi.exec();

  if (!results) {
    throw new RateLimitError('Redis transaction returned null');
  }

  // Check for errors in transaction results
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (!result) {
      logger.error(`Transaction error at index ${i}`, new Error('Undefined result'));
      throw new RateLimitError(`Redis transaction failed: undefined result at index ${i}`);
    }
    const [err] = result;
    if (err) {
    logger.error(`Transaction error at index ${i}`, err instanceof Error ? err : new Error(String(err)));
    throw new RateLimitError(`Redis transaction failed: ${err}`);
    }
  }

  // Results[1] contains the count before adding current request
  const currentCount = results[1]![1] as number;
  const totalCount = currentCount + 1;

  if (currentCount >= config.maxRequests) {
    // Limit exceeded
    return {
    allowed: false,
    remaining: 0,
    resetTime,
    limit: config.maxRequests,
    };
  }

  return {
    allowed: true,
    remaining: Math.max(0, config.maxRequests - totalCount),
    resetTime,
    limit: config.maxRequests,
  };
  }

  /**
  * Generate unique ID for collision prevention
  * SECURITY FIX: Use cryptographically secure randomBytes instead of Math.random()
  */
  private generateUniqueId(): string {
  return `${Date.now()}-${randomBytes(8).toString('hex')}`;
  }

  /**
  * Increment counter without checking limit
  */
  async increment(identifier: string, config: RateLimitConfig): Promise<void> {
  if (this.closed) {
    throw new RateLimitError('Rate limiter is closed');
  }

  const now = Date.now();
  const windowStart = now - config.windowMs;
  const key = `ratelimit:${identifier}`;
  const memberId = `${now}-${this.generateUniqueId()}`;

  const multi = this["redis"].multi();
  multi.zremrangebyscore(key, 0, windowStart);
  multi.zadd(key, now, memberId);
  multi.pexpire(key, config.windowMs);

  await multi.exec();
  }

  /**
  * Get current count for identifier
  */
  async getCount(identifier: string, windowMs: number): Promise<number> {
  if (this.closed) {
    throw new RateLimitError('Rate limiter is closed');
  }

  const now = Date.now();
  const windowStart = now - windowMs;
  const key = `ratelimit:${identifier}`;

  // Clean old entries
  await this["redis"].zremrangebyscore(key, 0, windowStart);

  // Get count
  return this["redis"].zcard(key);
  }

  /**
  * Reset rate limit for identifier
  */
  async reset(identifier: string): Promise<void> {
  if (this.closed) {
    throw new RateLimitError('Rate limiter is closed');
  }

  const key = `ratelimit:${identifier}`;
  await this["redis"].del(key);
  }

  /**
  * Check health of Redis connection
  */
  async health(): Promise<{ healthy: boolean; latency: number; error?: string }> {
  const start = Date.now();
  try {
    await this.redis.ping();
    return {
    healthy: true,
    latency: Date.now() - start,
    };
  } catch (error) {
    return {
    healthy: false,
    latency: Date.now() - start,
    error: error instanceof Error ? error.message : String(error),
    };
  }
  }

  /**
  * Close Redis connection
  */
  async close(): Promise<void> {
  this.closed = true;
  await this["redis"].quit();
  }
}

// Default rate limit configurations
export const DEFAULT_RATE_LIMITS: Record<string, RateLimitConfig> = {
  // Content operations
  'content.create': { maxRequests: RATE_LIMIT_CONTENT_DEFAULT, windowMs: ONE_MINUTE_MS },
  'content.update': { maxRequests: RATE_LIMIT_CONTENT_DEFAULT, windowMs: ONE_MINUTE_MS },
  'content.publish': { maxRequests: RATE_LIMIT_CONTENT_PUBLISH, windowMs: ONE_MINUTE_MS },

  // Publishing operations
  'publishing.publish': { maxRequests: RATE_LIMIT_PUBLISHING, windowMs: ONE_MINUTE_MS },

  // Media operations
  'media.upload': { maxRequests: RATE_LIMIT_MEDIA_UPLOAD, windowMs: ONE_MINUTE_MS },

  // API general
  'api.default': { maxRequests: RATE_LIMIT_API_DEFAULT, windowMs: ONE_MINUTE_MS },

  // Strict limits for expensive operations
  'ai.generate': { maxRequests: RATE_LIMIT_AI_GENERATE, windowMs: ONE_MINUTE_MS },
  'export.large': { maxRequests: RATE_LIMIT_EXPORT_LARGE, windowMs: ONE_MINUTE_MS },
};

/**
* Get rate limit config for an operation
*/
export function getRateLimitConfig(operation: string): RateLimitConfig {
  const config = DEFAULT_RATE_LIMITS[operation] || DEFAULT_RATE_LIMITS['api.default'];
  if (!config) {
    throw new Error(`Rate limit config not found for operation: ${operation}`);
  }
  return config;
}

// Singleton instance
let globalRateLimiter: RedisRateLimiter | null = null;

/**
* Initialize global rate limiter
*/
export function initializeRateLimiter(redisUrl?: string): RedisRateLimiter {
  globalRateLimiter = new RedisRateLimiter(redisUrl);
  return globalRateLimiter;
}

/**
* Get global rate limiter instance
*/
export function getRateLimiter(): RedisRateLimiter {
  if (!globalRateLimiter) {
  throw new Error('Rate limiter not initialized. Call initializeRateLimiter(redisUrl) first.');
  }
  return globalRateLimiter;
}
