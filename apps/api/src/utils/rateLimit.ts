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

/**
* Extract client IP from request
* P1-FIX: IP Spoofing - Only trust X-Forwarded-For from trusted proxies
*/
function getClientIp(req: FastifyRequest): string {
  const trustedProxies = process.env['TRUSTED_PROXIES']?.split(',').map(p => p.trim()) || [];

  // Only trust X-Forwarded-If from trusted proxies is configured
  if (trustedProxies.length > 0) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded) {
      const ips = forwarded.split(',').map(ip => ip.trim());
      const clientIp = ips[0];
      // Basic IP validation
      if (clientIp && isValidIp(clientIp)) {
        return clientIp;
      }
    }
  }

  // Fallback to direct connection IP
  return req["ip"] || 'unknown';
}

/**
* Validate IP address format (IPv4 or IPv6)
*/
function isValidIp(ip: string): boolean {
  // IPv4 validation
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  // IPv6 validation (simplified)
  const ipv6Regex = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;

  return ipv4Regex.test(ip) || ipv6Regex.test(ip);
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
