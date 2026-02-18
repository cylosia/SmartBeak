import Redis from 'ioredis';
import { LRUCache } from 'lru-cache';

import { redisConfig } from '@config';
import { emitMetric } from '../ops/metrics';
import { getLogger } from '@kernel/logger';

/**
* Rate Limiter
* Intelligent rate limiting for all external APIs with token bucket algorithm
*
* @module utils/rateLimiter
*/

const logger = getLogger('rateLimiter');

// ============================================================================
// Type Definitions
// ============================================================================

/**
* Rate limit configuration
*/
export interface RateLimitConfig {
  /** Tokens to add per interval */
  tokensPerInterval: number;
  /** Interval in seconds */
  intervalSeconds: number;
  /** Maximum burst size */
  burstSize?: number | undefined;
  /** Maximum retry attempts */
  maxRetries?: number | undefined;
  /** Delay between retries in milliseconds */
  retryDelayMs?: number | undefined;
  /** Failures before cooldown */
  failureThreshold?: number | undefined;
  /** Cooldown duration in seconds */
  cooldownSeconds?: number | undefined;
}

/**
* Rate limit status
*/
export interface RateLimitStatus {
  /** Whether request is allowed */
  allowed: boolean;
  /** Remaining tokens */
  remainingTokens: number;
  /** When tokens will reset */
  resetTime: Date;
  /** Seconds until retry allowed */
  retryAfter?: number | undefined;
}

// ============================================================================
// Rate Limiter Class
// ============================================================================

/**
* Rate limiter using token bucket algorithm

*/
export class RateLimiter {
  private readonly redis: Redis;
  private readonly configs = new LRUCache<string, RateLimitConfig>({ max: 1000, ttl: 3600000 });
  // Cache for Lua script SHA to use EVALSHA instead of EVAL
  private luaScriptSha: string | undefined;

  /**
  * Create a new RateLimiter
  * @param redisUrl - Redis connection URL
  */
  constructor(redisUrl?: string) {
  const url = redisUrl || process.env['REDIS_URL'] || 'redis://localhost:6379';

  // P1-FIX: Enhanced Redis configuration with timeouts
  this.redis = new Redis(url, {
    retryStrategy: (times) => {
    const delay = Math.min(times * redisConfig.initialReconnectDelayMs, redisConfig.maxReconnectDelayMs);
    return delay;
    },
    maxRetriesPerRequest: redisConfig.maxRetriesPerRequest,
    enableOfflineQueue: false,
    // P1-FIX: Connection timeout
    connectTimeout: redisConfig.connectTimeoutMs,
    // P1-FIX: Command timeout
    commandTimeout: redisConfig.commandTimeoutMs,
    // P1-FIX: Keepalive
    keepAlive: redisConfig.keepAliveMs,
  });

  // P1-FIX: Handle connection errors with proper propagation
  this.redis.on('error', (err) => {
    logger.error('Redis connection error', new Error(err["message"]));
    // P1-FIX: Emit error for external monitoring
    emitMetric({
    name: 'redis_connection_error',
    labels: { error: err["message"] },
    value: 1
    });
  });

  // P1-FIX: Track connection state
  this.redis.on('connect', () => {
    logger.info('Redis connected');
    emitMetric({ name: 'redis_connected', labels: {}, value: 1 });
  });

  this.redis.on('close', () => {
    logger.warn('Redis connection closed');
    emitMetric({ name: 'redis_disconnected', labels: {}, value: 1 });
  });
  }

  /**
  * Load the Lua script into Redis and cache the SHA
  */
  private async loadLuaScript(): Promise<string> {
  if (this.luaScriptSha) {
    return this.luaScriptSha;
  }

  const script = this.getTokenBucketScript();
  try {
    this.luaScriptSha = await this.redis.script('LOAD', script) as string;
    return this.luaScriptSha;
  } catch (err) {
    logger.error('Failed to load Lua script', err instanceof Error ? err : new Error(String(err)));
    throw err;
  }
  }

