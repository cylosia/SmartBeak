import Redis from 'ioredis';
import { LRUCache } from 'lru-cache';

import { redisConfig } from '@config';
import { emitMetric } from '../ops/metrics';
import { getLogger } from '@kernel/logger';

const logger = getLogger('rateLimiter');

/**
* Rate Limiter
* Intelligent rate limiting for all external APIs with token bucket algorithm
*
* @module utils/rateLimiter
* 
* P1-HIGH SECURITY FIXES:
* - Issue 14: Missing bot detection in middleware
* - Issue 3: Rate limit key collision (namespace prefix)
*/

// ============================================================================
// Bot Detection
// ============================================================================

/**
 * Suspicious user agent patterns for bot detection
 * SECURITY FIX: Issue 14 - Bot detection
 */
const SUSPICIOUS_USER_AGENTS = [
  'bot', 'crawler', 'spider', 'scrape', 'curl', 'wget',
  'python', 'java', 'scrapy', 'httpclient', 'axios',
  'postman', 'insomnia', 'burp', 'sqlmap', 'nikto',
  'nmap', 'masscan', 'zgrab', 'gobuster', 'dirbuster',
  'headless', 'phantomjs', 'selenium', 'puppeteer',
  'playwright', 'cypress', 'webdriver',
];

/**
 * Bot detection result
 */
export interface BotDetectionResult {
  isBot: boolean;
  confidence: number;
  indicators: string[];
}

/**
 * Detect potential bot/scraper based on request characteristics
 * SECURITY FIX: Issue 14 - Bot detection in middleware
 * 
 * @param headers - Request headers
 * @returns Bot detection result
 */
function detectBot(headers: Record<string, string | string[]>): BotDetectionResult {
  const indicators: string[] = [];
  let score = 0;

  // Check user agent
  const userAgent = String(headers['user-agent'] || '').toLowerCase();
  
  if (!userAgent || userAgent.length < 10) {
    indicators.push('missing_user_agent');
    score += 30;
  } else {
    for (const pattern of SUSPICIOUS_USER_AGENTS) {
      if (userAgent.includes(pattern)) {
        indicators.push(`suspicious_ua:${pattern}`);
        score += 20;
        break;
      }
    }
    
    // Check for headless browser indicators
    if (userAgent.includes('headless') || 
        userAgent.includes('phantomjs') ||
        userAgent.includes('selenium') || 
        userAgent.includes('puppeteer') ||
        userAgent.includes('playwright')) {
      indicators.push('headless_browser');
      score += 25;
    }
  }

  // Check for missing/standard headers
  const acceptHeader = headers['accept'];
  if (!acceptHeader) {
    indicators.push('missing_accept_header');
    score += 15;
  }

  const acceptLanguage = headers['accept-language'];
  if (!acceptLanguage) {
    indicators.push('missing_accept_language');
    score += 10;
  }

  // Check for missing referer (not definitive, but adds to score)
  const referer = headers['referer'];
  if (!referer && !userAgent.includes('bot') && !userAgent.includes('crawler')) {
    indicators.push('missing_referer');
    score += 5;
  }

  // Determine bot status
  const isBot = score >= 30;
  const confidence = Math.min(score, 100);

  return { isBot, confidence, indicators };
}

// ============================================================================
// Type Definitions
// ============================================================================

