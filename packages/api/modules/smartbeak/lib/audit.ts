import { createAuditEvent } from "@repo/database";

export async function audit(data: {
	orgId: string;
	actorId?: string;
	action: string;
	entityType: string;
	entityId?: string;
	details?: Record<string, unknown>;
}) {
	try {
		await createAuditEvent(data);
	} catch (err) {
		console.error("[audit] Failed to create audit event:", err);
	}
}
