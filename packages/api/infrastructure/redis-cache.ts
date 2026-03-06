/**
 * SmartBeak Phase 3A — Redis Cache Client
 *
 * Provides a unified caching interface backed by Redis when available,
 * with a transparent in-memory fallback for development or when Redis
 * is not configured. This ensures zero-downtime deployments and local
 * development without requiring a Redis instance.
 *
 * Usage:
 *   import { cache } from "@/infrastructure/redis-cache";
 *   const value = await cache.get<MyType>("key");
 *   await cache.set("key", value, 60); // TTL in seconds
 *   await cache.del("key");
 *   await cache.invalidatePrefix("org:slug:"); // Invalidate all keys with prefix
 */

import { logger } from "@repo/logs";

// ─── In-memory fallback store ─────────────────────────────────────────────────

interface MemoryEntry {
  value: string;
  expiresAt: number;
}

const memoryStore = new Map<string, MemoryEntry>();

function memGet(key: string): string | null {
  const entry = memoryStore.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memoryStore.delete(key);
    return null;
  }
  return entry.value;
}

function memSet(key: string, value: string, ttlSeconds: number): void {
  memoryStore.set(key, {
    value,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

function memDel(key: string): void {
  memoryStore.delete(key);
}

function memInvalidatePrefix(prefix: string): void {
  for (const key of memoryStore.keys()) {
    if (key.startsWith(prefix)) {
      memoryStore.delete(key);
    }
  }
}

// Periodically clean up expired entries.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of memoryStore) {
    if (now > entry.expiresAt) {
      memoryStore.delete(key);
    }
  }
}, 30_000);

// ─── Redis client (lazy-loaded) ───────────────────────────────────────────────

type RedisClient = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { EX?: number }): Promise<unknown>;
  del(key: string | string[]): Promise<unknown>;
  keys(pattern: string): Promise<string[]>;
  ping(): Promise<string>;
};

let redisClient: RedisClient | null = null;
let redisAvailable = false;

async function getRedisClient(): Promise<RedisClient | null> {
  if (redisClient !== null) return redisAvailable ? redisClient : null;

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    redisAvailable = false;
    return null;
  }

  try {
    // Dynamic import to avoid hard dependency — Redis is optional.
    // @ts-expect-error redis is an optional peer dependency; missing types are expected
    const { createClient } = await import("redis");
    const client = createClient({ url: redisUrl });
    client.on("error", (err: Error) => {
      logger.warn("[SmartBeak Cache] Redis error, falling back to memory:", err.message);
      redisAvailable = false;
    });
    await client.connect();
    await client.ping();
    redisClient = client as unknown as RedisClient;
    redisAvailable = true;
    logger.info("[SmartBeak Cache] Redis connected successfully.");
    return redisClient;
  } catch (err) {
    logger.warn(
      "[SmartBeak Cache] Redis unavailable, using in-memory fallback:",
      (err as Error).message,
    );
    redisAvailable = false;
    return null;
  }
}

// ─── Public cache interface ───────────────────────────────────────────────────

/**
 * Default TTL values for common cache categories (in seconds).
 */
export const CacheTTL = {
  /** Short-lived data: active sessions, rate limit windows. */
  SHORT: 60,
  /** Medium-lived data: org slugs, subscriptions, feature flags. */
  MEDIUM: 300,
  /** Long-lived data: billing tiers, static config. */
  LONG: 3600,
  /** Very long-lived data: rarely-changing reference data. */
  VERY_LONG: 86400,
} as const;

/**
 * Generates a deterministic cache key from a namespace and parameters.
 */
export function cacheKey(namespace: string, ...parts: string[]): string {
  return `smartbeak:${namespace}:${parts.join(":")}`;
}

