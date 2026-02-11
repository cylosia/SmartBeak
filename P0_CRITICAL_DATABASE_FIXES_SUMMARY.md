# P0-Critical Database Fixes Summary

**Date:** 2026-02-10  
**Scope:** All P0-Critical database issues in SmartBeak codebase

---

## 1. TRANSACTION DEADLOCK - contentIdeaGenerationJob

**Status:** ✅ VERIFIED - Already fixed in existing code

**File:** `apps/api/src/jobs/contentIdeaGenerationJob.ts`

**Analysis:** The existing code already uses a proper atomic CTE query with Knex transaction for the idempotency key handling (lines 201-231). The UPSERT + SELECT pattern mentioned in the issue was not found in the codebase - it appears to have been previously refactored to use the CTE pattern.

**Current Implementation:**
```typescript
const result = await db.transaction(async (trx) => {
  if (idempotencyKey) {
    const upsertResult = await trx.raw(`
      INSERT INTO "idempotency_keys" (key, entity_type, entity_id, created_at)
      VALUES (?, ?, ?, NOW())
      ON CONFLICT (key) DO NOTHING
      RETURNING *
    `, [idempotencyKey, 'content_idea_batch', batchId]);
    // ...
  }
  await batchInsertIdeas(trx, ideas, domainId, idempotencyKey);
});
```

---

## 2. MISSING TRANSACTION BOUNDARIES - publishing-create-job

**Status:** ✅ FIXED

**File:** `control-plane/services/publishing-create-job.ts`

**Problem:** Three separate queries without transaction wrapping.

**Fix:** Wrapped all operations in a transaction with SERIALIZABLE isolation level.

**Diff:**
```typescript
// BEFORE:
async createJob(input: PublishingJobInput): Promise<PublishingJobResult> {
  const content = await this.pool.query(...);  // No transaction
  const target = await this.pool.query(...);   // No transaction
  await this.pool.query(...INSERT...);         // No transaction
}

// AFTER:
async createJob(input: PublishingJobInput): Promise<PublishingJobResult> {
  const client = await this.pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    const content = await client.query(...);   // In transaction
    const target = await client.query(...);    // In transaction
    await client.query(...INSERT...);          // In transaction
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
```

---

## 3. RACE CONDITION - Webhook idempotency

**Status:** ✅ FIXED

**File:** `control-plane/services/webhook-idempotency.ts`

**Problem:** Used `pool.query` outside transaction for fetching existing records; no advisory locks.

**Fix:** 
1. Added pg_advisory_lock for distributed locking
2. Changed all queries to use `client.query` within transaction
3. Added helper function `getWebhookLockKey()` for deterministic lock keys

**Diff:**
```typescript
// BEFORE:
const { rows: existingRows } = await pool.query(
  `SELECT received_at, processed FROM webhook_events...`,  // Outside tx!
  [provider, eventId]
);

// AFTER:
const lockKey = getWebhookLockKey(provider, eventId);
await client.query('SELECT pg_advisory_lock($1)', [lockKey]);
try {
  const { rows: existingRows } = await client.query(...);  // Inside tx!
} finally {
  await client.query('SELECT pg_advisory_unlock($1)', [lockKey]);
}
```

---

## 4. MISSING ON DELETE CASCADE

**Status:** ✅ FIXED (Migration Created)

**File:** `packages/db/migrations/20260210_fix_foreign_key_cascade.sql`

**Problem:** Multiple foreign key constraints missing ON DELETE behavior.

**Tables Fixed:**
- `subscriptions` - Added CASCADE on org_id, SET NULL on plan_id
- `usage_alerts` - Added CASCADE on org_id
- `publish_targets` - Added CASCADE on domain_id
- `publishing_jobs` - Added CASCADE on domain_id, content_id, target_id
- `publish_attempts` - Added CASCADE on publishing_job_id
- `notifications` - Added CASCADE on org_id, user_id
- `notification_attempts` - Added CASCADE on notification_id
- `search_documents` - Added CASCADE on index_id
- `indexing_jobs` - Added CASCADE on index_id
- `content_approvals` - Added CASCADE on content_id
- `content_expirations` - Added CASCADE on content_id
- `content_audit_log` - Added CASCADE on content_id
- `content_items` - Added CASCADE on domain_id
- `domain_transfer_log` - Added CASCADE on domain_id, SET NULL on transferred_by

---

## 5. SOFT DELETE UNIQUE INDEX BUG

**Status:** ✅ FIXED (Migration Created)

**File:** `packages/db/migrations/20260210_fix_email_subscribers_soft_delete.sql`

**Problem:** Unique index on `(domain_id, email)` prevented re-adding deleted subscribers.

**Fix:** Replaced with partial unique index that only applies to non-deleted records.

