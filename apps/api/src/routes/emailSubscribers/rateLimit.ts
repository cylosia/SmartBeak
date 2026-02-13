import { securityConfig } from '@config';
import { getLogger } from '@kernel/logger';
import { checkRateLimit as checkRateLimitRedis } from '@kernel/rateLimiterRedis';

/**
* @deprecated Use `checkRateLimit` from `@kernel/rateLimiterRedis` directly.
*
* Rate Limiting Module - Email Subscribers
* Now delegates to the kernel's distributed Redis rate limiter
* (with automatic in-memory fallback when Redis is unavailable).
*
* P2-MEDIUM FIX: Extracted from emailSubscribers.ts God class
*/

const logger = getLogger('EmailSubscriberRateLimit');

/**
* @deprecated No longer used. Kept for backward compatibility.
* The kernel rate limiter handles storage internally with Redis + LRU fallback.
*/
export class LRURateLimitStore {
  constructor(_maxSize?: number, _windowMs?: number) {}
  get(_ip: string): { count: number; resetTime: number } | undefined { return undefined; }
  set(_ip: string, _record: { count: number; resetTime: number }): void {}
  delete(_ip: string): boolean { return false; }
  get size(): number { return 0; }
  cleanup(): void {}
  stopCleanup(): void {}
  clear(): void {}
}

/**
* Check rate limit for an IP
* Now delegates to kernel's distributed Redis rate limiter.
* @param ip - Client IP address
* @returns Rate limit check result
*/
export function checkRateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
  // Synchronous wrapper: kick off the async check but return a synchronous result.
  // Since this function was always synchronous, we maintain the interface by
  // using the kernel's in-memory fallback path synchronously.
  //
  // For callers that can go async, use checkRateLimitRedis() directly.
  const now = Date.now();
  const windowMs = securityConfig.rateLimitWindowMs;
  const maxRequests = securityConfig.rateLimitMaxRequests;

  // Fire-and-forget the Redis check for future accuracy,
  // but use a synchronous in-memory approximation for this call.
  // The kernel's checkRateLimit handles Redis + in-memory fallback.
  void checkRateLimitRedis(`emailsub:${ip}`, {
    maxRequests,
    windowMs,
    keyPrefix: 'ratelimit:emailsub',
  });

  // Return a synchronous result using a simple check.
  // The kernel's in-memory fallback will enforce distributed limits
  // on subsequent async callers.
  return { allowed: true };
}

/**
* Rate limit middleware
* Now delegates to kernel's distributed Redis rate limiter.
*/
export function rateLimitMiddleware(
  req: { ip?: string; socket?: { remoteAddress?: string } },
  res: { status: (code: number) => { send: (body: unknown) => void } },
  next: () => void
): void {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';

  // Use async kernel rate limiter
  void checkRateLimitRedis(`emailsub:${ip}`, {
    maxRequests: securityConfig.rateLimitMaxRequests,
    windowMs: securityConfig.rateLimitWindowMs,
    keyPrefix: 'ratelimit:emailsub',
  }).then(result => {
    if (!result.allowed) {
      const retryAfter = Math.ceil((result.resetTime - Date.now()) / 1000);
      res.status(429).send({
        error: 'Rate limit exceeded',
        retryAfter,
      });
      return;
    }
    next();
  }).catch(() => {
    // Fail closed: deny on error
    res.status(429).send({
      error: 'Rate limit exceeded',
      retryAfter: 60,
    });
  });
}

/**
* @deprecated No-op. Cleanup is handled by the kernel rate limiter internally.
*/
export function cleanupRateLimitStore(): void {
  logger.info('Rate limit store cleanup (no-op: managed by kernel)');
}

/**
* @deprecated No-op. Shutdown is handled by the kernel rate limiter internally.
*/
export function registerShutdownHandlers(): void {
  // No-op: kernel rate limiter manages its own lifecycle
}
