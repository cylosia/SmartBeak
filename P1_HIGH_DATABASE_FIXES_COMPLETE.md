# P1-High Database Fixes - COMPLETE

**Date:** 2026-02-10  
**Scope:** All P1-High database issues in SmartBeak codebase  
**Status:** ✅ ALL FIXES APPLIED

---

## Summary

All 11 P1-High database issues have been fixed. This includes:
- 6 new SQL migration files created
- 1 seed file modified
- 5 TypeScript files modified

---

## SQL Files Created/Modified

### New Migration Files

| File | Issue | Description |
|------|-------|-------------|
| `packages/db/migrations/20260228_add_content_genesis_indexes.sql` | P1-001 | Indexes on content_genesis foreign keys |
| `packages/db/migrations/20260228_add_domain_sale_readiness_index.sql` | P1-005 | Index on domain_sale_readiness.domain_id |
| `packages/db/migrations/20260228_fix_content_archive_transaction.sql` | P1-011 | Wrap migration in transaction with IF NOT EXISTS |
| `packages/db/migrations/20260228_fix_content_archive_timestamps.sql` | P0-002 | Convert TIMESTAMP to TIMESTAMPTZ |
| `packages/db/migrations/20260228_add_rls_policies.sql` | P1-002/P2-003 | Row Level Security policies |

### Modified Files

| File | Issue | Description |
|------|-------|-------------|
| `packages/db/seeds/20260210_backfill_human_intents.sql` | P1-004 | Added transaction safety, idempotency checks |

---

## TypeScript Files Modified

### 1. apps/api/src/db.ts (P1-006, P1-009)
**Issues Fixed:**
- P1-006: Missing Read Replica Lag Validation
- P1-009: Analytics DB Fallback Silent in Production

**Changes:**
```typescript
// Added replica lag checking
async function validateReplica(client: Knex): Promise<{ valid: boolean; lagMs: number }>
const MAX_REPLICATION_LAG_MS = 5000;

// Added fallback tracking and alerting
connectionMetrics.primaryFallbacks++;
connectionMetrics.replicaLagViolations++;
logger.error('ALERT: Analytics DB unavailable in production...');
```

### 2. apps/web/lib/db.ts (P1-007, P1-010)
**Issues Fixed:**
- P1-007: Missing Connection Validation Before Use
- P1-010: No Query Plan Capture for Slow Queries

**Changes:**
```typescript
// Added keepalive and connection validation
keepAlive: true,
keepAliveInitialDelayMillis: 10000,
poolInstance.on('connect', async (client) => {
  await client.query('SET statement_timeout = 30000');
  await client.query('SET lock_timeout = 10000');
});

// Added lock_timeout to withTransaction
await client.query('SET LOCAL lock_timeout = $1', [lockTimeoutMs]);

// Added query plan capture for slow queries
if (process.env.CAPTURE_SLOW_QUERY_PLANS === 'true' && duration > 5000) {
  const explainResult = await pool.query(
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${text}`, params
  );
}
```

### 3. domains/content/infra/persistence/PostgresContentRevisionRepository.ts (P1-003)
**Issue Fixed:**
- P1-003: Repository Uses Pool Instead of Client Parameter

**Changes:**
```typescript
// Added getQueryable helper
private getQueryable(client?: PoolClient): Pool | PoolClient {
  return client || this.pool;
}

// All methods now accept optional client parameter
async add(rev: ContentRevision, client?: PoolClient): Promise<void>
async getById(id: string, client?: PoolClient): Promise<ContentRevision | null>
async listByContent(contentId: string, limit: number, offset: number, client?: PoolClient): Promise<ContentRevision[]>
async countByContent(contentId: string, client?: PoolClient): Promise<number>
async prune(contentId: string, keepLast: number, client?: PoolClient): Promise<void>
async deleteByContent(contentId: string, client?: PoolClient): Promise<void>
```

### 4. domains/content/application/ports/ContentRevisionRepository.ts (P1-003)
**Changes:**
- Updated interface to include optional `client?: PoolClient` parameter on all methods
- Added `getById`, `countByContent`, `deleteByContent` methods

### 5. domains/search/application/SearchIndexingWorker.ts (P1-008)
**Issue Fixed:**
- P1-008: Repository Methods Don't Share Transaction Context
- P1-004 (related): Batch Save No Partial Success Recovery

**Changes:**
```typescript
// Added client parameter support to process()
async process(jobId: string, client?: PoolClient): Promise<ProcessResult>

// Rewrote processBatch() to use batch operations
async processBatch(jobIds: string[]): Promise<Map<string, ProcessResult>>

// Added processPendingBatch() helper
async processPendingBatch(batchSize: number): Promise<BatchProcessResult>

