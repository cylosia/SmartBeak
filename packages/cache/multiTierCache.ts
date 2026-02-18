/**
 * Multi-Tier Caching Implementation
 * 
 * Provides a two-tier caching system:
 * - L1: In-memory LRU cache (fast, ephemeral)
 * - L2: Redis cache (distributed, persistent)
 * 
 * P2 OPTIMIZATION: Implements cache-aside pattern with write-through
 * for frequently accessed data.
 * 
 * MEMORY LEAK FIX: Added TTL-based cleanup for in-flight requests
 * with automatic timeout handling and max concurrent limits.
 */

import { createHash } from 'node:crypto';
import { LRUCache } from 'lru-cache';
import Redis from 'ioredis';
import { getLogger } from '../kernel/logger';

// ============================================================================
// Constants for Memory Leak Prevention
// ============================================================================

/** Default TTL for in-flight requests (30 seconds) */
const DEFAULT_IN_FLIGHT_TTL_MS = 30000;

/** Maximum number of in-flight requests */
const MAX_IN_FLIGHT_REQUESTS = 1000;

/** High watermark threshold for alerting (80% of max) */
const IN_FLIGHT_ALERT_THRESHOLD = 0.8;

/** Cleanup interval for stale in-flight requests (10 seconds) */
const IN_FLIGHT_CLEANUP_INTERVAL_MS = 10000;

/** Maximum time an in-flight request can exist (5 minutes - safety limit) */
const MAX_IN_FLIGHT_AGE_MS = 300000;

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface MultiTierCacheOptions {
  /** L1 cache (memory) max size */
  l1MaxSize?: number;
  /** L1 cache TTL in milliseconds */
  l1TtlMs?: number;
  /** L2 cache (Redis) TTL in seconds */
  l2TtlSeconds?: number;
  /** Redis key prefix */
  keyPrefix?: string;
  /** Enable stampede protection */
  stampedeProtection?: boolean;
  /** Max concurrent requests for same key */
  maxConcurrentRequests?: number;
  /** In-flight request TTL in milliseconds */
  inFlightTtlMs?: number;
  /** Enable in-flight request monitoring */
  enableInFlightMonitoring?: boolean;
}

export interface CacheStats {
  l1Hits: number;
  l1Misses: number;
  l2Hits: number;
  l2Misses: number;
  totalRequests: number;
  l1HitRate: number;
  l2HitRate: number;
  overallHitRate: number;
  inFlightRequests: number;
  inFlightCleaned: number;
  inFlightTimeouts: number;
}

export interface CacheEntry<T> {
  value: T;
  timestamp: number;
  etag?: string;
  tags?: string[];
}

/**
 * In-flight request entry with metadata for TTL tracking
 */
interface InFlightEntry<T> {
  promise: Promise<T>;
  createdAt: number;
  key: string;
  timeoutId?: NodeJS.Timeout;
}

// ============================================================================
// Logger
// ============================================================================

const logger = getLogger('MultiTierCache');

// ============================================================================
// Multi-Tier Cache Class
// ============================================================================

export class MultiTierCache {
  private l1Cache: LRUCache<string, CacheEntry<unknown>>;
  private redis: Redis | null = null;
  private inFlightRequests = new Map<string, InFlightEntry<unknown>>();
  private stats = {
    l1Hits: 0,
    l1Misses: 0,
    l2Hits: 0,
    l2Misses: 0,
    totalRequests: 0,
  };
  private inFlightCleaned = 0;
  private inFlightTimeouts = 0;
  private cleanupInterval: NodeJS.Timeout | undefined;

  private readonly options: Required<MultiTierCacheOptions>;

