import { enforceRateLimit } from "../../infrastructure/rate-limit-redis";

interface RateLimitOptions {
	limit: number;
	windowMs: number;
}

const PUBLIC_RATE_LIMIT: RateLimitOptions = {
	limit: 10,
	windowMs: 60_000,
};

/**
 * oRPC middleware that enforces IP-based rate limiting on public endpoints.
 * Uses Redis when available, falling back to in-memory.
 */
export function publicRateLimitMiddleware(
	opts: RateLimitOptions = PUBLIC_RATE_LIMIT,
) {
	return async ({
		context,
		next,
	}: {
		context: { headers: Headers };
		next: () => Promise<unknown>;
	}) => {
		const ip =
			context.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
			context.headers.get("x-real-ip") ??
			"unknown";

		const key = `public:${ip}`;
		await enforceRateLimit(key, {
			limit: opts.limit,
			windowSeconds: Math.ceil(opts.windowMs / 1000),
		});

		return next();
	};
}

/**
 * oRPC middleware that enforces user-based rate limiting on protected endpoints.
 * Keyed by authenticated user ID for per-user fairness.
 */
export function protectedRateLimitMiddleware(
	opts: RateLimitOptions = { limit: 30, windowMs: 60_000 },
) {
	return async ({
		context,
		next,
	}: {
		context: { user: { id: string } };
		next: () => Promise<unknown>;
	}) => {
		const key = `user:${context.user.id}`;
		await enforceRateLimit(key, {
			limit: opts.limit,
			windowSeconds: Math.ceil(opts.windowMs / 1000),
		});

		return next();
	};
}
