/**
 * SmartBeak Phase 3A — Infrastructure Scaling Exports
 *
 * Exports the Redis cache client, rate limiter, and query optimization
 * utilities for use across the API layer.
 */

export {
  cache,
  cacheKey,
  CacheTTL,
  cachedGetBillingTiers,
  cachedGetOrgBySlug,
  cachedGetOrgTier,
  cachedGetSmartBeakOrgBySlug,
  cachedGetSubscription,
  invalidateOrgCache,
} from "./redis-cache";

export {
  enforceRateLimit,
  getRateLimitConfig,
  RATE_LIMITS,
} from "./rate-limit-redis";

export {
  buildPage,
  checkDatabaseHealth,
  createBatchLoader,
  decodeCursor,
  encodeCursor,
  timedQuery,
} from "./query-optimizer";
