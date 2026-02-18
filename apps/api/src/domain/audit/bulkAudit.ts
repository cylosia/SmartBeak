

import crypto from 'crypto';
import { z } from 'zod';

import { getDb } from '../../db';
import { PayloadTooLargeError } from '@errors';

// P2-FIX: Bound JSONB metadata to prevent pathological payloads from exhausting
// PostgreSQL's per-row storage budget (1 GB hard limit) or overwhelming replication.
// 500 KB is conservative — a 1 000-element drafts array of UUIDs is ~37 KB.
const MAX_AUDIT_METADATA_BYTES = 500 * 1024; // 500 KB

const BulkAuditSchema = z.object({
  orgId: z.string().uuid(),
  userId: z.string().uuid(),
  drafts: z.array(z.string().uuid()).max(1000),
  // P2-FIX: Use .uuid() to match route-level validation (was .min(1).max(100))
  targets: z.array(z.string().uuid()).max(50)
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

  // P2-FIX: Guard against oversized JSONB payloads before hitting the DB.
  const metadataJson = JSON.stringify({ drafts: validated.drafts, targets: validated.targets, count: validated.drafts.length });
  if (Buffer.byteLength(metadataJson, 'utf8') > MAX_AUDIT_METADATA_BYTES) {
    throw new PayloadTooLargeError('Audit metadata exceeds maximum allowed size');
  }

  // P1-FIX: Added actor_id (was missing — audit records were unattributable to any user)
  // P2-FIX: Use crypto.randomUUID() for correlation_id (Date.now() not unique under concurrency)
  // P1-FIX: Added created_at for consistency with other audit inserts
  await db('audit_events').insert({
    org_id: validated.orgId,
    actor_type: 'user',
    actor_id: validated.userId,
    action: 'bulk_publish_create',
    entity_type: 'publish_intent',
    entity_id: null,
    metadata: metadataJson,
    correlation_id: `bulk-${crypto.randomUUID()}`,
    created_at: new Date(),
  });
}