/**
* Rate limit configuration
*/
export interface RateLimitConfig {
  /** Tokens to add per interval */
  tokensPerInterval?: number | undefined;
  /** Interval in seconds */
  intervalSeconds: number;
  /** Maximum burst size */
  burstSize?: number;
  /** Maximum retry attempts */
  maxRetries?: number;
  /** Delay between retries in milliseconds */
  retryDelayMs?: number;
  /** Failures before cooldown */
  failureThreshold?: number;
  /** Cooldown duration in seconds */
  cooldownSeconds?: number;
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
  /** Bot detection info */
  botDetection?: BotDetectionResult | undefined;
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
  constructor(redisUrl?: string);
  /**
  * Create a new RateLimiter with config
  * @param config - Rate limit configuration
  */
  constructor(config: RateLimitConfig);
  constructor(redisUrlOrConfig?: string | RateLimitConfig) {
    let url: string;
    
    if (typeof redisUrlOrConfig === 'string') {
      url = redisUrlOrConfig || process.env['REDIS_URL'] || 'redis://localhost:6379';
    } else if (redisUrlOrConfig && typeof redisUrlOrConfig === 'object') {
      // Config-based constructor for middleware functions
      url = process.env['REDIS_URL'] || 'redis://localhost:6379';
      // Store config for later use
      if (redisUrlOrConfig.tokensPerInterval) {
        this.configs.set('default', redisUrlOrConfig);
      }
    } else {
      url = process.env['REDIS_URL'] || 'redis://localhost:6379';
    }

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
      this.luaScriptSha = (await this.redis.script('LOAD', script)) as string;
      return this.luaScriptSha as string;
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
      return await this.redis.evalsha(
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
        return await this.redis.eval(
          script,
          keys.length,
          ...keys,
          ...args.map(String)
        ) as [number, number];
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

      -- Update Redis
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
      ...config,
      tokensPerInterval: config.tokensPerInterval ?? 60,
      intervalSeconds: config.intervalSeconds ?? 60,
      burstSize: config.burstSize ?? config.tokensPerInterval ?? 60,
      maxRetries: config.maxRetries ?? 3,
      retryDelayMs: config.retryDelayMs ?? 1000,
      failureThreshold: config.failureThreshold ?? 5,
      cooldownSeconds: config.cooldownSeconds ?? 60,
    } as RateLimitConfig);
  }

  /**
  * Check if request is allowed (token bucket algorithm)
  * @param provider - Provider identifier
  * @param cost - Token cost for this request (default: 1)
  * @param headers - Request headers for bot detection
  * @returns Rate limit status
  */
  async checkLimit(
    provider: string, 
    cost: number = 1,
    headers?: Record<string, string | string[]> | undefined
  ): Promise<RateLimitStatus> {
    const config = this.configs.get(provider);
    if (!config) {
      // No limit configured, allow
      return { allowed: true, remainingTokens: Infinity, resetTime: new Date() };
    }

    // SECURITY FIX: Issue 14 - Bot detection
    let botDetection: BotDetectionResult | undefined;
    if (headers) {
      botDetection = detectBot(headers);
      if (botDetection.isBot) {
        // Reduce rate limit for suspected bots
        cost = cost * 2;
        logger.warn(`Bot detected: ${botDetection.confidence}% confidence`, {
          indicators: botDetection.indicators,
        });
      }
    }

    const key = `ratelimit:${provider}`;
    const failureKey = `ratelimit:${provider}:failures`;
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
        botDetection: botDetection ?? undefined,
      };
    }

    // Token bucket algorithm using Redis Lua script with EVALSHA caching
    const now = Math.floor(Date.now() / 1000);
    const scriptSha = await this.loadLuaScript();
    const tokensPerInterval = config.tokensPerInterval ?? 60;
    const intervalSeconds = config.intervalSeconds;
    const burstSize = config.burstSize ?? tokensPerInterval;
    const result = await this.executeLuaScript(
      scriptSha,
      [key],
      [
        tokensPerInterval,
        intervalSeconds,
        burstSize,
        cost,
        now
      ]
    );

    const [allowed, remainingTokens] = result;

    return {
      allowed: allowed === 1,
      remainingTokens,
      resetTime: new Date((now + config.intervalSeconds) * 1000),
      botDetection: botDetection ?? undefined,
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

// Export bot detection for external use
export { detectBot };

// ============================================================================
// Fastify Middleware Functions
// ============================================================================

import type { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from 'fastify';

/**
 * Rate limit middleware options
 */
interface RateLimitMiddlewareOptions {
  detectBots?: boolean;
}

// P0-FIX: In-memory store replaced with Redis-based distributed rate limiting
// See checkRateLimitRedis() below for distributed implementation
const rateLimitStore = new Map<string, { tokens: number; lastReset: number }>();

// P0-FIX: Import distributed rate limiter
import { checkRateLimit as checkRateLimitRedis, RateLimitConfig as RedisRateLimitConfig } from '@kernel/rateLimiterRedis';

function getClientIP(request: FastifyRequest): string {
  return (request as unknown as { ip?: string }).ip || 'unknown';
}

function checkRateLimit(key: string, config: RateLimitConfig): boolean {
  const now = Date.now();
  const intervalMs = (config.intervalSeconds ?? 60) * 1000;
  const entry = rateLimitStore.get(key);
  
  if (!entry || now - entry.lastReset > intervalMs) {
    rateLimitStore.set(key, { tokens: (config.tokensPerInterval ?? 10) - 1, lastReset: now });
    return true;
  }
  
  if (entry.tokens > 0) {
    entry.tokens--;
    return true;
  }
  
  return false;
}

/**
 * P0-FIX: Distributed rate limiting using Redis
 * Replaces in-memory Map for serverless environments
 * 
 * SECURITY FIX: Fail closed on Redis errors (P0 vulnerability)
 * When security controls fail, deny access rather than grant unlimited access.
 * 
 * @param key - Rate limit key
 * @param config - Rate limit configuration
 * @returns Promise resolving to whether request is allowed
 */
async function checkRateLimitDistributed(
  key: string, 
  config: RateLimitConfig
): Promise<boolean> {
  try {
    const result = await checkRateLimitRedis(key, {
      maxRequests: config.tokensPerInterval ?? 60,
      windowMs: (config.intervalSeconds ?? 60) * 1000,
      keyPrefix: 'ratelimit:middleware',
    });
    return result.allowed;
  } catch (error) {
    // P0-SECURITY-FIX: Fail closed on Redis errors
    // Previously returned true (allowed all traffic) - CRITICAL VULNERABILITY
    // Now returns false (denies traffic) - secure default
    logger.error(`[SECURITY] Redis rate limiter failure for key ${key} - failing closed (denying access): ${error instanceof Error ? error.message : String(error)}`);
    emitMetric({
      name: 'rate_limiter_redis_failure',
      labels: { key_prefix: key.split(':')[0] ?? 'unknown' },
      value: 1,
    });
    return false;
  }
}

/**
 * P0-FIX: Get rate limit key including org context for multi-tenant isolation
 * Prevents cross-tenant rate limit exhaustion
 */
function getRateLimitKey(request: FastifyRequest, prefix: string): string {
  const ip = getClientIP(request);
  // P0-FIX: Include org ID if available to prevent cross-tenant exhaustion
  const orgId = (request as unknown as { orgId?: string }).orgId;
  if (orgId) {
    return `${prefix}:${orgId}:${ip}`;
  }
  return `${prefix}:${ip}`;
}

/**
 * Create admin rate limit middleware
 * Uses strict rate limiting for admin endpoints
 * P0-FIX: Now uses distributed Redis rate limiting
 */
export function adminRateLimit() {
  return async (
    request: FastifyRequest,
    reply: FastifyReply,
    done: HookHandlerDoneFunction
  ) => {
    // P0-FIX: Reduced to 10 req/min for admin endpoints (was 100)
    const config: RateLimitConfig = {
      tokensPerInterval: 10,
      intervalSeconds: 60,
      burstSize: 10,
    };
    
    // P0-FIX: Use distributed key with tenant isolation
    const key = getRateLimitKey(request, 'admin');
    
    // P0-FIX: Distributed rate limiting with fail-closed behavior
    const allowed = await checkRateLimitDistributed(key, config);
    
    if (!allowed) {
      reply.status(429).send({ error: 'Rate limit exceeded' });
      return;
    }
    
    done();
  };
}

/**
 * Create API rate limit middleware
 * Standard rate limiting for API endpoints
 * P0-FIX: Now uses distributed Redis rate limiting
 */
export function apiRateLimit() {
  return async (
    request: FastifyRequest,
    reply: FastifyReply,
    done: HookHandlerDoneFunction
  ) => {
    // API rate limit: 60 requests per minute
    const config: RateLimitConfig = {
      tokensPerInterval: 60,
      intervalSeconds: 60,
      burstSize: 60,
    };
    
    // P0-FIX: Use distributed key with tenant isolation
    const key = getRateLimitKey(request, 'api');
    
    // P0-FIX: Distributed rate limiting with fail-closed behavior
    const allowed = await checkRateLimitDistributed(key, config);
    
    if (!allowed) {
      reply.status(429).send({ error: 'Rate limit exceeded' });
      return;
    }
    
    done();
  };
}

/**
 * Create configurable rate limit middleware
 * @param tier - Rate limit tier ('strict', 'standard', 'lenient')
 * @param customConfig - Optional custom config
 * @param options - Additional options
 */
export function rateLimitMiddleware(
  tier: 'strict' | 'standard' | 'lenient' = 'standard',
  customConfig?: Partial<RateLimitConfig>,
  options: RateLimitMiddlewareOptions = {}
) {
  return async (
    request: FastifyRequest,
    reply: FastifyReply,
    done: HookHandlerDoneFunction
  ) => {
    // Bot detection
    if (options.detectBots) {
      const botResult = detectBot(request.headers as Record<string, string | string[]>);
      if (botResult.isBot && botResult.confidence > 0.7) {
        reply.status(403).send({ error: 'Bot detected' });
        return;
      }
    }
    
    // Tier-based rate limits
    const tierLimits: Record<string, RateLimitConfig> = {
      strict: { tokensPerInterval: 10, intervalSeconds: 60, burstSize: 10 },
      standard: { tokensPerInterval: 60, intervalSeconds: 60, burstSize: 60 },
      lenient: { tokensPerInterval: 1000, intervalSeconds: 60, burstSize: 100 },
    };
    
    const tierConfig = tierLimits[tier] ?? tierLimits['standard']!;
    const tokensPerInterval = customConfig?.tokensPerInterval ?? tierConfig.tokensPerInterval ?? 60;
    const intervalSeconds = customConfig?.intervalSeconds ?? tierConfig.intervalSeconds ?? 60;
    const burstSize = customConfig?.burstSize ?? tierConfig.burstSize ?? tokensPerInterval;
    const maxRetries = customConfig?.maxRetries ?? tierConfig.maxRetries ?? 3;
    const retryDelayMs = customConfig?.retryDelayMs ?? tierConfig.retryDelayMs ?? 1000;
    const failureThreshold = customConfig?.failureThreshold ?? tierConfig.failureThreshold ?? 5;
    const cooldownSeconds = customConfig?.cooldownSeconds ?? tierConfig.cooldownSeconds ?? 60;
    
    const config: RateLimitConfig = {
      tokensPerInterval,
      intervalSeconds,
      burstSize,
      maxRetries,
      retryDelayMs,
      failureThreshold,
      cooldownSeconds,
    };
    
    // P0-CRITICAL-FIX: Use distributed rate limiting with tenant isolation
    // SECURITY: Previously used in-memory checkRateLimit() which bypassed Redis
    // This allowed rate limit bypass in scaled deployments (multiple instances)
    const key = getRateLimitKey(request, tier);
    const allowed = await checkRateLimitDistributed(key, config);
    
    if (!allowed) {
      reply.status(429).send({ error: 'Rate limit exceeded' });
      return;
    }
    
    done();
  };
}
