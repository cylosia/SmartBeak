/**
 * Webhook idempotency guard.
 *
 * Uses Redis SET NX EX for atomic, distributed deduplication when available.
 * Falls back to an in-memory Map when Redis is not configured, ensuring
 * correct behavior in single-instance deployments and local development.
 *
 * Each provider namespace is isolated so event IDs from different
 * providers cannot collide.
 */

import { logger } from "@repo/logs";

const EVENT_TTL_SECONDS = 86_400; // 24 hours
const KEY_PREFIX = "smartbeak:webhook:";

// ─── Redis client (lazy-loaded, same pattern as redis-cache) ────────────────

type MinimalRedisClient = {
	set(
		key: string,
		value: string,
		options?: { NX?: boolean; EX?: number },
	): Promise<string | null>;
	ping(): Promise<string>;
};

let redisClient: MinimalRedisClient | null = null;
let redisResolved = false;
let redisAvailable = false;

async function getRedisClient(): Promise<MinimalRedisClient | null> {
	if (redisResolved) {
		return redisAvailable ? redisClient : null;
	}
	redisResolved = true;

	const redisUrl = process.env.REDIS_URL;
	if (!redisUrl) {
		redisAvailable = false;
		return null;
	}

	try {
		// @ts-expect-error redis is an optional peer dependency
		const { createClient } = await import("redis");
		const client = createClient({ url: redisUrl });
		client.on("error", (err: Error) => {
			logger.warn(
				"[webhook-idempotency] Redis error, falling back to memory:",
				err.message,
			);
			redisAvailable = false;
		});
		await client.connect();
		await client.ping();
		redisClient = client as unknown as MinimalRedisClient;
		redisAvailable = true;
		logger.info("[webhook-idempotency] Redis connected for deduplication.");
		return redisClient;
	} catch (err) {
		logger.warn(
			"[webhook-idempotency] Redis unavailable, using in-memory fallback:",
			err instanceof Error ? err.message : String(err),
		);
		redisAvailable = false;
		return null;
	}
}

// ─── In-memory fallback ─────────────────────────────────────────────────────

interface ProcessedEvent {
	processedAt: number;
}

const processedEvents = new Map<string, ProcessedEvent>();

const globalRef = globalThis as typeof globalThis & {
	__webhookIdempotencyCleanup?: ReturnType<typeof setInterval>;
};
if (!globalRef.__webhookIdempotencyCleanup) {
	globalRef.__webhookIdempotencyCleanup = setInterval(() => {
		const cutoff = Date.now() - EVENT_TTL_SECONDS * 1000;
		for (const [key, entry] of processedEvents) {
			if (entry.processedAt < cutoff) {
				processedEvents.delete(key);
			}
		}
	}, 60_000);
}

/**
 * Returns `true` if this event has already been processed and should be skipped.
 * Returns `false` if the event is new and has been marked as processing.
 *
 * When Redis is available, uses `SET key NX EX ttl` for an atomic
 * check-and-set that is safe under concurrent requests and across
 * multiple server instances.
 */
export async function isWebhookDuplicate(
	provider: string,
	eventId: string,
): Promise<boolean> {
	const key = `${KEY_PREFIX}${provider}:${eventId}`;

	const redis = await getRedisClient();

	if (redis) {
		try {
			const result = await redis.set(key, "1", {
				NX: true,
				EX: EVENT_TTL_SECONDS,
			});
			if (result === null) {
				logger.info(
					`[webhook:${provider}] Skipping duplicate event ${eventId}`,
				);
				return true;
			}
			return false;
		} catch (err) {
			logger.warn(
				"[webhook-idempotency] Redis SET failed, falling back to memory:",
				err instanceof Error ? err.message : String(err),
			);
		}
	}

	if (processedEvents.has(key)) {
		logger.info(
			`[webhook:${provider}] Skipping duplicate event ${eventId}`,
		);
		return true;
	}
	processedEvents.set(key, { processedAt: Date.now() });
	return false;
}
