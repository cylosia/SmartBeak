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
// Re-export types and class from canonical implementation
// ============================================================================

// Import the canonical RateLimiter and DEFAULT_RATE_LIMITS from utils
// to avoid duplication. The middleware file focuses on bot detection
// and Fastify middleware wiring.
import {
  RateLimiter,
  DEFAULT_RATE_LIMITS,
  type RateLimitConfig,
  type RateLimitStatus,
} from '../utils/rateLimiter';

export { RateLimiter, DEFAULT_RATE_LIMITS };
export type { RateLimitConfig, RateLimitStatus };

// Export bot detection for external use
export { detectBot };

// ============================================================================
// Fastify Middleware Functions
// ============================================================================

import type { FastifyRequest, FastifyReply } from 'fastify';

/**
 * Rate limit middleware options
 */
interface RateLimitMiddlewareOptions {
  detectBots?: boolean;
}

// P0-FIX: Import distributed rate limiter
import { checkRateLimit as checkRateLimitRedis } from '@kernel/rateLimiterRedis';

// P1-FIX: Removed dead in-memory rateLimitStore Map and checkRateLimit() function.
// They were replaced by checkRateLimitDistributed() (Redis-based) but never deleted,
// creating a security footgun: any code importing checkRateLimit() directly would
// bypass distributed rate limiting, allowing per-instance limits in scaled deployments.

function getClientIP(request: FastifyRequest): string {
  return (request as unknown as { ip?: string }).ip || 'unknown';
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
    reply: FastifyReply
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
      return reply.status(429).send({ error: 'Rate limit exceeded' });
    }
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
    reply: FastifyReply
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
      return reply.status(429).send({ error: 'Rate limit exceeded' });
    }
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
    reply: FastifyReply
  ) => {
    // Bot detection
    if (options.detectBots) {
      const botResult = detectBot(request.headers as Record<string, string | string[]>);
      // P0-FIX #8: confidence is 0-100 (integer), not 0-1 (float).
      // Previously compared > 0.7, which matched ANY non-zero score, blocking legitimate users.
      if (botResult.isBot && botResult.confidence > 70) {
        return reply.status(403).send({ error: 'Bot detected' });
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
      return reply.status(429).send({ error: 'Rate limit exceeded' });
    }
  };
}
