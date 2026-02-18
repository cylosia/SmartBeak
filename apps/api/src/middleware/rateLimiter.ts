import { emitMetric } from '../ops/metrics';
import { getLogger } from '@kernel/logger';
import { detectBot as _kernelDetectBot } from '@kernel/bot-detection';
import { getClientIp as _kernelGetClientIp } from '@kernel/ip-utils';

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

// Bot detection — canonical implementation in @kernel/bot-detection
export type { BotDetectionResult } from '@kernel/bot-detection';
const detectBot = _kernelDetectBot;

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

// IP extraction — canonical implementation in @kernel/ip-utils
function getClientIP(request: FastifyRequest): string {
  return _kernelGetClientIp(request as unknown as { headers: Record<string, string | string[] | undefined>; ip?: string });
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
      // burstSize must be >= tokensPerInterval; otherwise burst becomes the
      // effective cap and the stated rate limit of 1000 req/min is never reachable.
      lenient: { tokensPerInterval: 1000, intervalSeconds: 60, burstSize: 1000 },
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