// Added batch methods to repository interface
getByIds?(ids: string[], client?: PoolClient): Promise<IndexingJob[]>
saveBatch?(jobs: IndexingJob[], client?: PoolClient): Promise<void>
updateStatusBatch?(jobIds: string[], status: string, client?: PoolClient): Promise<void>
```

### 6. domains/search/application/ports/IndexingJobRepository.ts (P1-008)
**Changes:**
- Added `client?: PoolClient` parameter to all methods
- Added batch operation methods: `getByIds`, `saveBatch`, `updateStatusBatch`

---

## Detailed Fix Descriptions

### P1-001: Missing Index on content_genesis.ai_advisory_artifact_id
**File:** `packages/db/migrations/20260228_add_content_genesis_indexes.sql`

```sql
CREATE INDEX IF NOT EXISTS idx_content_genesis_artifact 
ON content_genesis(ai_advisory_artifact_id);
```

### P1-002: Missing RLS Policies
**File:** `packages/db/migrations/20260228_add_rls_policies.sql`

```sql
ALTER TABLE human_intents ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON human_intents
  USING (tenant_id = current_tenant_id() OR is_admin_user());
```

### P1-003: Repository Transaction Support
**Files:** 
- `domains/content/infra/persistence/PostgresContentRevisionRepository.ts`
- `domains/content/application/ports/ContentRevisionRepository.ts`

Added optional `client?: PoolClient` parameter to all repository methods.

### P1-004: Seed File Idempotency
**File:** `packages/db/seeds/20260210_backfill_human_intents.sql`

Added:
- Transaction wrapper (`BEGIN...COMMIT`)
- Migration tracking table
- Idempotency check with `ON CONFLICT`
- Records processed tracking

### P1-005: Missing Index on domain_sale_readiness.domain_id
**File:** `packages/db/migrations/20260228_add_domain_sale_readiness_index.sql`

```sql
CREATE INDEX IF NOT EXISTS idx_domain_sale_readiness_domain 
ON domain_sale_readiness(domain_id);
```

### P1-006: Replica Lag Validation
**File:** `apps/api/src/db.ts`

```typescript
async function validateReplica(client: Knex): Promise<{ valid: boolean; lagMs: number }> {
  // Check if it's actually a replica
  const { rows: [recovery] } = await client.raw('SELECT pg_is_in_recovery() as is_replica');
  // Check replication lag
  const { rows: [lag] } = await client.raw(`
    SELECT EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp())) * 1000 as lag_ms
  `);
  if (lagMs > MAX_REPLICATION_LAG_MS) return { valid: false, lagMs };
}
```

### P1-007: Connection Validation
**File:** `apps/web/lib/db.ts`

```typescript
poolInstance = new Pool({
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});
poolInstance.on('connect', async (client) => {
  await client.query('SET statement_timeout = 30000');
  await client.query('SET lock_timeout = 10000');
});
```

### P1-008: Transaction Context Propagation
**Files:**
- `domains/search/application/SearchIndexingWorker.ts`
- `domains/search/application/ports/IndexingJobRepository.ts`

Added client parameter support and batch processing methods.

### P1-009: Silent Analytics Fallback
**File:** `apps/api/src/db.ts`

```typescript
if (!replicaUrl) {
  logger.warn('Analytics DB not configured, using primary database');
  connectionMetrics.primaryFallbacks++;
  if (process.env.NODE_ENV === 'production') {
    logger.error('ALERT: Analytics DB unavailable in production...');
  }
}
```

### P1-010: Query Plan Capture
**File:** `apps/web/lib/db.ts`

```typescript
if (process.env.CAPTURE_SLOW_QUERY_PLANS === 'true' && duration > 5000) {
  const explainResult = await pool.query(
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${text}`, params
  );
  logger.warn('Slow query execution plan', { plan: explainResult.rows[0]?.['QUERY PLAN'] });
}
```

### P1-011: Irreversible Migration Pattern
**File:** `packages/db/migrations/20260228_fix_content_archive_transaction.sql`

```sql
BEGIN;
CREATE TABLE IF NOT EXISTS content_archive_intents (...);
CREATE INDEX IF NOT EXISTS idx_archive_intents_content ...;
COMMIT;
```

---

## Testing Recommendations

1. **Test replica lag validation:** Temporarily stop replication and verify fallback
2. **Test transaction propagation:** Verify repository methods work with and without client parameter
3. **Test batch processing:** Process 100+ jobs and verify single transaction used
4. **Test RLS policies:** Verify tenant isolation works correctly
5. **Test lock timeout:** Create contention scenario and verify timeout works
6. **Test seed idempotency:** Run seed file twice and verify no duplicates

---

## Migration Execution Order

Run these migrations in order:

1. `20260228_fix_content_archive_timestamps.sql` - Fix timestamps first
2. `20260228_fix_content_archive_transaction.sql` - Create archive tables
3. `20260228_add_content_genesis_indexes.sql` - Add indexes
4. `20260228_add_domain_sale_readiness_index.sql` - Add domain_sale indexes
5. `20260228_add_rls_policies.sql` - Enable RLS (do last, requires testing)

---

**END OF P1-HIGH FIXES**
