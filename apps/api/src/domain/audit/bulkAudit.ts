

import { z } from 'zod';

import { getDb } from '../../db';

const BulkAuditSchema = z.object({
  orgId: z.string().uuid(),
  userId: z.string().uuid(),
  drafts: z.array(z.string().uuid()).max(1000),
  targets: z.array(z.string().min(1).max(100)).max(50)
});

export async function recordBulkPublishAudit({
  orgId,
  userId,
  drafts,
  targets,
}: {
  orgId: string;
  userId: string;
  drafts: string[];
  targets: string[];
}) {
  // Validate input parameters
  const validated = BulkAuditSchema.parse({ orgId, userId, drafts, targets });

  const db = await getDb();
  await db('audit_events').insert({
    org_id: validated.orgId,
    actor_type: 'user',
    action: 'bulk_publish_create',
    entity_type: 'publish_intent',
    entity_id: null,
    metadata: JSON.stringify({ drafts: validated.drafts, targets: validated.targets, count: validated.drafts.length }),
    correlation_id: `bulk-${Date.now()}`
  });
}
