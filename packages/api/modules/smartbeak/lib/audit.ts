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
  } catch {
    // Audit failures must never block the main operation
  }
}
