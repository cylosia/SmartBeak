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
 * @deprecated Use `checkRateLimitAsync` or the Fastify `preHandler` hook instead.
 *
 * P0-SECURITY FIX: This function was a no-op that always returned `{ allowed: true }`,
 * providing zero rate-limit protection. It is now fail-closed to force migration.
 *
 * @throws Error unconditionally — migrate to `checkRateLimitAsync(ip)`.
 */
export function checkRateLimit(_ip: string): { allowed: boolean; retryAfter?: number } {
  throw new Error(
    'checkRateLimit() is deprecated and was a no-op. ' +
    'Use checkRateLimitAsync() or the rateLimitMiddleware Fastify preHandler instead.'
  );
}

/**
 * Async rate limit check that actually enforces limits via Redis.
 * Use this in Fastify `preHandler` hooks or directly in route handlers.
 *
 * @param ip - Client IP address
 * @returns Rate limit result — callers MUST deny the request when `allowed` is false.
 */
export async function checkRateLimitAsync(ip: string): Promise<{ allowed: boolean; retryAfter?: number }> {
  const windowMs = securityConfig.rateLimitWindowMs;
  const maxRequests = securityConfig.rateLimitMaxRequests;

  try {
    const result = await checkRateLimitRedis(`emailsub:${ip}`, {
      maxRequests,
      windowMs,
      keyPrefix: 'ratelimit:emailsub',
    });

    if (!result.allowed) {
      const retryAfter = Math.ceil((result.resetTime - Date.now()) / 1000);
      return { allowed: false, retryAfter };
    }

    return { allowed: true };
  } catch {
    // Fail closed: if rate limiter is unavailable, deny the request
    logger.warn('Rate limiter unavailable; failing closed', { ipPrefix: ip.substring(0, 8) });
    return { allowed: false, retryAfter: 60 };
  }
}

/**
* Rate limit middleware
* Now delegates to kernel's distributed Redis rate limiter.
*/
// P1-FIX: Convert to async to eliminate the floating promise.
// The previous void checkRateLimitRedis(...).then().catch() pattern detached
// the async work from the calling frame. Any exception after .catch()
// (e.g., from res.status().send() itself) became an unhandled rejection that
// crashes Node.js under --unhandled-rejections=throw (Node 15+ default).
export async function rateLimitMiddleware(
  req: { ip?: string; socket?: { remoteAddress?: string } },
  res: { status: (code: number) => { send: (body: unknown) => void } },
  next: () => void
): Promise<void> {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';

  try {
    const result = await checkRateLimitRedis(`emailsub:${ip}`, {
      maxRequests: securityConfig.rateLimitMaxRequests,
      windowMs: securityConfig.rateLimitWindowMs,
      keyPrefix: 'ratelimit:emailsub',
    });
    if (!result.allowed) {
      const retryAfter = Math.ceil((result.resetTime - Date.now()) / 1000);
      res.status(429).send({ error: 'Rate limit exceeded', retryAfter });
      return;
    }
    next();
  } catch {
    // Fail closed: deny on error
    res.status(429).send({ error: 'Rate limit exceeded', retryAfter: 60 });
  }
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