  /**
  * Execute Lua script using EVALSHA, fallback to EVAL
  */
  private async executeLuaScript(
  sha: string,
  keys: string[],
  args: (string | number)[]
  ): Promise<[number, number]> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await (this.redis as any).evalsha(
    sha,
    keys.length,
    ...keys,
    ...args.map(String)
    ) as [number, number];
  } catch (err: unknown) {
    // Fallback to EVAL if script not found (NOSCRIPT error)
    if (err instanceof Error && err["message"]?.includes('NOSCRIPT')) {
    this.luaScriptSha = undefined;
    const script = this.getTokenBucketScript();
    return await (this.redis.eval as unknown as (
      script: string,
      numKeys: number,
      ...args: (string | number)[]
    ) => Promise<[number, number]>)(script, keys.length, ...keys, ...args.map(String));
    }
    throw err;
  }
  }

  /**
  * Get the token bucket Lua script
  */
  private getTokenBucketScript(): string {
  return `
    local key = KEYS[1]
    local tokens_key = key .. ':tokens'
    local last_updated_key = key .. ':last_updated'

    local tokens_per_interval = tonumber(ARGV[1])
    local interval_seconds = tonumber(ARGV[2])
    local burst_size = tonumber(ARGV[3])
    local cost = tonumber(ARGV[4])
    local now = tonumber(ARGV[5])

    -- Get current tokens and last updated time
    local tokens = redis.call('get', tokens_key)
    tokens = tokens and tonumber(tokens) or burst_size

    local last_updated = redis.call('get', last_updated_key)
    last_updated = last_updated and tonumber(last_updated) or now

    -- Calculate tokens to add based on time passed
    local time_passed = now - last_updated
    local tokens_to_add = (time_passed / interval_seconds) * tokens_per_interval
    tokens = math.min(burst_size, tokens + tokens_to_add)

    -- Check if request can be allowed
    local allowed = tokens >= cost

    if allowed then
    tokens = tokens - cost
    end

    -- AUDIT-FIX P0-06: Always update state (moved outside if block).
    -- Previously the 'end' keyword was missing, so Redis writes only
    -- happened when allowed=true. Denied requests never advanced
    -- last_updated, causing unbounded token refill on next allowed request.
    redis.call('set', tokens_key, tokens)
    redis.call('set', last_updated_key, now)
    redis.call('expire', tokens_key, interval_seconds * 2)
    redis.call('expire', last_updated_key, interval_seconds * 2)

    return {allowed and 1 or 0, tokens}
  `;
  }

  /**
  * Register rate limit config for a provider
  * @param provider - Provider identifier
  * @param config - Rate limit configuration
  */
  registerProvider(provider: string, config: RateLimitConfig): void {
  this.configs.set(provider, {
    burstSize: config.tokensPerInterval,
    maxRetries: 3,
    retryDelayMs: 1000,
    failureThreshold: 5,
    cooldownSeconds: 60,
    ...config,
  });
  }

  /**
  * Check if request is allowed (token bucket algorithm)
  * @param provider - Provider identifier
  * @param cost - Token cost for this request (default: 1)
  * @returns Rate limit status
  */
  async checkLimit(provider: string, cost: number = 1): Promise<RateLimitStatus> {
  const config = this.configs.get(provider);
  if (!config) {
    // No limit configured, allow
    return { allowed: true, remainingTokens: Infinity, resetTime: new Date() };
  }

  const key = `ratelimit:${provider}`;
  const _failureKey = `ratelimit:${provider}:failures`;
  const cooldownKey = `ratelimit:${provider}:cooldown`;

  // Check if in cooldown
  const inCooldown = await this.redis.get(cooldownKey);
  if (inCooldown) {
    const ttl = await this.redis.ttl(cooldownKey);
    return {
    allowed: false,
    remainingTokens: 0,
    resetTime: new Date(Date.now() + ttl * 1000),
    retryAfter: ttl,
    };
  }

  // Token bucket algorithm using Redis Lua script with EVALSHA caching
  const now = Math.floor(Date.now() / 1000);
  const scriptSha = await this.loadLuaScript();
  const result = await this.executeLuaScript(
    scriptSha,
    [key],
    [
    config.tokensPerInterval,
    config.intervalSeconds,
    config.burstSize ?? config.tokensPerInterval,
    cost,
    now,
    ]
  );

  const [allowed, remainingTokens] = result;

  return {
    allowed: allowed === 1,
    remainingTokens: allowed === 1 ? remainingTokens : 0,
    resetTime: new Date((now + config.intervalSeconds) * 1000),
  };
  }

  /**
  * Record a failed request
  * @param provider - Provider identifier
  */
  async recordFailure(provider: string): Promise<void> {
  const config = this.configs.get(provider);
  if (!config) return;

  const failureKey = `ratelimit:${provider}:failures`;
  const cooldownKey = `ratelimit:${provider}:cooldown`;

  const failures = await this.redis.incr(failureKey);
  await this.redis.expire(failureKey, config.intervalSeconds * 2);

  if (failures >= (config.failureThreshold || 5)) {
    // Enter cooldown
    await this.redis.setex(cooldownKey, config.cooldownSeconds || 60, '1');
    await this.redis.del(failureKey);

    logger.warn(`${provider} entered cooldown due to ${failures} failures`);
  }
  }

  /**
  * Record a successful request
  * @param provider - Provider identifier
  */
  async recordSuccess(provider: string): Promise<void> {
  const failureKey = `ratelimit:${provider}:failures`;
  await this.redis.del(failureKey);
  }

  /**
  * Execute function with rate limiting and retries
  * @param provider - Provider identifier
  * @param fn - Function to execute
  * @param cost - Token cost (default: 1)
  * @returns Function result
  */
  async executeWithLimit<T>(
  provider: string,
  fn: () => Promise<T>,
  cost: number = 1
  ): Promise<T> {
  const config = this.configs.get(provider);
  const maxRetries = config?.maxRetries || 3;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Check rate limit
    const status = await this.checkLimit(provider, cost);

    if (!status.allowed) {
    if (status.retryAfter) {
      // Wait for cooldown
      await this.sleep(status.retryAfter * 1000);
      continue;
    }
    throw new Error(`Rate limit exceeded for ${provider}`);
    }

    try {
    const result = await fn();
    await this.recordSuccess(provider);
    return result;
    } catch (error: unknown) {
    await this.recordFailure(provider);

    // Check if we should retry
    if (attempt < maxRetries && this.isRetryableError(error)) {
      const delay = (config?.retryDelayMs || 1000) * Math.pow(2, attempt);
      logger.warn(`${provider} request failed, retrying in ${delay}ms`);
      await this.sleep(delay);
      continue;
    }

    throw error;
    }
  }

  throw new Error(`Max retries exceeded for ${provider}`);
  }

  /**
  * Check if error is retryable
  * @param error - Error to check
  * @returns Whether error is retryable
  */
  private isRetryableError(error: unknown): boolean {
  const retryableCodes = [
    'ECONNRESET',
    'ETIMEDOUT',
    'ECONNREFUSED',
    'ENOTFOUND',
    'EAI_AGAIN',
  ];

  const retryableStatuses = [429, 500, 502, 503, 504];

  const err = error as { code?: string; status?: number };
  if (err.code && retryableCodes.includes(err.code)) {
    return true;
  }

  if (err.status && retryableStatuses.includes(err.status)) {
    return true;
  }

  return false;
  }

  /**
  * Get current status for a provider
  * @param provider - Provider identifier
  * @returns Current rate limit status
  */
  async getStatus(provider: string): Promise<{
  tokensRemaining: number;
  inCooldown: boolean;
  cooldownEndsAt?: Date | undefined;
  recentFailures: number;
  }> {
  const key = `ratelimit:${provider}`;
  const failureKey = `${key}:failures`;
  const cooldownKey = `${key}:cooldown`;

  const [tokensStr, failures, cooldown] = await Promise.all([
    this.redis.get(`${key}:tokens`),
    this.redis.get(failureKey),
    this.redis.get(cooldownKey),
  ]);

  const config = this.configs.get(provider);
  const tokensRemaining = tokensStr ? parseInt(tokensStr, 10) : (config?.burstSize || 0);

  let cooldownEndsAt: Date | undefined;
  if (cooldown) {
    const ttl = await this.redis.ttl(cooldownKey);
    cooldownEndsAt = new Date(Date.now() + ttl * 1000);
  }

  return {
    tokensRemaining,
    inCooldown: !!cooldown,
    cooldownEndsAt,
    recentFailures: failures ? parseInt(failures, 10) : 0,
  };
  }

  /**
  * Reset rate limit for a provider
  * @param provider - Provider identifier
  */
  async reset(provider: string): Promise<void> {
  const key = `ratelimit:${provider}`;
  await this.redis.del(`${key}:tokens`);
  await this.redis.del(`${key}:last_updated`);
  await this.redis.del(`${key}:failures`);
  await this.redis.del(`${key}:cooldown`);
  }

  /**
  * Sleep for specified milliseconds
  * @param ms - Milliseconds to sleep
  * @returns Promise that resolves after delay
  */
  private sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
  * Close Redis connection
  */
  async close(): Promise<void> {
  await this.redis.quit();
  }

  /**
  * Explicitly close Redis connection on shutdown
  * Ensures all pending commands are processed before closing
  */
  async shutdown(): Promise<void> {
  try {
    // Wait for any pending operations to complete
    await this.redis.ping();
    // Close connection gracefully
    await this.redis.quit();
    logger.info('Connection closed gracefully');
  } catch (error) {
    logger.error('Error during shutdown', error instanceof Error ? error : new Error(String(error)));
    // Force disconnect if graceful close fails
    this.redis.disconnect();
    throw error;
  }
  }
}

