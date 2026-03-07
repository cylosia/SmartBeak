import { createAuditEvent } from "@repo/database";
import { logger } from "@repo/logs";

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 200;

type AuditPayload = {
	orgId: string;
	actorId?: string;
	action: string;
	entityType: string;
	entityId?: string;
	details?: Record<string, unknown>;
};

async function attemptWithRetry(
	data: AuditPayload,
	attempt: number,
): Promise<void> {
	try {
		await createAuditEvent(data);
	} catch (err) {
		if (attempt < MAX_RETRIES) {
			const delay = BASE_DELAY_MS * 2 ** attempt;
			await new Promise((r) => setTimeout(r, delay));
			return attemptWithRetry(data, attempt + 1);
		}

		logger.error("[audit:dead-letter] Exhausted retries for audit event", {
			error: err instanceof Error ? err.message : String(err),
			action: data.action,
			entityType: data.entityType,
			entityId: data.entityId,
			orgId: data.orgId,
			attempts: MAX_RETRIES + 1,
		});
	}
}

export async function audit(data: AuditPayload) {
	await attemptWithRetry(data, 0);
}
