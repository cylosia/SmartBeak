/**
 * Webhook idempotency guard.
 *
 * Tracks processed webhook event IDs using a TTL-based in-memory store
 * to prevent duplicate processing on webhook retries.
 * Each provider namespace is isolated so event IDs from different
 * providers cannot collide.
 */

import { logger } from "@repo/logs";

const EVENT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface ProcessedEvent {
	processedAt: number;
}

const processedEvents = new Map<string, ProcessedEvent>();

const globalRef = globalThis as typeof globalThis & {
	__webhookIdempotencyCleanup?: ReturnType<typeof setInterval>;
};
if (!globalRef.__webhookIdempotencyCleanup) {
	globalRef.__webhookIdempotencyCleanup = setInterval(() => {
		const cutoff = Date.now() - EVENT_TTL_MS;
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
 */
export function isWebhookDuplicate(provider: string, eventId: string): boolean {
	const key = `${provider}:${eventId}`;
	if (processedEvents.has(key)) {
		logger.info(
			`[webhook:${provider}] Skipping duplicate event ${eventId}`,
		);
		return true;
	}
	processedEvents.set(key, { processedAt: Date.now() });
	return false;
}
