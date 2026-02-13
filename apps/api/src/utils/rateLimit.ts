import type { FastifyRequest, FastifyReply } from 'fastify';
import { checkRateLimit as checkRateLimitRedis } from '@kernel/rateLimiterRedis';
import { getLogger } from '@kernel/logger';

/**
* @deprecated Use `checkRateLimit` from `@kernel/rateLimiterRedis` directly.
* This file is a backward-compatible shim that delegates to the kernel
* distributed rate limiter (with automatic in-memory fallback).
*
* @module utils/rateLimit
*/

const logger = getLogger('rateLimit');

export interface RateLimitRecord {
  count: number;
  reset: number;
}

/** Default rate limit window in milliseconds (1 minute) */
const DEFAULT_RATE_WINDOW_MS = 60000;

/** Maximum entries in rate limit cache */
const MAX_CACHE_ENTRIES = 10000;

// In-memory cache for rate limiting
const memoryCounters = new LRUCache<string, RateLimitRecord>({
  max: MAX_CACHE_ENTRIES,
  ttl: DEFAULT_RATE_WINDOW_MS,
});

// IP extraction — canonical implementation in @kernel/ip-utils
import { getClientIp as kernelGetClientIp } from '@kernel/ip-utils';
/**
* Extract client IP from request
* P1-FIX: IP Spoofing - Only trust X-Forwarded-For from trusted proxies
*/
function getClientIp(req: FastifyRequest): string {
  const trustedProxies = process.env['TRUSTED_PROXIES']?.split(',').map(p => p.trim()) || [];

function getClientIp(req: FastifyRequest): string {
  return kernelGetClientIp(req as unknown as { headers: Record<string, string | string[] | undefined>; ip?: string });
}

/**
* @deprecated Use `checkRateLimit` from `@kernel/rateLimiterRedis` directly.
*
* Rate limit function for Fastify routes.
* Now delegates to the kernel's distributed Redis rate limiter
* (with automatic in-memory fallback when Redis is unavailable).
*
* @param endpoint - Unique identifier for the endpoint
* @param limit - Maximum requests per minute
* @param req - FastifyRequest object
* @param res - FastifyReply object
* @returns Promise<boolean> - true if allowed, false if rate limited
*/
export async function rateLimit(
  endpoint: string,
  limit: number,
  req: FastifyRequest,
  res: FastifyReply
): Promise<boolean> {
  const ip = getClientIp(req);
  const key = `${endpoint}:${ip}`;

  const result = await checkRateLimitRedis(key, {
    maxRequests: limit,
    windowMs: 60000, // 1 minute window
    keyPrefix: 'ratelimit:api',
  });

  // Set rate limit headers
  void res.header('X-RateLimit-Limit', result.limit);
  void res.header('X-RateLimit-Remaining', result.remaining);
  void res.header('X-RateLimit-Reset', Math.ceil(result.resetTime / 1000));

  if (!result.allowed) {
    const retryAfter = Math.ceil((result.resetTime - Date.now()) / 1000);
    void res.status(429).send({
      error: 'Too many requests',
      message: `Rate limit exceeded for ${endpoint}. Please try again later.`,
      retryAfter,
    });
    return false;
  }

  return true;
}

export default rateLimit;
