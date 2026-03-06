/**
 * SmartBeak Phase 3A — Redis-backed sliding window rate limiter.
 *
 * Uses a Lua script for atomic increment + expiry, ensuring correctness
 * across multiple API server instances. Falls back to the in-memory
 * rate limiter when Redis is unavailable.
 *
 * Limits are defined per-tier to allow enterprise customers higher
 * throughput than free/growth users.
 */

import { ORPCError } from "@orpc/server";
import { logger } from "@repo/logs";
import { checkRateLimit } from "../modules/enterprise/lib/rate-limit";

// ─── Tier-based rate limit configurations ─────────────────────────────────────

interface RateLimitConfig {
	/** Maximum requests per window. */
	limit: number;
	/** Window duration in seconds. */
	windowSeconds: number;
}

export const RATE_LIMITS: Record<string, Record<string, RateLimitConfig>> = {
	starter: {
		api: { limit: 1_000, windowSeconds: 86400 },
		ai: { limit: 100, windowSeconds: 86400 },
		export: { limit: 5, windowSeconds: 3600 },
		scim: { limit: 0, windowSeconds: 3600 },
	},
	growth: {
		api: { limit: 10_000, windowSeconds: 86400 },
		ai: { limit: 1_000, windowSeconds: 86400 },
		export: { limit: 50, windowSeconds: 3600 },
		scim: { limit: 0, windowSeconds: 3600 },
	},
	enterprise: {
		api: { limit: 1_000_000, windowSeconds: 86400 },
		ai: { limit: 1_000_000, windowSeconds: 86400 },
		export: { limit: 1_000, windowSeconds: 3600 },
		scim: { limit: 500, windowSeconds: 3600 },
	},
};

// ─── Redis Lua script for atomic sliding window ───────────────────────────────

const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local current = redis.call('INCR', key)
if current == 1 then
  redis.call('EXPIRE', key, window)
end
if current > limit then
  return {0, current, redis.call('TTL', key)}
end
return {1, current, redis.call('TTL', key)}
`;

// ─── Rate limit check ─────────────────────────────────────────────────────────

/**
 * Checks the rate limit for a given key and config.
 * Throws ORPC TOO_MANY_REQUESTS if the limit is exceeded.
 *
 * @param key - Unique identifier (e.g., `org:{orgId}:api`).
 * @param config - Rate limit configuration.
 * @param redisClient - Optional Redis client. Falls back to in-memory if null.
 */
export async function enforceRateLimit(
	key: string,
	config: RateLimitConfig,
	redisClient?: {
		eval(
			script: string,
			numkeys: number,
			key: string,
			...args: string[]
		): Promise<[number, number, number]>;
	} | null,
): Promise<{ remaining: number; resetIn: number }> {
	if (config.limit === 0) {
		throw new ORPCError("FORBIDDEN", {
			message: "This feature is not available on your current plan.",
		});
	}

	if (redisClient) {
		try {
			const [allowed, current, ttl] = await redisClient.eval(
				SLIDING_WINDOW_LUA,
				1,
				key,
				String(config.limit),
				String(config.windowSeconds),
			);

			if (!allowed) {
				throw new ORPCError("TOO_MANY_REQUESTS", {
					message: `Rate limit exceeded. Please retry after ${ttl} seconds.`,
				});
			}

			return {
				remaining: config.limit - current,
				resetIn: ttl,
			};
		} catch (err) {
			if (err instanceof ORPCError) {
				throw err;
			}
			// Redis error — fall through to in-memory fallback.
			logger.warn(
				"[RateLimit] Redis eval failed, using in-memory fallback:",
				err,
			);
		}
	}

	// In-memory fallback.
	const result = checkRateLimit(
		key,
		config.limit,
		config.windowSeconds * 1000,
	);
	if (!result.allowed) {
		throw new ORPCError("TOO_MANY_REQUESTS", {
			message: `Rate limit exceeded. Please retry after ${Math.ceil((result.resetAt - Date.now()) / 1000)} seconds.`,
		});
	}

	return {
		remaining: result.remaining,
		resetIn: Math.ceil((result.resetAt - Date.now()) / 1000),
	};
}

/**
 * Returns the rate limit configuration for a given tier and operation.
 * Falls back to the "starter" tier if the tier is not recognized.
 */
export function getRateLimitConfig(
	tierName: string,
	operation: string,
): RateLimitConfig {
	const tierConfig =
		RATE_LIMITS[tierName.toLowerCase()] ?? RATE_LIMITS.starter;
	return tierConfig[operation] ?? { limit: 100, windowSeconds: 3600 };
}
