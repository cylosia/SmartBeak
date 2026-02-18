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
export function checkRateLimit(_ip: string): { allowed: boolean; retryAfter?: number } {
  // SECURITY FIX: The previous implementation fired a fire-and-forget Redis
  // check and unconditionally returned { allowed: true }, meaning this wrapper
  // provided zero rate-limit enforcement. A synchronous wrapper cannot safely
  // await the async Redis result.
  //
  // This export is @deprecated. Use rateLimitMiddleware (below) or call
  // checkRateLimitRedis() directly for all async callers.
  //
  // Fail closed: deny all calls to this deprecated synchronous path so that
  // any remaining callers are forced to migrate to the async middleware.
  logger.warn('checkRateLimit (sync, deprecated) called — failing closed. Migrate to rateLimitMiddleware.');
  return { allowed: false, retryAfter: 60 };
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
