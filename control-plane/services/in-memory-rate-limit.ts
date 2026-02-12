/**
 * In-Memory Rate Limiter
 *
 * Extracted from control-plane/api/http.ts for testability.
 * Used as a fallback when Redis is unavailable for auth rate limiting.
 */

export interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfter: number;
}

/**
 * In-memory rate limiter using a Map for storage.
 * Designed as a fallback for Redis-based rate limiting during outages.
 */
export class InMemoryRateLimiter {
  private readonly map = new Map<string, RateLimitEntry>();
  private readonly cleanupThreshold: number;

  constructor(cleanupThreshold = 1000) {
    this.cleanupThreshold = cleanupThreshold;
  }

  /**
   * Check and increment rate limit for a given key.
   * @param key - Rate limit key (e.g., `ratelimit:auth:<ip>`)
   * @param max - Maximum allowed requests in the window
   * @param windowMs - Window duration in milliseconds
   * @returns Whether the request is allowed and retry-after seconds
   */
  check(key: string, max: number, windowMs: number): RateLimitResult {
    const now = Date.now();

    // Periodic cleanup of expired entries
    if (this.map.size > this.cleanupThreshold) {
      this.cleanup(now);
    }

    const entry = this.map.get(key);

    if (!entry || entry.resetAt < now) {
      this.map.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true, retryAfter: 0 };
    }

    entry.count++;
    if (entry.count > max) {
      return { allowed: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
    }
    return { allowed: true, retryAfter: 0 };
  }

  /**
   * Remove expired entries from the map.
   */
  cleanup(now: number = Date.now()): number {
    let removed = 0;
    for (const [k, v] of this.map) {
      if (v.resetAt < now) {
        this.map.delete(k);
        removed++;
      }
    }
    return removed;
  }

  /**
   * Get the current size of the rate limit map.
   */
  get size(): number {
    return this.map.size;
  }

  /**
   * Clear all entries.
   */
  clear(): void {
    this.map.clear();
  }
}
