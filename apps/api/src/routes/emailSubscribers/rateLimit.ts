import { securityConfig } from '@config';
import { getLogger } from '@kernel/logger';

/**
* Rate Limiting Module
* P2-MEDIUM FIX: Extracted from emailSubscribers.ts God class
* Provides LRU-based rate limiting for email subscriber endpoints
*/

const logger = getLogger('EmailSubscriberRateLimit');


/**
* Rate limit store with LRU eviction and size limits
* FIX: Uses LRU store with automatic eviction to prevent memory leaks
*/
export class LRURateLimitStore {
  private store = new Map<string, { count: number; resetTime: number }>();
  private readonly maxSize: number;
  private readonly windowMs: number;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(maxSize = securityConfig.maxRateLimitStoreSize, windowMs = securityConfig.rateLimitWindowMs) {
    this.maxSize = maxSize;
    this.windowMs = windowMs;
    this.startCleanupInterval();
  }

  /**
  * Get rate limit record for an IP
  * Moves accessed entries to end (most recently used)
  */
  get(ip: string): { count: number; resetTime: number } | undefined {
    const record = this.store.get(ip);
    if (record) {
    // Check if expired
    if (Date.now() > record.resetTime) {
        this.store.delete(ip);
        return undefined;
    }
    // Move to end (most recently used)
    this.store.delete(ip);
    this.store.set(ip, record);
    }
    return record;
  }

  /**
  * Set rate limit record for an IP
  * Evicts oldest entry if at capacity
  */
  set(ip: string, record: { count: number; resetTime: number }): void {
    // If key exists, delete first to move to end
    if (this.store.has(ip)) {
    this.store.delete(ip);
    } else if (this.store.size >= this.maxSize) {
    // Evict oldest entry (first in Map)
    const firstKey = this.store.keys().next().value as string | undefined;
    if (firstKey) {
      this.store.delete(firstKey);
      logger.warn(`Store at capacity, evicted oldest entry for ${firstKey}`);
    }
    }
    this.store.set(ip, record);
  }

  /**
  * Delete rate limit record
  */
  delete(ip: string): boolean {
    return this.store.delete(ip);
  }

  /**
  * Get current store size
  */
  get size(): number {
    return this.store.size;
  }

  /**
  * Clean up expired entries
  */
  cleanup(): void {
    const now = Date.now();
    let cleaned = 0;
    for (const [ip, record] of this.store.entries()) {
    if (now > record.resetTime) {
        this.store.delete(ip);
        cleaned++;
    }
    }
    if (cleaned > 0) {
    logger.info(`Cleaned up ${cleaned} expired entries`);
    }
  }

  /**
  * Start periodic cleanup interval
  */
  private startCleanupInterval(): void {
    // Cleanup periodically
    this.cleanupInterval = setInterval(() => {
    this.cleanup();
    }, securityConfig.rateLimitCleanupIntervalMs).unref();
  }

  /**
  * Stop cleanup interval (for graceful shutdown)
  */
  stopCleanup(): void {
    if (this.cleanupInterval) {
    clearInterval(this.cleanupInterval);
    this.cleanupInterval = null;
    }
  }

  /**
  * Clear all entries
  */
  clear(): void {
    this.store.clear();
  }
}

// Global rate limit store instance
const rateLimitStore = new LRURateLimitStore(securityConfig.maxRateLimitStoreSize, securityConfig.rateLimitWindowMs);

/**
* Check rate limit for an IP
* Limit: 10 requests per minute per IP
* FIX: Uses LRU store with automatic eviction
* @param ip - Client IP address
* @returns Rate limit check result
*/
export function checkRateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const windowMs = securityConfig.rateLimitWindowMs;
  const maxRequests = securityConfig.rateLimitMaxRequests;

  const record = rateLimitStore.get(ip);

  if (!record || now > record.resetTime) {
    // New window
    rateLimitStore.set(ip, { count: 1, resetTime: now + windowMs });
    return { allowed: true };
  }

  if (record["count"] >= maxRequests) {
    return {
    allowed: false,
    retryAfter: Math.ceil((record.resetTime - now) / 1000)
    };
  }

  record["count"]++;
  rateLimitStore.set(ip, record);
  return { allowed: true };
}

/**
* Rate limit middleware
* P0-SECURITY FIX: Previously a no-op that just called next().
* Now properly wires checkRateLimit to block abusive traffic.
*/
export function rateLimitMiddleware(
  req: { ip?: string; socket?: { remoteAddress?: string } },
  res: { status: (code: number) => { send: (body: unknown) => void } },
  next: () => void
): void {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const result = checkRateLimit(ip);
  if (!result.allowed) {
    res.status(429).send({
      error: 'Rate limit exceeded',
      retryAfter: result.retryAfter,
    });
    return;
  }
  next();
}

export function cleanupRateLimitStore(): void {
  rateLimitStore.stopCleanup();
  rateLimitStore.clear();
  logger.info('Rate limit store cleaned up');
}

// P2-ARCHITECTURE FIX: Move signal registration to explicit init function
// instead of module-level side effect. This prevents duplicate handler
// registration when the module is imported in tests.
export function registerShutdownHandlers(): void {
  process.on('SIGTERM', cleanupRateLimitStore);
  process.on('SIGINT', cleanupRateLimitStore);
}
