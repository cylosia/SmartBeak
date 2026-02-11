import { getLogger } from '@kernel/logger';

/**
* TTL Cache Service with LRU Eviction
* In-memory cache with time-to-live expiration and max size limit
*/

const logger = getLogger('cache');

export interface ClearableCache<T> {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  clear(): void;
}

function isClearableCache<T>(cache: unknown): cache is ClearableCache<T> {
  return (
  typeof cache === 'object' &&
  cache !== null &&
  'clear' in cache &&
  typeof (cache as Record<string, unknown>)['clear'] === 'function'
  );
}

export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  lastAccessed: number; // For LRU tracking
  accessCount: number;  // For LFU tracking (optional)
}

export interface CacheStats {
  size: number;
  maxSize: number;
  hitRate: number;
  hits: number;
  misses: number;
  evictions: number;
}

export interface CacheOptions {
  ttlMs: number;
  maxSize?: number;      // Maximum number of entries before LRU eviction
  checkIntervalMs?: number; // Interval for periodic cleanup
}

export class TTLCache<T> {
  private store = new Map<string, CacheEntry<T>>();
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private cleanupTimer: ReturnType<typeof setInterval> | undefined;
  private readonly maxSize: number;

  constructor(private options: CacheOptions) {
  if (!Number.isFinite(options.ttlMs) || options.ttlMs <= 0) {
    throw new Error('Invalid TTL: must be a positive number');
  }

  this.maxSize = options.maxSize ?? 10000;

  if (this.maxSize <= 0) {
    throw new Error('Invalid maxSize: must be a positive number');
  }

  // Set up periodic cleanup if interval specified
  if (options.checkIntervalMs && options.checkIntervalMs > 0) {
    this.cleanupTimer = setInterval(() => this.cleanup(), options.checkIntervalMs);
    // P0-FIX: Add unref to prevent blocking graceful shutdown
    this.cleanupTimer.unref();
  }
  }

  /**
  * Get a value from the cache
  * @param key - Cache key
  * @returns Cached value or undefined if not found or expired
  */
  get(key: string): T | undefined {
  try {
    if (typeof key !== 'string' || key.length === 0) {
    logger.warn('Invalid cache key provided', { key });
    this.misses++;
    return undefined;
    }

    const entry = this.store.get(key);
    if (!entry) {
    this.misses++;
    return undefined;
    }

    if (entry.expiresAt < Date.now()) {
    this.store.delete(key);
    this.misses++;
    return undefined;
    }

    entry.lastAccessed = Date.now();
    entry.accessCount++;

    this.hits++;
    return entry.value;
  } catch (error) {
    logger["error"]('Error retrieving from cache', error instanceof Error ? error : new Error(String(error)), { key });
    this.misses++;
    return undefined;
  }
  }

  /**
  * Set a value in the cache
  * @param key - Cache key
  * @param value - Value to cache
  */
  set(key: string, value: T): void {
  try {
    if (typeof key !== 'string' || key.length === 0) {
    logger.warn('Invalid cache key provided for set', { key });
    return;
    }

    if (this.store.size >= this.maxSize && !this.store.has(key)) {
    this.evictLRU();
    }

    const now = Date.now();
    this.store.set(key, {
    value,
    expiresAt: now + this.options.ttlMs,
    lastAccessed: now,
    accessCount: 0,
    });
  } catch (error) {
    logger["error"]('Error setting cache value', error instanceof Error ? error : new Error(String(error)), { key });
  }
  }

  private evictLRU(): void {
  let oldestKey: string | null = null;
  let oldestTime = Infinity;

  for (const [key, entry] of this.store.entries()) {
    if (entry.lastAccessed < oldestTime) {
    oldestTime = entry.lastAccessed;
    oldestKey = key;
    }
  }

  if (oldestKey) {
    this.store.delete(oldestKey);
    this.evictions++;
    logger.debug('LRU eviction', { evictedKey: oldestKey, totalEvictions: this.evictions });
  }
  }

  /**
  * Remove a value from the cache
  * @param key - Cache key to invalidate
  */
  invalidate(key: string): void {
  try {
    if (typeof key !== 'string' || key.length === 0) {
    logger.warn('Invalid cache key provided for invalidate', { key });
    return;
    }

    this.store.delete(key);
  } catch (error) {
    logger["error"]('Error invalidating cache key', error instanceof Error ? error : new Error(String(error)), { key });
  }
  }

  /**
  * Clear all entries from the cache
  */
  clear(): void {
  try {
    this.store["clear"]();
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  } catch (error) {
    const errorToLog = error instanceof Error ? error : new Error(String(error));
    logger["error"]('Error clearing cache', errorToLog);
  }
  }

  /**
  * Clean up expired entries
  */
  cleanup(): number {
  const now = Date.now();
  let removed = 0;

  for (const [key, entry] of this.store.entries()) {
    if (entry.expiresAt < now) {
    this.store.delete(key);
    removed++;
    }
  }

  if (removed > 0) {
    logger.debug('Cache cleanup', { removedEntries: removed, remainingEntries: this.store.size });
  }

  return removed;
  }

  /**
  * Get cache statistics
  */
  getStats(): CacheStats {
  const total = this.hits + this.misses;
  return {
    size: this.store.size,
    maxSize: this.maxSize,
    hitRate: total > 0 ? this.hits / total : 0,
    hits: this.hits,
    misses: this.misses,
    evictions: this.evictions,
  };
  }

  /**
  * Get all keys (useful for debugging)
  */
  keys(): string[] {
  return Array.from(this.store.keys());
  }

  /**
  * Check if key exists and is not expired
  */
  has(key: string): boolean {
  const entry = this.store.get(key);
  if (!entry) return false;
  if (entry.expiresAt < Date.now()) {
    this.store.delete(key);
    return false;
  }
  return true;
  }

  /**
  * Dispose of the cache and cleanup timers
  */
  dispose(): void {
  if (this.cleanupTimer) {
    clearInterval(this.cleanupTimer);
    this.cleanupTimer = undefined;
  }
  this["clear"]();
  }
}

/**
* Simple convenience function for creating a cache
*/
export function createCache<T>(ttlMs: number, maxSize?: number): TTLCache<T> {
  const options: CacheOptions = { ttlMs };
  if (maxSize !== undefined) {
    options.maxSize = maxSize;
  }
  return new TTLCache<T>(options);
}
