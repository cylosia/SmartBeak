import { ORPCError } from "@orpc/server";
import { checkRateLimit } from "../../modules/enterprise/lib/rate-limit";

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
 * Uses the in-memory rate limiter by default (works without Redis).
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
		const result = checkRateLimit(key, opts.limit, opts.windowMs);

		if (!result.allowed) {
			throw new ORPCError("TOO_MANY_REQUESTS", {
				message: `Rate limit exceeded. Please retry after ${Math.ceil((result.resetAt - Date.now()) / 1000)} seconds.`,
			});
		}

		return next();
	};
}
