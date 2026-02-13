import type { FastifyRequest, FastifyReply } from 'fastify';
import { LRUCache } from 'lru-cache';

/**
* Rate Limiting Utility for Fastify Routes in apps/api
* Simplified wrapper that matches the pattern: await rateLimit('endpoint-name', limit, req, res);
*
* @module utils/rateLimit
*/

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

function getClientIp(req: FastifyRequest): string {
  return kernelGetClientIp(req as unknown as { headers: Record<string, string | string[] | undefined>; ip?: string });
}

/**
* Rate limit function for Fastify routes
* Pattern: await rateLimit('endpoint-name', limit, req, res);
*
* @param endpoint - Unique identifier for the endpoint
* @param limit - Maximum requests per minute
* @param req - FastifyRequest object
* @param res - FastifyReply object
* @returns Promise<boolean> - true if allowed, throws if rate limited
*/
export async function rateLimit(
  endpoint: string,
  limit: number,
  req: FastifyRequest,
  res: FastifyReply
): Promise<boolean> {
  const ip = getClientIp(req);
  const key = `${endpoint}:${ip}`;
  const now = Date.now();
  const windowMs = 60000; // 1 minute window

  const entry = memoryCounters.get(key) ?? { count: 0, reset: now + windowMs };

  // Reset if window has passed
  if (now > entry.reset) {
  entry["count"] = 0;
  entry.reset = now + windowMs;
  }

  entry["count"]++;
  memoryCounters.set(key, entry);

  // Set rate limit headers
  void res.header('X-RateLimit-Limit', limit);
  void res.header('X-RateLimit-Remaining', Math.max(0, limit - entry["count"]));
  void res.header('X-RateLimit-Reset', Math.ceil(entry.reset / 1000));

  if (entry["count"] > limit) {
  // P0-FIX: Just return after sending response - don't throw to prevent double response
  void res.status(429).send({
    error: 'Too many requests',
    message: `Rate limit exceeded for ${endpoint}. Please try again later.`,
    retryAfter: Math.ceil((entry.reset - now) / 1000),
  });
  return false;
  }

  return true;
}

export default rateLimit;
