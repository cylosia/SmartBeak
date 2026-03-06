/**
 * SmartBeak Phase 3A — Infrastructure Scaling Exports
 *
 * Exports the Redis cache client, rate limiter, and query optimization
 * utilities for use across the API layer.
 */

export {
	buildPage,
	checkDatabaseHealth,
	createBatchLoader,
	decodeCursor,
	encodeCursor,
	timedQuery,
} from "./query-optimizer";

export {
	enforceRateLimit,
	getRateLimitConfig,
	RATE_LIMITS,
} from "./rate-limit-redis";
export {
	CacheTTL,
	cache,
	cachedGetBillingTiers,
	cachedGetOrgBySlug,
	cachedGetOrgTier,
	cachedGetSmartBeakOrgBySlug,
	cachedGetSubscription,
	cacheKey,
	invalidateOrgCache,
} from "./redis-cache";
