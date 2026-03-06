import { logger } from "@repo/logs";
import type { NextRequest } from "next/server";

const MAX_BODY_BYTES = 8_192;

const ipBuckets = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 10;
const WINDOW_MS = 60_000;

function isRateLimited(ip: string): boolean {
	const now = Date.now();
	const bucket = ipBuckets.get(ip);
	if (!bucket || now >= bucket.resetAt) {
		ipBuckets.set(ip, { count: 1, resetAt: now + WINDOW_MS });
		return false;
	}
	bucket.count++;
	return bucket.count > RATE_LIMIT;
}

const globalRef = globalThis as typeof globalThis & {
	__clientErrorCleanupInterval?: ReturnType<typeof setInterval>;
};
if (!globalRef.__clientErrorCleanupInterval) {
	globalRef.__clientErrorCleanupInterval = setInterval(() => {
		const now = Date.now();
		for (const [key, bucket] of ipBuckets) {
			if (now >= bucket.resetAt) {
				ipBuckets.delete(key);
			}
		}
	}, 60_000);
}

export async function POST(request: NextRequest) {
	const ip =
		request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
		"unknown";
	if (isRateLimited(ip)) {
		return new Response(null, { status: 429 });
	}

	try {
		const raw = await request.text();
		if (raw.length > MAX_BODY_BYTES) {
			return new Response(null, { status: 413 });
		}
		const body = JSON.parse(raw);
		const message =
			typeof body.message === "string"
				? body.message.slice(0, 500)
				: "Unknown";
		const stack =
			typeof body.stack === "string"
				? body.stack.slice(0, 2000)
				: undefined;
		const componentStack =
			typeof body.componentStack === "string"
				? body.componentStack.slice(0, 2000)
				: undefined;

		logger.error("[client-error]", { message, stack, componentStack });
	} catch {
		// Malformed request — ignore
	}

	return new Response(null, { status: 204 });
}