  constructor(options: MultiTierCacheOptions = {}) {
    this.options = {
      l1MaxSize: options.l1MaxSize ?? 1000,
      l1TtlMs: options.l1TtlMs ?? 60000, // 1 minute default
      l2TtlSeconds: options.l2TtlSeconds ?? 300, // 5 minutes default
      keyPrefix: options.keyPrefix ?? 'cache:',
      stampedeProtection: options.stampedeProtection ?? true,
      maxConcurrentRequests: options.maxConcurrentRequests ?? 50,
      inFlightTtlMs: options.inFlightTtlMs ?? DEFAULT_IN_FLIGHT_TTL_MS,
      enableInFlightMonitoring: options.enableInFlightMonitoring ?? true,
    };

    // Initialize L1 cache
    this.l1Cache = new LRUCache({
      max: this.options.l1MaxSize,
      ttl: this.options.l1TtlMs,
      updateAgeOnGet: true,
      updateAgeOnHas: true,
    });

    // Start cleanup interval for in-flight requests
    this.startInFlightCleanup();
  }

  /**
   * Start periodic cleanup of stale in-flight requests
   * Memory leak fix: Automatic cleanup of hung requests
   */
  private startInFlightCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupStaleInFlightRequests();
    }, IN_FLIGHT_CLEANUP_INTERVAL_MS);
    
    // Ensure interval doesn't prevent process exit
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  /**
   * Stop the cleanup interval
   */
  stopInFlightCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
    
    // Clear all pending timeouts
    for (const entry of this.inFlightRequests.values()) {
      if (entry.timeoutId) {
        clearTimeout(entry.timeoutId);
      }
    }
    this.inFlightRequests.clear();
  }

  /**
   * Clean up stale in-flight requests
   * Memory leak fix: Remove requests that have exceeded max age
   */
  private cleanupStaleInFlightRequests(): void {
    const now = Date.now();
    let cleaned = 0;

    // P1-FIX: Use Math.min so the tighter threshold governs regardless of which
    // limit the caller configured a higher value for (e.g. inFlightTtlMs > MAX).
    const evictAfterMs = Math.min(this.options.inFlightTtlMs, MAX_IN_FLIGHT_AGE_MS);

    for (const [key, entry] of this.inFlightRequests) {
      const age = now - entry.createdAt;

      if (age > evictAfterMs) {
        if (entry.timeoutId) {
          clearTimeout(entry.timeoutId);
        }
        this.inFlightRequests.delete(key);
        cleaned++;
        logger.warn(`Cleaned stale in-flight request: ${key} (age: ${age}ms)`);
      }
    }

    if (cleaned > 0) {
      this.inFlightCleaned += cleaned;
      // P1-FIX: Downgrade to warn — routine cleanup is not an error condition.
      logger.warn(`Cleaned ${cleaned} stale in-flight requests. Total cleaned: ${this.inFlightCleaned}`);
    }

    // Check if approaching limit
    const utilization = this.inFlightRequests.size / MAX_IN_FLIGHT_REQUESTS;
    if (utilization >= IN_FLIGHT_ALERT_THRESHOLD) {
      // P1-FIX: Downgrade to warn — a high-watermark alert is not an error.
      logger.warn('In-flight requests approaching limit', {
        current: this.inFlightRequests.size,
        max: MAX_IN_FLIGHT_REQUESTS,
        utilization: `${(utilization * 100).toFixed(1)}%`,
      });
    }
  }

  /**
   * Initialize Redis connection
   * Call this before using L2 cache
   */
  async initializeRedis(redisUrl: string): Promise<void> {
    const client = new Redis(redisUrl, {
      retryStrategy: (times: number) => Math.min(times * 50, 2000),
      maxRetriesPerRequest: 3,
    });

    client.on('error', (err: Error) => {
      logger.error('Redis error', err);
    });

    // P0-FIX: Test connection BEFORE assigning to this.redis.
    // Previously this.redis was set first: if ping() threw, the field was left
    // pointing to a broken/orphaned connection that subsequent L2 operations
    // would silently attempt to use, causing confusing errors.
    try {
      await client.ping();
    } catch (err) {
      // Disconnect cleanly to avoid leaking the TCP socket.
      client.disconnect();
      throw err;
    }

    this.redis = client;
  }

  /** P2-10 FIX: Dangerous key segments that enable prototype pollution */
  private static readonly POISONED_KEY_SEGMENTS = ['__proto__', 'constructor', 'prototype'];

  /**
   * P2-10 FIX: Validate that a cache key does not contain prototype pollution vectors.
   * Throws if the key includes __proto__, constructor, or prototype segments.
   */
  private static validateKey(key: string): void {
    for (const segment of MultiTierCache.POISONED_KEY_SEGMENTS) {
      if (key.includes(segment)) {
        throw new Error(`Cache key contains forbidden segment "${segment}": ${key}`);
      }
    }
  }

  /**
   * Build full cache key with prefix
   */
  private buildKey(key: string): string {
    MultiTierCache.validateKey(key);
    return `${this.options.keyPrefix}${key}`;
  }

  /**
   * Get value from cache (L1 -> L2 -> Factory)
   * P2 OPTIMIZATION: Implements cache-aside pattern
   */
  async get<T>(key: string, factory?: () => Promise<T>, options?: {
    l1TtlMs?: number;
    l2TtlSeconds?: number;
    tags?: string[];
  }): Promise<T | undefined> {
    this.stats.totalRequests++;
    const fullKey = this.buildKey(key);

    // Try L1 cache first
    const l1Entry = this.l1Cache.get(fullKey) as CacheEntry<T> | undefined;
    if (l1Entry) {
      this.stats.l1Hits++;
      return l1Entry.value;
    }
    this.stats.l1Misses++;

    // Try L2 cache (Redis)
    if (this.redis) {
      try {
        const l2Value = await this.redis.get(fullKey);
        if (l2Value) {
          // P2-7 FIX: Wrap JSON.parse in try/catch to handle corrupted Redis data
          let parsed: CacheEntry<T>;
          try {
            // P0-FIX: Use bigint reviver so bigint values round-trip through Redis
            // correctly. Without this, bigints serialised with the replacer below
            // would be returned as plain objects { __bigint: "..." } instead of
            // the original bigint, silently corrupting consumer data.
            parsed = JSON.parse(l2Value, (_key, value: unknown) => {
              if (
                value !== null &&
                typeof value === 'object' &&
                '__bigint' in value &&
                typeof (value as Record<string, unknown>)['__bigint'] === 'string'
              ) {
                return BigInt((value as Record<string, string>)['__bigint']);
              }
              return value;
            }) as CacheEntry<T>;
          } catch (parseError) {
            logger.warn('L2 cache contains corrupted data, treating as miss', {
              key: fullKey,
              error: parseError instanceof Error ? parseError.message : String(parseError),
            });
            // Delete corrupted entry
            await this.redis.del(fullKey).catch((err: unknown) => {
              logger.warn('Failed to delete corrupted L2 cache entry', {
                key: fullKey,
                error: err instanceof Error ? err.message : String(err),
              });
            });
            this.stats.l2Misses++;
            if (factory) {
              return this.set(key, await factory(), options);
            }
            return undefined;
          }

          this.stats.l2Hits++;
          // Promote to L1
          this.l1Cache.set(fullKey, parsed);
          return parsed.value;
        }
      } catch (error) {
        logger.error('L2 read error', error instanceof Error ? error : new Error(String(error)));
      }
    }
    this.stats.l2Misses++;

    // Execute factory if provided
    if (factory) {
      return this.set(key, await factory(), options);
    }

    return undefined;
  }

  /**
   * Set value in both cache tiers
   * P2 OPTIMIZATION: Write-through pattern for consistency
   */
  async set<T>(
    key: string,
    value: T,
    options?: {
      l1TtlMs?: number;
      l2TtlSeconds?: number;
      tags?: string[];
      etag?: string;
    }
  ): Promise<T> {
    const fullKey = this.buildKey(key);
    const entry: CacheEntry<T> = {
      value,
      timestamp: Date.now(),
      ...(options?.etag !== undefined && { etag: options.etag }),
      ...(options?.tags !== undefined && { tags: options.tags }),
    };

    // Write to L1
    this.l1Cache.set(fullKey, entry as CacheEntry<unknown>, {
      ttl: options?.l1TtlMs ?? this.options.l1TtlMs,
    });

    // Write to L2 (Redis)
    if (this.redis) {
      try {
        // P0-FIX: Use a bigint-safe replacer. JSON.stringify throws a TypeError
      // when the value graph contains a bigint (e.g. storage usage returned as
      // bigint from getStorageUsed). The replacer serialises bigints as
      // { __bigint: "<decimal string>" } which the reviver in get() restores.
      const serialized = JSON.stringify(entry, (_key, value: unknown) =>
        typeof value === 'bigint' ? { __bigint: value.toString() } : value
      );
        const ttlSeconds = options?.l2TtlSeconds ?? this.options.l2TtlSeconds;
        await this.redis.setex(fullKey, ttlSeconds, serialized);
      } catch (error) {
        logger.error('L2 write error', error instanceof Error ? error : new Error(String(error)));
      }
    }

    return value;
  }

  /**
   * Get with stampede protection
   * P2 OPTIMIZATION: Prevents cache stampede
   * MEMORY LEAK FIX: Added TTL-based cleanup and max limits
   */
  async getOrCompute<T>(
    key: string,
    factory: () => Promise<T>,
    options?: {
      l1TtlMs?: number;
      l2TtlSeconds?: number;
      tags?: string[];
      timeoutMs?: number;
      signal?: AbortSignal;
    }
  ): Promise<T> {
    if (options?.signal?.aborted) {
      throw new Error('Cache computation aborted');
    }

    if (!this.options.stampedeProtection) {
      const cached = await this.get<T>(key);
      if (cached !== undefined) return cached;
      return this.set(key, await factory(), options);
    }

    const fullKey = this.buildKey(key);

    // Check cache first
    const cached = await this.get<T>(key);
    if (cached !== undefined) return cached;

    // Check for in-flight request
    const inFlight = this.inFlightRequests.get(fullKey);
    if (inFlight) {
      // Memory leak fix: Check if request is too old
      const age = Date.now() - inFlight.createdAt;
      if (age > this.options.inFlightTtlMs) {
        // Request is stale - remove it and continue with new computation
        logger.warn(`Stale in-flight request detected: ${key} (age: ${age}ms)`);
        if (inFlight.timeoutId) {
          clearTimeout(inFlight.timeoutId);
        }
        this.inFlightRequests.delete(fullKey);
      } else {
        // Return existing promise
        return inFlight.promise as Promise<T>;
      }
    }

    // Memory leak fix: Check if we're at the limit
    if (this.inFlightRequests.size >= MAX_IN_FLIGHT_REQUESTS) {
      // Try to clean up one stale entry
      this.cleanupOneStaleEntry();
      
      if (this.inFlightRequests.size >= MAX_IN_FLIGHT_REQUESTS) {
        throw new Error(`In-flight request limit exceeded (${MAX_IN_FLIGHT_REQUESTS}). Try again later.`);
      }
    }

    // Create new computation
    const computation = this.computeAndCache(key, factory, options);
    const entry: InFlightEntry<T> = {
      promise: computation,
      createdAt: Date.now(),
      key: fullKey,
    };
    
    // Set up automatic cleanup timeout
    const timeoutMs = options?.timeoutMs ?? this.options.inFlightTtlMs;
    entry.timeoutId = setTimeout(() => {
      const current = this.inFlightRequests.get(fullKey);
      // P1-FIX: Only evict if the map still holds *this* entry — a replacement
      // computation may have been registered after this timeout was scheduled.
      if (current?.promise === computation) {
        this.inFlightRequests.delete(fullKey);
        this.inFlightTimeouts++;
        // P1-FIX: Downgrade to warn — a timeout is an operational concern, not
        // an error (the caller receives a rejection, not a silent failure).
        logger.warn(`In-flight request timed out: ${key}`);
      }
    }, timeoutMs);

    this.inFlightRequests.set(fullKey, entry as InFlightEntry<unknown>);

    try {
      return await computation;
    } finally {
      // P1-FIX: Only clean up the entry if it still belongs to *this*
      // computation.  If the timeout fired first and deleted the entry, a
      // subsequent getOrCompute call may have already inserted a new entry for
      // the same key; deleting it unconditionally would orphan that computation
      // and cause the next caller to start yet another redundant computation.
      const existing = this.inFlightRequests.get(fullKey);
      if (existing?.promise === computation) {
        if (existing.timeoutId) {
          clearTimeout(existing.timeoutId);
        }
        this.inFlightRequests.delete(fullKey);
      }
    }
  }

  /**
   * Clean up one stale in-flight entry
   * Memory leak fix: Helper to make room for new requests
   */
  private cleanupOneStaleEntry(): void {
    const now = Date.now();
    
    for (const [key, entry] of this.inFlightRequests) {
      const age = now - entry.createdAt;
      if (age > this.options.inFlightTtlMs) {
        if (entry.timeoutId) {
          clearTimeout(entry.timeoutId);
        }
        this.inFlightRequests.delete(key);
        this.inFlightCleaned++;
        return;
      }
    }
  }

  private async computeAndCache<T>(
    key: string,
    factory: () => Promise<T>,
    options?: {
      l1TtlMs?: number;
      l2TtlSeconds?: number;
      tags?: string[];
      timeoutMs?: number;
      signal?: AbortSignal;
    }
  ): Promise<T> {
    if (options?.signal?.aborted) {
      throw new Error('Cache computation aborted');
    }

    const timeoutMs = options?.timeoutMs ?? this.options.inFlightTtlMs;

    // P1-6 FIX: Track timeout timer so it can be cleared when factory resolves first
    let timeoutId: NodeJS.Timeout | undefined;
    // P1-5 FIX: Track abort listener so it can be removed when factory resolves first
    let abortHandler: (() => void) | undefined;
    const signal = options?.signal;
    try {
      const racers: Promise<T>[] = [
        factory(),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error(`Cache computation timeout for key: ${key}`)), timeoutMs);
        }),
      ];

      // Add abort signal as a racer if provided
      if (signal) {
        racers.push(new Promise<never>((_, reject) => {
          if (signal.aborted) {
            reject(new Error('Cache computation aborted'));
            return;
          }
          abortHandler = () => {
            reject(new Error('Cache computation aborted'));
          };
          signal.addEventListener('abort', abortHandler, { once: true });
        }));
      }

      const value = await Promise.race(racers);

      await this.set(key, value, options);
      return value;
    } finally {
      // P1-6 FIX: Always clear timeout to prevent timer leak
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
      // P1-5 FIX: Always remove abort listener to prevent listener leak
      if (signal && abortHandler) {
        signal.removeEventListener('abort', abortHandler);
      }
    }
  }

  /**
   * Delete from both cache tiers
   */
  async delete(key: string): Promise<void> {
    const fullKey = this.buildKey(key);
    this.l1Cache.delete(fullKey);
    
    if (this.redis) {
      try {
        await this.redis.del(fullKey);
      } catch (error) {
        logger.error('L2 delete error', error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  /**
   * Delete multiple keys
   * FIX(P2): Previously called this.delete(key) per key, which issued one Redis
   * DEL command per key over N separate round-trips. Now deletes all keys from
   * L1 in a single loop and issues a single Redis DEL with all full keys per
   * batch — reducing N Redis round-trips to ceil(N/BATCH_SIZE) round-trips.
   */
  async deleteMany(keys: string[]): Promise<void> {
    if (keys.length === 0) return;

    // Build full keys and evict from L1 in one pass
    const fullKeys: string[] = [];
    for (const key of keys) {
      const fullKey = this.buildKey(key);
      this.l1Cache.delete(fullKey);
      fullKeys.push(fullKey);
    }

    if (!this.redis) return;

    // Batch delete from L2 with a single DEL command per batch
    const BATCH_SIZE = 1000; // Redis DEL accepts multiple keys in one command
    try {
      for (let i = 0; i < fullKeys.length; i += BATCH_SIZE) {
        const batch = fullKeys.slice(i, i + BATCH_SIZE);
        await this.redis.del(...batch);
      }
    } catch (error) {
      logger.error('L2 deleteMany error', error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Clear L1 cache
   */
  clearL1(): void {
    this.l1Cache.clear();
  }

  /**
   * P2-9 FIX: Shared SCAN + batch delete helper to remove duplication
   * between clearL2() and clearAll().
   */
  private async scanAndDelete(pattern: string): Promise<void> {
    if (!this.redis) return;

    const SCAN_BATCH_SIZE = 100;
    const DELETE_BATCH_SIZE = 1000;

    let cursor = '0';
    let totalDeleted = 0;
    const keysToDelete: string[] = [];

    do {
      const result = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', SCAN_BATCH_SIZE);
      cursor = result[0];
      const keys = result[1];

      if (keys.length > 0) {
        keysToDelete.push(...keys);

        if (keysToDelete.length >= DELETE_BATCH_SIZE) {
          const batch = keysToDelete.splice(0, DELETE_BATCH_SIZE);
          await this.redis.del(...batch);
          totalDeleted += batch.length;
        }
      }
    } while (cursor !== '0');

    if (keysToDelete.length > 0) {
      await this.redis.del(...keysToDelete);
      totalDeleted += keysToDelete.length;
    }

    if (totalDeleted > 0) {
      logger.info(`Cleared ${totalDeleted} keys from L2 cache`);
    }
  }

  /**
   * Clear L2 cache (Redis) only, leaving L1 intact
   */
  async clearL2(): Promise<void> {
    if (!this.redis) return;

    try {
      await this.scanAndDelete(`${this.options.keyPrefix}*`);
    } catch (error) {
      logger.error('L2 clear error', error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Clear all caches
   * P1-FIX: Uses SCAN + batch delete instead of KEYS to avoid blocking Redis
   */
  async clearAll(): Promise<void> {
    this.clearL1();

    if (this.redis) {
      try {
        await this.scanAndDelete(`${this.options.keyPrefix}*`);
      } catch (error) {
        logger.error('L2 clear error', error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  /**
   * Get cache statistics
   * Memory leak fix: Include in-flight request metrics
   */
  getStats(): CacheStats {
    const total = this.stats.totalRequests;
    const l1HitRate = total > 0 ? this.stats.l1Hits / total : 0;
    const l2HitRate = total > 0 ? this.stats.l2Hits / total : 0;
    const overallHitRate = total > 0 ? (this.stats.l1Hits + this.stats.l2Hits) / total : 0;

    return {
      l1Hits: this.stats.l1Hits,
      l1Misses: this.stats.l1Misses,
      l2Hits: this.stats.l2Hits,
      l2Misses: this.stats.l2Misses,
      totalRequests: total,
      l1HitRate: Math.round(l1HitRate * 100) / 100,
      l2HitRate: Math.round(l2HitRate * 100) / 100,
      overallHitRate: Math.round(overallHitRate * 100) / 100,
      inFlightRequests: this.inFlightRequests.size,
      inFlightCleaned: this.inFlightCleaned,
      inFlightTimeouts: this.inFlightTimeouts,
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      l1Hits: 0,
      l1Misses: 0,
      l2Hits: 0,
      l2Misses: 0,
      totalRequests: 0,
    };
    this.inFlightCleaned = 0;
    this.inFlightTimeouts = 0;
  }

  /**
   * Get all L1 cache keys (for pattern-based invalidation)
   */
  getL1Keys(): string[] {
    return [...this.l1Cache.keys()];
  }

  /**
   * Get cache size
   */
  getL1Size(): number {
    return this.l1Cache.size;
  }

  /**
   * Check if key exists in cache
   */
  async has(key: string): Promise<boolean> {
    const fullKey = this.buildKey(key);
    
    if (this.l1Cache.has(fullKey)) return true;
    
    if (this.redis) {
      try {
        const exists = await this.redis.exists(fullKey);
        return exists === 1;
      } catch {
        return false;
      }
    }
    
    return false;
  }

  /**
   * Get in-flight request count
   * Memory leak fix: Expose for monitoring
   */
  getInFlightCount(): number {
    return this.inFlightRequests.size;
  }

  /**
   * Close Redis connection and cleanup
   */
  async close(): Promise<void> {
    this.stopInFlightCleanup();
    
    if (this.redis) {
      await this.redis.quit();
      this.redis = null;
    }
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let globalCache: MultiTierCache | null = null;

export function getGlobalCache(options?: MultiTierCacheOptions): MultiTierCache {
  if (!globalCache) {
    globalCache = new MultiTierCache(options);
  } else if (options && Object.keys(options).length > 0) {
    // P1-FIX: Warn callers whose options are silently ignored after the first
    // call.  Previously the singleton was returned without any indication that
    // the configuration was discarded, leading to hard-to-diagnose behavioural
    // differences between the first and all subsequent callers.
    logger.warn(
      'getGlobalCache: options ignored — global cache already initialised. ' +
      'Call resetGlobalCache() first if you need a reconfigured instance.',
      { ignoredOptions: Object.keys(options) }
    );
  }
  return globalCache;
}

export async function resetGlobalCache(): Promise<void> {
  if (globalCache) {
    // P1-28 FIX: Call close() to properly shut down the Redis connection,
    // not just stopInFlightCleanup() which leaks the Redis connection.
    await globalCache.close();
  }
  globalCache = null;
}

// ============================================================================
// Decorator for caching method results
// ============================================================================

/**
 * P2-31 FIX: Sanitize a value for use in a cache key.
 * Strips prototype-pollution vectors and, when the result exceeds the maximum
 * safe key length, replaces the excess with a SHA-256 hash to avoid both
 * truncation-based collisions and excessively long Redis keys.
 *
 * P2-FIX: Accepts unknown so callers can pass raw argument arrays without
 * a separate JSON.stringify step that would throw on bigint values.
 */
function sanitizeCacheKeyPart(raw: string): string {
  const MAX_KEY_LENGTH = 512;
  const sanitized = raw.replace(/__proto__|constructor|prototype/g, '_blocked_');
  if (sanitized.length <= MAX_KEY_LENGTH) {
    return sanitized;
  }
  // P2-FIX: Truncation causes hash collisions when two keys share a long
  // common prefix (they map to the same truncated string).  Instead, keep a
  // fixed-length prefix for human readability and append a SHA-256 digest of
  // the full sanitized value so the key remains unique.
  const PREFIX_LENGTH = 64;
  const digest = createHash('sha256').update(sanitized).digest('hex');
  return `${sanitized.slice(0, PREFIX_LENGTH)}__sha256_${digest}`;
}

/**
 * Bigint-safe JSON.stringify for use in cache key construction.
 * Converts bigint values to their decimal string representation instead of
 * throwing a TypeError.
 */
function safeJsonStringify(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    typeof v === 'bigint' ? v.toString() : v
  );
}

export function Cacheable(options?: {
  key?: string;
  ttlMs?: number;
  tags?: string[];
}) {
  return function (
    target: object,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: unknown[]) {
      // P2-12 FIX: Resolve cache at call time, not decoration time.
      // If resetGlobalCache() is called (e.g., in tests), a stale reference
      // captured at decoration time would point to a destroyed cache.
      const cache = getGlobalCache();

      // P2-31 FIX: Sanitize the serialised args portion of the cache key.
      // P2-FIX: Use safeJsonStringify to avoid TypeError on bigint arguments.
      const argsPart = sanitizeCacheKeyPart(safeJsonStringify(args));
      const cacheKey = options?.key
        ? `${options.key}:${argsPart}`
        : `${target.constructor.name}:${propertyKey}:${argsPart}`;

      const cacheOptions: { l1TtlMs?: number; l2TtlSeconds?: number; tags?: string[] } = {};
      if (options?.ttlMs !== undefined) {
        cacheOptions.l1TtlMs = options.ttlMs;
        cacheOptions.l2TtlSeconds = Math.floor(options.ttlMs / 1000);
      }
      if (options?.tags !== undefined) {
        cacheOptions.tags = options.tags;
      }

      return cache.getOrCompute(
        cacheKey,
        () => originalMethod.apply(this, args),
        cacheOptions
      );
    };

    return descriptor;
  };
}