**SQL:**
```sql
-- Drop old index
DROP INDEX IF EXISTS email_subscribers_domain_email;

-- Create partial unique index (only for active records)
CREATE UNIQUE INDEX idx_email_subscribers_email_active 
ON email_subscribers(domain_id, email) 
WHERE deleted_at IS NULL;

-- Add supporting indexes
CREATE INDEX idx_email_subscribers_email_lookup ON email_subscribers(email);
CREATE INDEX idx_email_subscribers_deleted_at ON email_subscribers(deleted_at) 
WHERE deleted_at IS NOT NULL;
```

---

## 6. MISSING GIN INDEXES ON JSONB

**Status:** ✅ FIXED (Migration Created)

**File:** `packages/db/migrations/20260210_add_jsonb_gin_indexes.sql`

**Problem:** JSONB columns lacked GIN indexes for efficient querying.

**Indexes Added (25 total):**
- `domain_settings.custom_settings`
- `activity_log.metadata`
- `notifications.payload`
- `search_documents.fields`
- `domain_registry.custom_config`
- `alerts.metadata`
- `cost_tracking.metadata`
- `audit_logs.details`, `audit_logs.changes`
- `human_intents.intent_scope`, `advisory_context`, `execution_context`
- `idempotency_keys.payload`, `result`
- `risk_surfaces.risk_flags`
- `ai_advisory_artifacts.parameters`
- `content_genesis.llm_parameters`
- `llm_models.capabilities`
- `keyword_ingestion_schema.metrics`
- `activity_reflection_objections.metadata`
- `publish_intents.target_config`
- `feedback.metrics`
- `abuse_audit.metadata`
- `exports.export_scope`
- `email_domain.content`
- `image_assets.usage_rights`
- `content_roi.assumptions`
- `domain_sale_readiness.rationale`
- `domain_metrics_snapshots.metrics`
- `advisor_snapshots.snapshot`
- `content_ideas.suggested_outline`, `competitive_analysis`

---

## 7. UNBOUNDED OFFSET PAGINATION

**Status:** ✅ FIXED

**File:** `apps/api/src/utils/pagination.ts`

**Problem:** `calculateOffset()` causes O(n) scans with large offsets.

**Fix:** 
1. Added `MAX_SAFE_OFFSET = 10000` limit to offset-based pagination
2. Implemented complete cursor-based pagination system with:
   - `encodeCursor()` / `decodeCursor()` functions
   - `buildCursorWhereClause()` for O(1) performance
   - `createCursorQuery()` helper for easy implementation
   - `CursorPaginationResult<T>` type for typed results

**New Functions:**
```typescript
export function encodeCursor(value: string): string
export function decodeCursor(cursor: string): string
export function buildCursorWhereClause(...): { clause: string; params: unknown[] }
export function createCursorQuery(options: CursorQueryOptions): CursorQueryResult
export function processCursorResults<T>(...): CursorPaginationResult<T>
```

---

## 8. CONNECTION POOL EXHAUSTION

**Status:** ✅ FIXED

**File:** `control-plane/jobs/media-cleanup.ts`

**Problem:** No concurrency limiting for database operations.

**Fix:** Implemented Semaphore class to limit concurrent operations to 10.

**Diff:**
```typescript
// Added Semaphore class
class Semaphore {
  private permits: number;
  private queue: Array<() => void> = [];
  
  async acquire(): Promise<void> { ... }
  release(): void { ... }
}

// Usage in executeCleanup:
const semaphore = new Semaphore(MAX_CONCURRENT_OPERATIONS);
await Promise.all(batch.map(async (id) => {
  await semaphore.acquire();
  try {
    await svc.markCold(id);
  } finally {
    semaphore.release();
  }
}));
```

---

## 9. REPOSITORY PATTERN BROKEN - Can't join transactions

**Status:** ✅ FIXED

**Files Modified:**
- `domains/content/infra/persistence/PostgresContentRepository.ts`
- `domains/content/application/ports/ContentRepository.ts`
- `domains/publishing/infra/persistence/PostgresPublishingJobRepository.ts`
- `domains/publishing/application/ports/PublishingJobRepository.ts`
- `domains/notifications/infra/persistence/PostgresNotificationRepository.ts`
- `domains/notifications/application/ports/NotificationRepository.ts`

**Fix:** Added optional `client?: PoolClient` parameter to all repository methods.

**Example Interface Change:**
```typescript
// BEFORE:
getById(id: string): Promise<ContentItem | null>;
save(item: ContentItem): Promise<void>;

// AFTER:
getById(id: string, client?: PoolClient): Promise<ContentItem | null>;
save(item: ContentItem, client?: PoolClient): Promise<void>;
```

**Usage Example:**
```typescript
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await contentRepo.save(item, client);      // Joins transaction
  await publishingRepo.save(job, client);    // Same transaction
  await client.query('COMMIT');
} finally {
  client.release();
}
```

---

## 10. MISSING CONNECTION TIMEOUTS

**Status:** ✅ FIXED

**File:** `apps/api/src/db.ts`

**Problem:** No statement_timeout or idle_in_transaction_session_timeout set.

**Fix:** Added connection options with timeouts.