// ============================================================================
// Default Rate Limits
// ============================================================================

/** Pre-configured rate limits for common providers */
export const DEFAULT_RATE_LIMITS: Record<string, RateLimitConfig> = {
  openai: {
  tokensPerInterval: 60, // Images per minute for DALL-E
  intervalSeconds: 60,
  burstSize: 60,
  maxRetries: 3,
  retryDelayMs: 2000,
  },
  stability: {
  tokensPerInterval: 150, // Requests per minute
  intervalSeconds: 60,
  burstSize: 150,
  maxRetries: 3,
  retryDelayMs: 1000,
  },
  ahrefs: {
  tokensPerInterval: 5, // Requests per second
  intervalSeconds: 1,
  burstSize: 10,
  maxRetries: 3,
  retryDelayMs: 5000,
  },
  gsc: {
  tokensPerInterval: 600, // Requests per minute
  intervalSeconds: 60,
  burstSize: 600,
  maxRetries: 3,
  retryDelayMs: 2000,
  },
  linkedin: {
  tokensPerInterval: 100, // Posts per day
  intervalSeconds: 86400,
  burstSize: 100,
  maxRetries: 3,
  retryDelayMs: 60000,
  },
  tiktok: {
  tokensPerInterval: 50, // Posts per day
  intervalSeconds: 86400,
  burstSize: 50,
  maxRetries: 3,
  retryDelayMs: 60000,
  },
  gbp: {
  tokensPerInterval: 1000, // Requests per day
  intervalSeconds: 86400,
  burstSize: 1000,
  maxRetries: 3,
  retryDelayMs: 60000,
  },
  cj: {
  tokensPerInterval: 25, // Requests per second
  intervalSeconds: 1,
  burstSize: 50,
  maxRetries: 3,
  retryDelayMs: 2000,
  },
  impact: {
  tokensPerInterval: 1000, // Requests per hour
  intervalSeconds: 3600,
  burstSize: 1000,
  maxRetries: 3,
  retryDelayMs: 5000,
  },
  amazon: {
  tokensPerInterval: 1, // Requests per second
  intervalSeconds: 1,
  burstSize: 5,
  maxRetries: 3,
  retryDelayMs: 2000,
  },
};
