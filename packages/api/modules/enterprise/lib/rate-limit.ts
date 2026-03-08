/**
 * Enterprise-grade in-process rate limiter.
 *
 * Uses a sliding window algorithm backed by an in-memory Map.
 * For production multi-instance deployments, replace the Map with a
 * Redis-backed store (see infrastructure/redis-cache.ts for the Redis client).
 *
 * This is intentionally lightweight — the Redis-backed version in
 * infrastructure/rate-limit-redis.ts is the production path.
 */

interface RateLimitWindow {
	count: number;
	resetAt: number;
}

const MAX_WINDOWS = 10_000;
const windows = new Map<string, RateLimitWindow>();

function evictOldestWindows() {
	while (windows.size >= MAX_WINDOWS) {
		const oldestKey = windows.keys().next().value;
		if (!oldestKey) {
			break;
		}
		windows.delete(oldestKey);
	}
}

/**
 * Checks and increments the rate limit for a given key.
 *
 * @param key - Unique identifier (e.g., `user:{userId}:scim-token-create`).
 * @param limit - Maximum number of requests allowed per window.
 * @param windowMs - Window duration in milliseconds.
 * @returns `{ allowed: boolean; remaining: number; resetAt: number }`
 */
export function checkRateLimit(
	key: string,
	limit: number,
	windowMs: number,
): { allowed: boolean; remaining: number; resetAt: number } {
	const now = Date.now();
	const existing = windows.get(key);

	if (!existing || now >= existing.resetAt) {
		// Start a new window.
		evictOldestWindows();
		windows.set(key, { count: 1, resetAt: now + windowMs });
		return { allowed: true, remaining: limit - 1, resetAt: now + windowMs };
	}

	if (existing.count >= limit) {
		return { allowed: false, remaining: 0, resetAt: existing.resetAt };
	}

	existing.count += 1;
	return {
		allowed: true,
		remaining: limit - existing.count,
		resetAt: existing.resetAt,
	};
}

const globalRef = globalThis as typeof globalThis & {
	__rateLimitCleanupInterval?: ReturnType<typeof setInterval>;
};
if (!globalRef.__rateLimitCleanupInterval) {
	globalRef.__rateLimitCleanupInterval = setInterval(() => {
		const now = Date.now();
		for (const [key, window] of windows) {
			if (now >= window.resetAt) {
				windows.delete(key);
			}
		}
	}, 60_000);
}