export const cache = {
  /**
   * Retrieves a cached value. Returns null on cache miss or error.
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      const redis = await getRedisClient();
      const raw = redis ? await redis.get(key) : memGet(key);
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch (err) {
      logger.warn("[SmartBeak Cache] Failed to parse cached value:", (err as Error).message);
      return null;
    }
  },

  /**
   * Stores a value in the cache with a TTL in seconds.
   */
  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    try {
      const serialized = JSON.stringify(value);
      const redis = await getRedisClient();
      if (redis) {
        await redis.set(key, serialized, { EX: ttlSeconds });
      } else {
        memSet(key, serialized, ttlSeconds);
      }
    } catch {
      // Cache write failures must never block the main operation.
    }
  },

  /**
   * Deletes a specific cache key.
   */
  async del(key: string): Promise<void> {
    try {
      const redis = await getRedisClient();
      if (redis) {
        await redis.del(key);
      } else {
        memDel(key);
      }
    } catch {
      // Ignore cache deletion errors.
    }
  },

  /**
   * Invalidates all cache keys that start with the given prefix.
   * Useful for cache-busting an entire org's cached data on mutation.
   */
  async invalidatePrefix(prefix: string): Promise<void> {
    try {
      const redis = await getRedisClient();
      if (redis) {
        const keys = await redis.keys(`${prefix}*`);
        if (keys.length > 0) {
          await redis.del(keys);
        }
      } else {
        memInvalidatePrefix(prefix);
      }
    } catch {
      // Ignore cache invalidation errors.
    }
  },

  /**
   * Cache-aside helper: returns cached value if present, otherwise calls
   * `fn` to compute the value, caches it, and returns it.
   */
  async getOrSet<T>(
    key: string,
    fn: () => Promise<T>,
    ttlSeconds: number,
  ): Promise<T> {
    const cached = await cache.get<T>(key);
    if (cached !== null) return cached;
    const value = await fn();
    await cache.set(key, value, ttlSeconds);
    return value;
  },
};

// ─── Cached query wrappers ────────────────────────────────────────────────────

/**
 * Returns a cached version of `getOrganizationBySlug`.
 * Cache is invalidated when the org is updated.
 */
export async function cachedGetOrgBySlug(
  slug: string,
  fetcher: () => Promise<unknown>,
) {
  const key = cacheKey("org", "slug", slug);
  return cache.getOrSet(key, fetcher, CacheTTL.MEDIUM);
}

/**
 * Returns a cached version of `getSmartBeakOrgBySlug`.
 */
export async function cachedGetSmartBeakOrgBySlug(
  slug: string,
  fetcher: () => Promise<unknown>,
) {
  const key = cacheKey("smartbeak-org", "slug", slug);
  return cache.getOrSet(key, fetcher, CacheTTL.MEDIUM);
}

/**
 * Returns a cached version of `getSubscriptionForOrg`.
 */
export async function cachedGetSubscription(
  orgId: string,
  fetcher: () => Promise<unknown>,
) {
  const key = cacheKey("subscription", "org", orgId);
  return cache.getOrSet(key, fetcher, CacheTTL.MEDIUM);
}

/**
 * Returns a cached version of `getActiveBillingTiers`.
 * Billing tiers change rarely, so a long TTL is appropriate.
 */
export async function cachedGetBillingTiers(
  fetcher: () => Promise<unknown>,
) {
  const key = cacheKey("billing-tiers", "active");
  return cache.getOrSet(key, fetcher, CacheTTL.LONG);
}

/**
 * Returns a cached version of `getOrgTier`.
 */
export async function cachedGetOrgTier(
  orgId: string,
  fetcher: () => Promise<unknown>,
) {
  const key = cacheKey("org-tier", "org", orgId);
  return cache.getOrSet(key, fetcher, CacheTTL.MEDIUM);
}

/**
 * Invalidates all cache entries for a given organization.
 * Call this after any mutation that affects org-level data.
 */
export async function invalidateOrgCache(orgId: string, slug?: string) {
  await Promise.all([
    cache.invalidatePrefix(cacheKey("org-tier", "org", orgId)),
    cache.invalidatePrefix(cacheKey("subscription", "org", orgId)),
    slug ? cache.del(cacheKey("org", "slug", slug)) : Promise.resolve(),
    slug ? cache.del(cacheKey("smartbeak-org", "slug", slug)) : Promise.resolve(),
  ]);
}
