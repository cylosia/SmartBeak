import { LRUCache } from 'lru-cache';
import type { NextApiRequest, NextApiResponse } from 'next';

/**
* Rate Limiting Utility for Next.js API Routes
*
* WARNING: This implementation uses an in-memory LRU cache only.
* It is NOT distributed — each Next.js instance maintains its own counter.
* In a scaled deployment (multiple instances behind a load balancer) an
* attacker can bypass rate limits by distributing requests across instances,
* effectively multiplying their allowed rate by the number of running pods.
*
* For production deployments with horizontal scaling, replace the in-memory
* counter with a shared Redis-backed store (e.g. @kernel/rateLimiterRedis).
* This file is intentionally kept simple for single-instance or local dev use.
*/

export interface RateLimitRecord {
  count: number;
  reset: number;
}

// In-memory cache for rate limiting (fallback when Redis is not available)
const memoryCounters = new LRUCache<string, RateLimitRecord>({
  max: 10000,
  ttl: 60000, // 1 minute
});

/**
* Extract client IP from request
*/
function getClientIp(req: NextApiRequest): string {
  const forwarded = req.headers['x-forwarded-for'];
  const ip = typeof forwarded === 'string'
  ? (forwarded.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown')
  : req.socket.remoteAddress || 'unknown';
  return ip;
}

/**
* Rate limit function for Next.js API routes
* Pattern: await rateLimit('endpoint-name', limit, req, res);
*
* @param endpoint - Unique identifier for the endpoint
* @param limit - Maximum requests per minute
* @param req - NextApiRequest object
* @param res - NextApiResponse object
* @returns Promise<boolean> - true if allowed, false if rate limited
*/
export async function rateLimit(
  endpoint: string,
  limit: number,
  req: NextApiRequest,
  res: NextApiResponse
): Promise<boolean> {
  const ip = getClientIp(req);
  const key = `${endpoint}:${ip}`;
  const now = Date.now();
  const windowMs = 60000; // 1 minute window

  const entry = memoryCounters.get(key) ?? { count: 0, reset: now + windowMs };

  // Reset if window has passed
  if (now > entry.reset) {
  entry.count = 0;
  entry.reset = now + windowMs;
  }

  entry.count++;
  memoryCounters.set(key, entry);

  // Set rate limit headers
  res.setHeader('X-RateLimit-Limit', limit);
  res.setHeader('X-RateLimit-Remaining', Math.max(0, limit - entry.count));
  res.setHeader('X-RateLimit-Reset', Math.ceil(entry.reset / 1000));

  if (entry.count > limit) {
  res.status(429).json({
    error: 'Too many requests',
    message: `Rate limit exceeded for ${endpoint}. Please try again later.`,
    retryAfter: Math.ceil((entry.reset - now) / 1000),
  });
  return false;
  }

  return true;
}

export default rateLimit;