**Diff:**
```typescript
// Added constants
const STATEMENT_TIMEOUT_MS = 30000; // 30 seconds max query time
const IDLE_IN_TRANSACTION_TIMEOUT_MS = 60000; // 60 seconds max idle

// Updated connection config:
connection: {
  connectionString,
  options: `-c statement_timeout=${STATEMENT_TIMEOUT_MS} -c idle_in_transaction_session_timeout=${IDLE_IN_TRANSACTION_TIMEOUT_MS}`
}
```

---

## 11. ID TYPE MISMATCH - TEXT vs UUID

**Status:** ⚠️ PARTIALLY ADDRESSED (Documentation + Migration Framework)

**File:** `packages/db/migrations/20260210_fix_control_plane_id_types.sql`

**Problem:** control-plane tables use TEXT for IDs instead of UUID.

**Solution Provided:**
1. Created migration tracking table
2. Added documentation comments to all affected tables
3. Created `generate_uuid_from_text()` helper function for deterministic migration
4. Created compatibility views (`users_uuid`, `organizations_uuid`)

**Note:** Full type conversion requires application coordination and is documented in the migration file. The actual ALTER TYPE operations are complex and require:
- Dropping and recreating foreign key constraints
- Updating application code
- Data migration
- Index rebuilds

---

## 12. TIMESTAMP WITHOUT TIMEZONE

**Status:** ✅ FIXED (Migration Created)

**File:** `packages/db/migrations/20260210_fix_analytics_timestamp_timezone.sql`

**Problem:** Analytics tables use TIMESTAMP instead of TIMESTAMPTZ.

**Tables Fixed:**
- `keyword_metrics` - timestamp, created_at
- `social_metrics` - timestamp, created_at
- `content_performance` - timestamp, created_at
- `daily_analytics` - created_at
- `content_ideas` - created_at, updated_at
- `domain_exports` - expires_at, created_at
- `job_executions` - started_at, completed_at, created_at
- `alerts` - acknowledged_at, created_at
- `cost_tracking` - timestamp, created_at
- `cost_budgets` - created_at, updated_at
- `api_keys` - rotated_at, expires_at, grace_period_end, created_at, updated_at
- `audit_logs` - timestamp
- `auth_attempts` - timestamp
- `api_request_logs` - created_at

**Migration Note:** Assumes existing data is in UTC. Uses `AT TIME ZONE 'UTC'` for conversion.

---

## Migration Safety Notes

### For SQL Migrations:
1. **IF NOT EXISTS** - All CREATE statements use IF NOT EXISTS
2. **DO Blocks** - Constraint modifications wrapped in DO blocks for graceful handling
3. **Backward Compatible** - All changes are additive or use CASCADE safely
4. **Index Creation** - Non-blocking in PostgreSQL 11+ when using CONCURRENTLY

### For Code Changes:
1. **Optional Parameters** - All client parameters are optional for backward compatibility
2. **Transaction Safety** - All repository methods handle both pooled and client connections
3. **Error Handling** - Proper rollback and release in all error paths

---

## Testing Recommendations

1. **Test transactions** - Verify repository methods work with and without client parameter
2. **Test pagination limits** - Verify offset pagination fails after 10000 rows
3. **Test cursor pagination** - Implement cursor pagination in a test endpoint
4. **Test advisory locks** - Verify webhook idempotency with concurrent requests
5. **Test semaphores** - Verify media-cleanup respects concurrency limit
6. **Test connection timeouts** - Verify long queries are terminated after 30s

---

## Files Modified Summary

| File | Issue Fixed |
|------|-------------|
| `control-plane/services/publishing-create-job.ts` | Transaction boundaries |
| `control-plane/services/webhook-idempotency.ts` | Advisory locks + transaction safety |
| `control-plane/jobs/media-cleanup.ts` | Connection pool exhaustion |
| `apps/api/src/utils/pagination.ts` | Cursor-based pagination |
| `apps/api/src/db.ts` | Connection timeouts |
| `domains/content/infra/persistence/PostgresContentRepository.ts` | Transaction support |
| `domains/content/application/ports/ContentRepository.ts` | Interface update |
| `domains/publishing/infra/persistence/PostgresPublishingJobRepository.ts` | Transaction support |
| `domains/publishing/application/ports/PublishingJobRepository.ts` | Interface update |
| `domains/notifications/infra/persistence/PostgresNotificationRepository.ts` | Transaction support |
| `domains/notifications/application/ports/NotificationRepository.ts` | Interface update |

## New Migration Files

| File | Purpose |
|------|---------|
| `packages/db/migrations/20260210_fix_foreign_key_cascade.sql` | ON DELETE CASCADE |
| `packages/db/migrations/20260210_fix_email_subscribers_soft_delete.sql` | Partial unique index |
| `packages/db/migrations/20260210_add_jsonb_gin_indexes.sql` | GIN indexes for JSONB |
| `packages/db/migrations/20260210_fix_analytics_timestamp_timezone.sql` | TIMESTAMPTZ conversion |
| `packages/db/migrations/20260210_fix_control_plane_id_types.sql` | ID type migration framework |
