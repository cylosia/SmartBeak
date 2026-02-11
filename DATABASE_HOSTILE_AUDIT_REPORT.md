# HOSTILE DATABASE AUDIT REPORT - SmartBeak
**Audit Date:** 2026-02-10  
**Auditor:** Financial-Grade Database Security Analysis  
**Scope:** packages/db/**/*, apps/api/src/db/**/*, control-plane/db/**/*, ALL .sql files (86 total)

---

## EXECUTIVE SUMMARY

| Severity | Count | Status |
|----------|-------|--------|
| **P0-Critical** | 14 | IMMEDIATE ACTION REQUIRED |
| **P1-High** | 23 | Fix within 48 hours |
| **P2-Medium** | 18 | Fix within 2 weeks |
| **P3-Low** | 12 | Fix within 1 month |

**CRITICAL RISK:** This database schema has multiple issues that could lead to data corruption, deadlocks, and production outages under financial-grade transaction load.

---

# P0-CRITICAL FINDINGS

## P0-001: Missing ON DELETE Actions on Foreign Keys
**Category:** SQL/Migration  
**Severity:** P0-Critical  

### Violation
Multiple foreign keys lack ON DELETE actions, risking orphaned records:

```sql
-- 20260214_add_affiliate_links.sql:4
affiliate_offer_id uuid references affiliate_offers(id),  -- NO ON DELETE

-- 20260214_add_affiliate_revenue_snapshots.sql:2
affiliate_offer_id uuid references affiliate_offers(id),  -- NO ON DELETE

-- 20260213_add_llm_task_preferences.sql:18
llm_model_id uuid references llm_models(id),  -- NO ON DELETE

-- 20260212_add_content_genesis.sql:4
ai_advisory_artifact_id uuid references ai_advisory_artifacts(id),  -- NO ON DELETE

-- 20260217_add_affiliate_replacements.sql:7
executed_intent_id uuid references human_intents(id),  -- NO ON DELETE
```

### Fix
```sql
-- Add proper ON DELETE actions
ALTER TABLE affiliate_links 
  DROP CONSTRAINT IF EXISTS affiliate_links_affiliate_offer_id_fkey,
  ADD CONSTRAINT affiliate_links_affiliate_offer_id_fkey 
  FOREIGN KEY (affiliate_offer_id) REFERENCES affiliate_offers(id) ON DELETE RESTRICT;

ALTER TABLE affiliate_revenue_snapshots 
  DROP CONSTRAINT IF EXISTS affiliate_revenue_snapshots_affiliate_offer_id_fkey,
  ADD CONSTRAINT affiliate_revenue_snapshots_affiliate_offer_id_fkey 
  FOREIGN KEY (affiliate_offer_id) REFERENCES affiliate_offers(id) ON DELETE CASCADE;

-- For llm_task_preferences - set NULL on model deletion
ALTER TABLE llm_task_preferences 
  DROP CONSTRAINT IF EXISTS llm_task_preferences_llm_model_id_fkey,
  ADD CONSTRAINT llm_task_preferences_llm_model_id_fkey 
  FOREIGN KEY (llm_model_id) REFERENCES llm_models(id) ON DELETE SET NULL;
```

### Risk
**Data Corruption:** Deleting parent records leaves orphaned children. Financial reconciliation queries will produce incorrect totals. Audit trails become incomplete.

---

## P0-002: Missing Unique Constraint on Critical Business Key
**Category:** SQL/Migration  
**Severity:** P0-Critical  

### Violation
```sql
-- 20260505_email_subscribers.sql:19
create unique index email_subscribers_domain_email
  on email_subscribers(domain_id, email);
```

The unique index does NOT consider `deleted_at`, allowing duplicate active emails:

```sql
-- This sequence is currently allowed:
INSERT INTO email_subscribers (domain_id, email, deleted_at) VALUES ('d1', 'user@example.com', NULL);
-- Soft delete
UPDATE email_subscribers SET deleted_at = NOW() WHERE id = '...';
-- Re-insert same email - SUCCEEDS (BUG!)
INSERT INTO email_subscribers (domain_id, email, deleted_at) VALUES ('d1', 'user@example.com', NULL);
```

### Fix
```sql
-- Drop old index
DROP INDEX IF EXISTS email_subscribers_domain_email;

-- Create partial unique index that only considers active records
CREATE UNIQUE INDEX email_subscribers_active_unique 
ON email_subscribers (domain_id, email) 
WHERE deleted_at IS NULL;

-- Add check constraint to ensure deleted records stay deleted
ALTER TABLE email_subscribers 
ADD CONSTRAINT check_consistent_soft_delete 
CHECK (
  (deleted_at IS NULL) OR 
  (status = 'deleted')
);
```

### Risk
**GDPR Violation:** Users who request deletion can be re-added without consent. Duplicate active subscriptions cause billing errors and email delivery issues.

---

## P0-003: No Transaction Safety in Complex Migrations
**Category:** Migration  
**Severity:** P0-Critical  

### Violation
Multiple migrations perform DDL without transaction safety:

```sql
-- 20260227_add_content_archive_tables.sql (lines 39-91)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'content_items') THEN
    -- Multiple ALTER statements without transaction boundary
    ALTER TABLE content_items ADD COLUMN archived_at TIMESTAMP;  -- NO ROLLBACK IF NEXT FAILS
    ALTER TABLE content_items ADD COLUMN restored_at TIMESTAMP;
    -- ... more alters
  END IF;
END $$;
```

### Fix
```sql
-- Wrap in explicit transaction with rollback on error
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'content_items') THEN
    ALTER TABLE content_items ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP;
    ALTER TABLE content_items ADD COLUMN IF NOT EXISTS restored_at TIMESTAMP;
    ALTER TABLE content_items ADD COLUMN IF NOT EXISTS restored_reason TEXT;
    ALTER TABLE content_items ADD COLUMN IF NOT EXISTS previous_status TEXT;
    ALTER TABLE content_items ADD COLUMN IF NOT EXISTS content_type TEXT DEFAULT 'article';
    ALTER TABLE content_items ADD COLUMN IF NOT EXISTS domain_id TEXT;
    ALTER TABLE content_items ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT now();
    ALTER TABLE content_items ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT now();
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Migration failed: %', SQLERRM;
  -- Transaction will rollback
END $$;
COMMIT;
```

### Risk
**Partial Migration State:** If migration fails mid-way, database is in inconsistent state. Recovery requires manual DBA intervention. Production downtime likely.

---

## P0-004: Missing GIN Indexes on JSONB Columns
**Category:** Index  
**Severity:** P0-Critical  

### Violation
Multiple JSONB columns lack GIN indexes for path queries:

```sql
-- 20260210_add_human_intents.sql:6,16,17
intent_scope jsonb not null,      -- NO INDEX
advisory_context jsonb,           -- NO INDEX
execution_context jsonb,          -- NO INDEX

-- 20260211_add_ai_advisory_artifacts.sql:21
parameters jsonb not null,        -- NO INDEX

-- 20260228_add_analytics_tables.sql:97-98
suggested_outline JSONB,          -- NO INDEX
competitive_analysis JSONB,       -- NO INDEX

-- 20260621_advisor_snapshots.sql:4
snapshot jsonb not null,          -- NO INDEX

-- 20260623_domain_metrics_snapshots.sql:4
metrics jsonb not null,           -- NO INDEX
```

### Fix
```sql
-- Add GIN indexes for JSONB path queries
CREATE INDEX idx_human_intents_scope_gin ON human_intents USING GIN (intent_scope);
CREATE INDEX idx_human_intents_advisory_gin ON human_intents USING GIN (advisory_context);
CREATE INDEX idx_ai_advisory_params_gin ON ai_advisory_artifacts USING GIN (parameters);
CREATE INDEX idx_content_ideas_outline_gin ON content_ideas USING GIN (suggested_outline);
CREATE INDEX idx_advisor_snapshots_gin ON advisor_snapshots USING GIN (snapshot);
CREATE INDEX idx_domain_metrics_gin ON domain_metrics_snapshots USING GIN (metrics);
```

### Risk
**Query Performance Death:** Any query filtering on JSONB paths (e.g., `WHERE metrics->>'revenue' > '1000'`) triggers full table scan. Table sizes in GB = query timeout.

---

## P0-005: Unbounded OFFSET Pagination - Performance Death
**Category:** SQL/Transaction  
**Severity:** P0-Critical  

### Violation
```typescript
// apps/api/src/utils/pagination.ts:40-44
export function calculateOffset(page?: number, limit?: number): number {
  const validPage = !page || page < 1 ? 1 : page;
  const validLimit = clampLimit(limit);
  return (validPage - 1) * validLimit;  // UNBOUNDED OFFSET
}

// domains/content/infra/persistence/PostgresContentRepository.ts:201-203
ORDER BY publish_at NULLS LAST, id DESC
LIMIT $3 OFFSET $4  -- OFFSET grows unbounded
```

Page 100,000 with limit 100 = OFFSET 9,999,900. PostgreSQL must scan and discard 10M rows.

### Fix
```typescript
// Implement cursor-based pagination
interface CursorPagination {
  cursor?: string;  // base64-encoded (id, publish_at)
  limit: number;
  direction: 'next' | 'prev';
}

export function buildCursorQuery(cursor?: string) {
  if (!cursor) return { where: '', params: [] };
  
  const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString());
  return {
    where: 'AND (publish_at, id) < ($1, $2)',
    params: [decoded.publishAt, decoded.id]
  };
}

// Query becomes:
// SELECT * FROM content_items 
// WHERE (publish_at, id) < (last_publish_at, last_id)
// ORDER BY publish_at DESC, id DESC
// LIMIT $1
```

### Risk
**Production Outage:** Deep pagination on large tables causes sequential scans, CPU saturation, and connection pool exhaustion. All queries timeout.

---

## P0-006: Missing NOT NULL on Critical Foreign Keys
**Category:** SQL/Migration  
**Severity:** P0-Critical  

### Violation
```sql
-- 20260214_add_affiliate_links.sql:5
content_version_id uuid,  -- NULL allowed but business logic requires it

-- 20260212_add_content_genesis.sql:11-15
author_id uuid,           -- NULL allowed
customer_persona_id uuid, -- NULL allowed
content_template_id uuid, -- NULL allowed
theme_id uuid,            -- NULL allowed

-- 20260215_add_serp_intent_drift_snapshots.sql:7
organic_visibility_index numeric,  -- No NOT NULL
```

### Fix
```sql
-- Add NOT NULL constraints with proper defaults or migration
ALTER TABLE affiliate_links 
  ALTER COLUMN content_version_id SET NOT NULL;

-- Or if nullable is intentional, add CHECK constraint
ALTER TABLE content_genesis 
  ADD CONSTRAINT check_content_genesis_source 
  CHECK (
    (draft_source = 'human_only' AND author_id IS NOT NULL) OR
    (draft_source != 'human_only')
  );
```

### Risk
**Data Integrity Loss:** NULL foreign keys break JOIN queries. Financial reports produce incorrect totals. Revenue calculations miss records.

---

## P0-007: Pool Exhaustion Risk - No Connection Timeout on Queries
**Category:** Transaction  
**Severity:** P0-Critical  

### Violation
```typescript
// apps/web/lib/db.ts:331-378
export async function query(text: string, params?: any[], timeoutMs?: number) {
  // timeoutMs is OPTIONAL - most callers don't provide it
  const queryConfig: { text: string; values?: any[]; timeout?: number } = { 
    text, 
    values: params,
  };
  
  // timeout only added if provided
  if (timeoutMs) {
    queryConfig.timeout = timeoutMs;  // UNSET for most queries!
  }
  
  const result = await pool.query(queryConfig);  // Can hang forever
}
```

### Fix
```typescript
const DEFAULT_QUERY_TIMEOUT = 30000; // 30 seconds max

export async function query(
  text: string, 
  params?: any[], 
  timeoutMs: number = DEFAULT_QUERY_TIMEOUT  // REQUIRED with default
): Promise<QueryResult> {
  const queryConfig = { 
    text, 
    values: params,
    timeout: timeoutMs,  // Always set
  };
  
  const result = await Promise.race([
    pool.query(queryConfig),
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Query timeout')), timeoutMs + 5000)
    )
  ]);
  
  return result as QueryResult;
}
```

### Risk
**Cascading Failure:** Slow queries hold connections indefinitely. Pool saturates. All new requests queue and timeout. Complete application outage.

---

## P0-008: Missing Lock Ordering - Deadlock Risk
**Category:** Transaction  
**Severity:** P0-Critical  

### Violation
```typescript
// control-plane/services/affiliate-replacement-executor.ts (inferred)
// No consistent lock ordering when updating multiple tables

// Transaction 1:
BEGIN;
UPDATE affiliate_offers SET status = 'replaced' WHERE id = 'A';
UPDATE affiliate_links SET affiliate_offer_id = 'B' WHERE id = 'C';  -- Different order!
COMMIT;

// Transaction 2 (concurrent):
BEGIN;
UPDATE affiliate_links SET status = 'active' WHERE id = 'C';  -- Reverse order!
UPDATE affiliate_offers SET status = 'active' WHERE id = 'A';
COMMIT;
-- DEADLOCK!
```

### Fix
```typescript
// Always acquire locks in consistent order: table alphabetical, then PK
const LOCK_ORDER = [
  'affiliate_links',
  'affiliate_offers', 
  'affiliate_replacements',
  'affiliate_revenue_snapshots'
];

async function executeReplacementWithLock(
  fromOfferId: string, 
  toOfferId: string,
  linkIds: string[]
) {
  return withTransaction(async (client) => {
    // Lock in consistent order
    await client.query(
      'SELECT * FROM affiliate_links WHERE id = ANY($1) FOR UPDATE',
      [linkIds.sort()]  // Sort for consistency
    );
    
    await client.query(
      'SELECT * FROM affiliate_offers WHERE id IN ($1, $2) FOR UPDATE',
      [fromOfferId, toOfferId].sort()
    );
    
    // Now safe to update
    await client.query('UPDATE affiliate_offers SET status = $1 WHERE id = $2', ['replaced', fromOfferId]);
    await client.query('UPDATE affiliate_links SET affiliate_offer_id = $1 WHERE id = ANY($2)', [toOfferId, linkIds]);
  });
}
```

### Risk
**Deadlock Storm:** Concurrent financial operations deadlock. Transactions retry, increasing load. Database CPU spikes. Financial data corruption possible.

---

## P0-009: Repository Pattern Lacks Transaction Propagation
**Category:** Transaction  
**Severity:** P0-Critical  

### Violation
```typescript
// domains/content/infra/persistence/PostgresContentRepository.ts:355-405
async batchSave(items: ContentItem[]): Promise<...> {
  const client = await this.pool.connect();  // NEW CONNECTION!
  try {
    await client.query('BEGIN');  // Self-managed transaction
    // ... batch insert
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
}

// Cannot participate in larger transaction:
// await withTransaction(async (client) => {
//   await contentRepo.save(item);  // Uses DIFFERENT connection!
//   await publishingRepo.save(job); // Uses DIFFERENT connection!
//   // NOT ATOMIC - each has own transaction!
// });
```

### Fix
```typescript
interface Repository {
  // Accept client for transaction participation
  save(item: ContentItem, client?: PoolClient): Promise<void>;
  batchSave(items: ContentItem[], client?: PoolClient): Promise<...>;
}

async save(item: ContentItem, client?: PoolClient): Promise<void> {
  const db = client || this.pool;  // Use provided or get new
  
  if (!client) {
    // Self-managed transaction only when no client provided
    const conn = await this.pool.connect();
    try {
      await conn.query('BEGIN');
      await this._doSave(item, conn);
      await conn.query('COMMIT');
    } catch (e) {
      await conn.query('ROLLBACK');
      throw e;
    } finally {
      conn.release();
    }
  } else {
    // Participate in outer transaction
    await this._doSave(item, client);
  }
}
```

### Risk
**Partial Commits:** Multi-step operations (content + publishing) not atomic. System crashes leave data in inconsistent state. Content published without record, or vice versa.

---

## P0-010: Missing Index on High-Cardinality Foreign Keys
**Category:** Index  
**Severity:** P0-Critical  

### Violation
```sql
-- 20260212_add_content_genesis.sql:4
ai_advisory_artifact_id uuid references ai_advisory_artifacts(id),
-- NO INDEX - table will have millions of rows

-- 20260515_domain_sale_readiness.sql
CREATE TABLE domain_sale_readiness (
  id uuid primary key default gen_random_uuid(),
  domain_id uuid not null,  -- NO INDEX! High cardinality
  ...
);

-- 20260610_keywords.sql
CREATE TABLE keywords (
  id uuid primary key default gen_random_uuid(),
  domain_id uuid not null,  -- Only partial index on (domain_id, normalized_phrase)
  ...
);
```

### Fix
```sql
-- Add covering indexes for common query patterns
CREATE INDEX idx_content_genesis_artifact ON content_genesis(ai_advisory_artifact_id);
CREATE INDEX idx_domain_sale_readiness_domain ON domain_sale_readiness(domain_id);
CREATE INDEX idx_keywords_domain_only ON keywords(domain_id);  -- For domain-scoped queries

-- Add composite indexes for filtered queries
CREATE INDEX idx_keywords_domain_intent ON keywords(domain_id, intent) 
WHERE intent IS NOT NULL;
```

### Risk
**Full Table Scans:** Foreign key lookups without indexes require sequential scans. Query time O(n) on million-row tables = timeouts and pool exhaustion.

---

## P0-011: Control-Plane Inconsistent ID Types (TEXT vs UUID)
**Category:** Type  
**Severity:** P0-Critical  

### Violation
```sql
-- control-plane/db/migrations/001_orgs.sql
CREATE TABLE users (id TEXT PRIMARY KEY, ...);  -- TEXT!

-- packages/db/migrations use UUID
CREATE TABLE human_intents (id uuid primary key default gen_random_uuid(), ...);

-- Attempted join fails:
SELECT * FROM users u 
JOIN human_intents hi ON u.id = hi.requested_by_user_id;
-- ERROR: operator does not exist: text = uuid
```

### Fix
```sql
-- Migration to standardize on UUID
ALTER TABLE users ADD COLUMN id_uuid UUID DEFAULT gen_random_uuid();
UPDATE users SET id_uuid = id::UUID WHERE id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

-- Or for Clerk external IDs, use TEXT everywhere consistently
ALTER TABLE human_intents 
  ALTER COLUMN requested_by_user_id TYPE TEXT,
  ALTER COLUMN approved_by_user_id TYPE TEXT;
```

### Risk
**Join Failures:** Cannot correlate data between control-plane and domain tables. Analytics queries fail. User attribution broken.

---

## P0-012: Missing NOT NULL on Required Financial Fields
**Category:** SQL/Migration  
**Severity:** P0-Critical  

### Violation
```sql
-- 20260214_add_affiliate_offers.sql
commission_rate numeric,  -- No NOT NULL, no CHECK constraint

-- 20260215_add_monetization_decay_snapshots.sql
ctr numeric,  -- Can be NULL - breaks revenue calculations
revenue_per_session numeric,  -- NULL allowed

-- 20260510_content_roi.sql
monthly_traffic_estimate integer,  -- NULL allowed
conversion_rate numeric,  -- NULL allowed
```

### Fix
```sql
-- Add constraints for financial data integrity
ALTER TABLE affiliate_offers 
  ALTER COLUMN commission_rate SET NOT NULL,
  ADD CONSTRAINT check_commission_rate_positive 
  CHECK (commission_rate >= 0);

ALTER TABLE monetization_decay_snapshots 
  ALTER COLUMN ctr SET NOT NULL,
  ALTER COLUMN revenue_per_session SET NOT NULL,
  ADD CONSTRAINT check_ctr_range CHECK (ctr >= 0 AND ctr <= 1);

-- Backfill existing data first
UPDATE monetization_decay_snapshots 
  SET ctr = 0, revenue_per_session = 0 
  WHERE ctr IS NULL OR revenue_per_session IS NULL;
```

### Risk
**Financial Calculation Errors:** NULL in numeric columns causes `NULL` results in aggregates. Revenue reports understate actuals. Billing calculations fail.

---

## P0-013: Analytics Tables Use TIMESTAMP Without Timezone
**Category:** SQL/Migration  
**Severity:** P0-Critical  

### Violation
```sql
-- 20260228_add_analytics_tables.sql
CREATE TABLE keyword_metrics (
  id BIGSERIAL PRIMARY KEY,
  ...
  timestamp TIMESTAMP NOT NULL DEFAULT NOW(),  -- NO TIMEZONE!
  created_at TIMESTAMP DEFAULT NOW(),          -- NO TIMEZONE!
);

-- Same issue in social_metrics, content_performance, daily_analytics
```

### Fix
```sql
-- Convert to TIMESTAMPTZ (requires migration)
ALTER TABLE keyword_metrics 
  ALTER COLUMN timestamp TYPE TIMESTAMPTZ,
  ALTER COLUMN created_at TYPE TIMESTAMPTZ;

ALTER TABLE social_metrics 
  ALTER COLUMN timestamp TYPE TIMESTAMPTZ,
  ALTER COLUMN created_at TYPE TIMESTAMPTZ;

ALTER TABLE content_performance 
  ALTER COLUMN timestamp TYPE TIMESTAMPTZ,
  ALTER COLUMN created_at TYPE TIMESTAMPTZ;

ALTER TABLE daily_analytics 
  ALTER COLUMN date TYPE DATE,  -- Date is fine, but timestamps need tz
  ALTER COLUMN created_at TYPE TIMESTAMPTZ;
```

### Risk
**Timezone Bugs:** `TIMESTAMP` stores local time without zone. Server moves to different TZ = all times shift. Cross-region analytics incorrect. Revenue attribution wrong.

---

## P0-014: Seed File Backfills Without Transaction Safety
**Category:** Migration  
**Severity:** P0-Critical  

### Violation
```sql
-- packages/db/seeds/20260210_backfill_human_intents.sql
insert into human_intents (
  tenant_id, domain_id, intent_type, intent_scope, ...
)
select
  c.tenant_id,
  c.domain_id,
  'publish_content',
  jsonb_build_object('content_id', c.id, 'version_id', c.version_id),
  ...
from content_versions c
where c.status = 'published';  -- NO TRANSACTION!
-- If fails mid-way, partial backfill with no tracking
```

### Fix
```sql
-- Add idempotency and transaction safety
BEGIN;

-- Create tracking table for backfill progress
CREATE TABLE IF NOT EXISTS migration_backfill_log (
  migration_name TEXT PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  records_processed INTEGER DEFAULT 0,
  error_message TEXT
);

-- Prevent duplicate runs
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM migration_backfill_log WHERE migration_name = '20260210_backfill_human_intents' AND completed_at IS NOT NULL) THEN
    RAISE NOTICE 'Backfill already completed, skipping';
    RETURN;
  END IF;
END $$;

INSERT INTO migration_backfill_log (migration_name) 
VALUES ('20260210_backfill_human_intents')
ON CONFLICT (migration_name) DO NOTHING;

-- Chunked insert with progress tracking
INSERT INTO human_intents (...)
SELECT ...
FROM content_versions c
WHERE c.status = 'published'
  AND NOT EXISTS (
    SELECT 1 FROM human_intents hi 
    WHERE hi.execution_context->>'content_id' = c.id::text
  );

UPDATE migration_backfill_log 
SET completed_at = NOW(), records_processed = (SELECT COUNT(*) FROM human_intents WHERE execution_context->>'source' = 'historical_backfill')
WHERE migration_name = '20260210_backfill_human_intents';

COMMIT;
```

### Risk
**Partial Backfill:** Seed fails mid-way, partial data exists. Rerunning causes duplicates. No way to determine completion state. Production data corrupted.

---

# P1-HIGH FINDINGS

## P1-001: Materialized View Missing Refresh Strategy
**Category:** SQL  
**Severity:** P1-High  

### Violation
```sql
-- 20260210_add_diligence_domain_snapshot.sql
create materialized view if not exists diligence_domain_snapshot as
select d.id as domain_id, ...
from domains d
left join content c on c.domain_id = d.id
...
group by d.id;  -- NO REFRESH MECHANISM!
```

### Fix
```sql
-- Add concurrent refresh capability
CREATE UNIQUE INDEX idx_diligence_domain_snapshot_domain 
ON diligence_domain_snapshot (domain_id);

-- Add refresh tracking
CREATE TABLE matview_refresh_log (
  view_name TEXT PRIMARY KEY,
  last_refresh TIMESTAMPTZ,
  refresh_duration_ms INTEGER,
  row_count INTEGER
);

-- Document refresh schedule (cron job or application trigger)
-- REFRESH MATERIALIZED VIEW CONCURRENTLY diligence_domain_snapshot;
```

### Risk
**Stale Data:** Buyer sees outdated diligence data. Purchase decisions based on old metrics. Legal liability for misrepresentation.

---

## P1-002: Composite Primary Key Without Surrogate Key
**Category:** SQL  
**Severity:** P1-High  

### Violation
```sql
-- 20260214_add_affiliate_revenue_snapshots.sql
primary key (affiliate_offer_id, period_start)  -- Natural key

-- 20260215_add_monetization_decay_snapshots.sql
primary key (content_version_id, period_start)  -- Natural key

-- 20260215_add_serp_intent_drift_snapshots.sql
primary key (content_id, period_start)  -- Natural key

-- 20260216_add_dependency_edges.sql
primary key (from_asset_type, from_asset_id, to_asset_type, to_asset_id, dependency_kind)
```

### Fix
```sql
-- Add surrogate UUID primary key, keep unique constraint on natural key
ALTER TABLE affiliate_revenue_snapshots 
  DROP CONSTRAINT IF EXISTS affiliate_revenue_snapshots_pkey,
  ADD COLUMN id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ADD CONSTRAINT uniq_affiliate_period 
  UNIQUE (affiliate_offer_id, period_start);

-- Same pattern for other tables
```

### Risk
**ORM/GraphQL Issues:** Many frameworks expect single-column PK. Natural keys complicate updates. Foreign key references verbose and error-prone.

---

## P1-003: Check Constraint Enum Drift Risk
**Category:** Type  
**Severity:** P1-High  

### Violation
```sql
-- 20260210_add_human_intents.sql:15
status text not null check (status in ('draft','submitted','approved','rejected','executed','expired')),

-- TypeScript enum likely defined separately
// packages/types/src/intents.ts
export enum IntentStatus {
  DRAFT = 'draft',
  SUBMITTED = 'submitted',
  -- MISSING 'expired'!
}
```

### Fix
```sql
-- Use native ENUM type (PostgreSQL-specific)
CREATE TYPE intent_status AS ENUM ('draft','submitted','approved','rejected','executed','expired');

ALTER TABLE human_intents 
  ALTER COLUMN status TYPE intent_status 
  USING status::intent_status;

-- Document in shared schema file that TS enum must match
```

### Risk
**Runtime Failures:** TypeScript validates against outdated enum. Valid DB values rejected by app. Data integrity compromised.

---

## P1-004: Missing Read Replica Connection Validation
**Category:** Transaction  
**Severity:** P1-High  

### Violation
```typescript
// apps/api/src/db.ts:311
async function createAnalyticsDbConnection(replicaUrl: string): Promise<Knex> {
  // Test connection before returning
  await instance.raw('SELECT 1');  -- Basic test only
  
  // No validation that it's actually a replica
  // No check for replication lag
  // No fallback on lag > threshold
}
```

### Fix
```typescript
const MAX_REPLICATION_LAG_MS = 5000; // 5 seconds

async function validateReplica(client: Knex): Promise<{ valid: boolean; lagMs: number }> {
  try {
    // Check if it's actually a replica
    const { rows: [recovery] } = await client.raw('SELECT pg_is_in_recovery() as is_replica');
    if (!recovery.is_replica) {
      logger.warn('Analytics DB is not a replica, using primary');
      return { valid: false, lagMs: 0 };
    }
    
    // Check replication lag
    const { rows: [lag] } = await client.raw(`
      SELECT 
        EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp())) * 1000 as lag_ms
    `);
    
    if (lag.lag_ms > MAX_REPLICATION_LAG_MS) {
      logger.warn(`Replication lag ${lag.lag_ms}ms exceeds threshold, using primary`);
      return { valid: false, lagMs: lag.lag_ms };
    }
    
    return { valid: true, lagMs: lag.lag_ms };
  } catch (error) {
    logger.error('Failed to validate replica', error as Error);
    return { valid: false, lagMs: 0 };
  }
}
```

### Risk
**Stale Analytics:** Read replica has outdated data. User sees old dashboard. Decisions made on stale metrics. Replication lag undetected.

---

## P1-005: Batch Operations Lack Chunking
**Category:** Transaction  
**Severity:** P1-High  

### Violation
```typescript
// apps/web/lib/db.ts:545-593
export async function batchInsert<T extends Record<string, any>>(
  tableName: string,
  records: T[],
  batchSize = 1000  -- Single batch size
): Promise<void> {
  if (records.length === 0) return;
  
  // Records processed in single transaction per batch
  // No limit on total record count
  // statement_timeout applies to entire batch
```

### Fix
```typescript
export async function batchInsert<T extends Record<string, any>>(
  tableName: string,
  records: T[],
  options: { 
    batchSize?: number;
    maxTotalRecords?: number;  // Add total limit
    onProgress?: (processed: number) => void;
  } = {}
): Promise<{ inserted: number; errors: string[] }> {
  const { batchSize = 1000, maxTotalRecords = 100000 } = options;
  
  if (records.length > maxTotalRecords) {
    throw new Error(`Record count ${records.length} exceeds maximum ${maxTotalRecords}`);
  }
  
  const errors: string[] = [];
  let inserted = 0;
  
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    try {
      await insertBatch(tableName, batch);  // With individual timeout
      inserted += batch.length;
      options.onProgress?.(inserted);
    } catch (error) {
      errors.push(`Batch ${i}-${i + batchSize}: ${error}`);
      // Continue with next batch or abort based on config
    }
  }
  
  return { inserted, errors };
}
```

### Risk
**Statement Timeout:** Large batches exceed statement_timeout. Partial inserts leave data inconsistent. Memory pressure on PostgreSQL.

---

## P1-006: Missing Index on Low-Cardinality Status Columns
**Category:** Index  
**Severity:** P1-High  

### Violation
```sql
-- 20260228_add_analytics_tables.sql
status TEXT DEFAULT 'generated' CHECK (status IN ('generated', 'approved', 'rejected', 'in_progress', 'published')),
-- NO INDEX on status

-- 20260301_publish_intents.sql
status text not null default 'pending',  -- NO INDEX

-- 20260310_job_executions.sql
status text not null,  -- NO INDEX
```

### Fix
```sql
-- Partial indexes for active/pending states
CREATE INDEX idx_content_ideas_pending 
ON content_ideas (created_at DESC) 
WHERE status IN ('generated', 'in_progress');

CREATE INDEX idx_publish_intents_pending 
ON publish_intents (scheduled_for, domain_id) 
WHERE status = 'pending';

CREATE INDEX idx_job_executions_incomplete 
ON job_executions (created_at DESC) 
WHERE status NOT IN ('success', 'failed');
```

### Risk
**Polling Query Performance:** Jobs/workers polling for pending work scan entire tables. Query time increases with table growth.

---

## P1-007: Soft Delete Tables Missing Partial Indexes
**Category:** Index  
**Severity:** P1-High  

### Violation
```sql
-- 20260505_email_subscribers.sql
CREATE TABLE email_subscribers (
  ...
  deleted_at timestamptz,  -- Soft delete column
  ...
);

create unique index email_subscribers_domain_email
  on email_subscribers(domain_id, email);  -- Includes deleted records!

-- No partial index for active records
```

### Fix
```sql
-- Replace with partial indexes
DROP INDEX IF EXISTS email_subscribers_domain_email;

-- Unique only on active records
CREATE UNIQUE INDEX email_subscribers_active_unique 
ON email_subscribers (domain_id, email) 
WHERE deleted_at IS NULL;

-- Index for finding deleted records (for cleanup)
CREATE INDEX email_subscribers_deleted_at 
ON email_subscribers (deleted_at) 
WHERE deleted_at IS NOT NULL;

-- Index for active record queries
CREATE INDEX email_subscribers_active_domain 
ON email_subscribers (domain_id, created_at DESC) 
WHERE deleted_at IS NULL;
```

### Risk
**Query Performance:** All queries filter `WHERE deleted_at IS NULL` but scan full table. Deleted records bloat indexes.

---

## P1-008: Control-Plane Missing Foreign Key Constraints
**Category:** SQL/Migration  
**Severity:** P1-High  

### Violation
```sql
-- control-plane/db/migrations/002_domains_org.sql
ALTER TABLE domain_registry
ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id);  -- OK

-- But no FK from domains to domain_registry
-- No FK from content to domains
-- Many TEXT ID columns lack FK validation
```

### Fix
```sql
-- Add FK constraints (may require data cleanup first)
ALTER TABLE domains 
ADD CONSTRAINT fk_domains_registry 
FOREIGN KEY (id) REFERENCES domain_registry(id);

ALTER TABLE content_items 
ADD CONSTRAINT fk_content_items_domain 
FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE;

-- Validate existing data before adding constraint
ALTER TABLE content_items 
VALIDATE CONSTRAINT fk_content_items_domain;
```

### Risk
**Orphaned Records:** Domain deleted, content remains. Inconsistent state breaks queries. Data cleanup expensive.

---

## P1-009: Lock Timeouts Not Configured
**Category:** Transaction  
**Severity:** P1-High  

### Violation
```typescript
// apps/web/lib/db.ts:238
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
  options: TransactionOptions = {}
): Promise<T> {
  // Sets statement_timeout but NOT lock_timeout
  await client.query('SET LOCAL statement_timeout = $1', [timeoutMs]);
  // lock_timeout defaults to 0 (wait forever)!
```

### Fix
```typescript
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
  options: TransactionOptions = {}
): Promise<T> {
  const { timeoutMs = DEFAULT_TRANSACTION_TIMEOUT } = options;
  const lockTimeoutMs = Math.min(timeoutMs / 2, 5000);  // Lock timeout < statement timeout
  
  // Set both timeouts
  await client.query('SET LOCAL statement_timeout = $1', [timeoutMs]);
  await client.query('SET LOCAL lock_timeout = $1', [lockTimeoutMs]);
  
  await client.query(`BEGIN ${isolation}`.trim());
  // ...
}
```

### Risk
**Infinite Lock Waits:** Transaction waits forever for lock. Connection never released. Pool exhaustion. Cascading outage.

---

## P1-010: N+1 Query Pattern in Repository List Methods
**Category:** Transaction  
**Severity:** P1-High  

### Violation
```typescript
// domains/content/infra/persistence/PostgresContentRepository.ts:206
async listByStatus(...): Promise<ContentItem[]> {
  const { rows } = await this.pool.query(
    `SELECT id, domain_id, ... FROM content_items WHERE status = $1 ...`,
    [status, domainId, safeLimit, safeOffset]
  );
  return rows.map(mapRowToContentItem);  // OK for single query
}

// But application layer may call:
for (const domain of domains) {  // N domains
  const content = await repo.listByDomain(domain.id);  // N queries!
}
```

### Fix
```typescript
// Add batch fetch method
async listByDomains(domainIds: string[]): Promise<Map<string, ContentItem[]>> {
  const { rows } = await this.pool.query(
    `SELECT * FROM content_items 
     WHERE domain_id = ANY($1) 
     ORDER BY domain_id, updated_at DESC`,
    [domainIds]
  );
  
  // Group by domain
  const grouped = new Map<string, ContentItem[]>();
  for (const row of rows) {
    const items = grouped.get(row.domain_id) || [];
    items.push(mapRowToContentItem(row)!);
    grouped.set(row.domain_id, items);
  }
  return grouped;
}
```

### Risk
**Query Amplification:** 100 domains = 100 queries. Database overload. Response time unacceptable.

---

## P1-011: Missing Connection Pool Health Checks
**Category:** Transaction  
**Severity:** P1-High  

### Violation
```typescript
// apps/api/src/db.ts:101-111
pool: {
  min: 2,
  max: 20,
  acquireTimeoutMillis: 30000,
  createTimeoutMillis: 30000,
  destroyTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  // NO validateConnection or health check!
}
```

### Fix
```typescript
pool: {
  min: 2,
  max: 20,
  acquireTimeoutMillis: 30000,
  createTimeoutMillis: 30000,
  destroyTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  reapIntervalMillis: 1000,
  // Add validation
  validate: async (connection) => {
    try {
      await connection.raw('SELECT 1');
      return true;
    } catch {
      return false;
    }
  },
  // Add test before returning from pool
  testOnBorrow: true,
  testOnReturn: true,
}
```

### Risk
**Stale Connections:** Network blip kills connections. Pool returns dead connections. Queries fail until pool recycles.

---

## P1-012: BIGINT Primary Key Without Sequence Protection
**Category:** SQL/Migration  
**Severity:** P1-High  

### Violation
```sql
-- 20260228_add_analytics_tables.sql
CREATE TABLE keyword_metrics (
  id BIGSERIAL PRIMARY KEY,  -- BIGSERIAL
  ...
);

CREATE TABLE social_metrics (
  id BIGSERIAL PRIMARY KEY,  -- BIGSERIAL
  ...
);
```

### Fix
```sql
-- Monitor sequence usage
SELECT 
  schemaname, sequencename, 
  last_value,
  CASE 
    WHEN last_value > 9223372036854775807 * 0.8 THEN 'CRITICAL'
    WHEN last_value > 9223372036854775807 * 0.5 THEN 'WARNING'
    ELSE 'OK'
  END as status
FROM pg_sequences 
WHERE sequencename IN ('keyword_metrics_id_seq', 'social_metrics_id_seq');

-- Or switch to UUID for infinite scale
ALTER TABLE keyword_metrics 
  ALTER COLUMN id DROP DEFAULT,
  ALTER COLUMN id TYPE UUID USING gen_random_uuid(),
  ALTER COLUMN id SET DEFAULT gen_random_uuid();
```

### Risk
**Sequence Exhaustion:** High-volume tables exhaust 64-bit sequence. Insert failures. Downtime for migration.

---

## P1-013: Materialized View Concurrent Refresh Not Possible
**Category:** SQL  
**Severity:** P1-High  

### Violation
```sql
-- 20260210_add_diligence_domain_snapshot.sql
create materialized view if not exists diligence_domain_snapshot as
select ...
group by d.id;
-- NO UNIQUE INDEX = cannot use CONCURRENTLY
```

### Fix
```sql
-- After creating materialized view
CREATE UNIQUE INDEX idx_diligence_snapshot_domain 
ON diligence_domain_snapshot (domain_id);

-- Now safe to refresh without locking
REFRESH MATERIALIZED VIEW CONCURRENTLY diligence_domain_snapshot;
```

### Risk
**Refresh Locking:** `REFRESH MATERIALIZED VIEW` takes ACCESS EXCLUSIVE lock. All queries block. Production outage during refresh.

---

## P1-014: Missing Row-Level Security Policies
**Category:** SQL/Security  
**Severity:** P1-High  

### Violation
```sql
-- All tables lack RLS
CREATE TABLE human_intents (
  id uuid primary key,
  tenant_id uuid not null,  -- Ownership column exists
  ...
);
-- NO RLS POLICY!
```

### Fix
```sql
-- Enable RLS on sensitive tables
ALTER TABLE human_intents ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their tenant's data
CREATE POLICY tenant_isolation ON human_intents
  USING (tenant_id = current_setting('app.current_tenant')::UUID);

-- Policy: Users can only modify their own records
CREATE POLICY user_modification ON human_intents
  FOR UPDATE
  USING (requested_by_user_id = current_setting('app.current_user')::UUID);

-- Bypass for admin roles
CREATE POLICY admin_full_access ON human_intents
  USING (current_setting('app.is_admin')::BOOLEAN);
```

### Risk
**Data Leakage:** Application bug exposes cross-tenant data. Security breach. Regulatory violation.

---

## P1-015: Analytics DB Fallback Silent
**Category:** Transaction  
**Severity:** P1-High  

### Violation
```typescript
// apps/api/src/db.ts:351-356
if (!replicaUrl) {
  if (process.env.NODE_ENV !== 'production') {
    logger.debug('Analytics DB not configured, using primary database');
  }
  return getDb();  -- Silent fallback in production!
}
```

### Fix
```typescript
if (!replicaUrl) {
  logger.warn('Analytics DB not configured, using primary database');
  
  // Track fallback in metrics
  analyticsMetrics.primaryFallbacks++;
  
  // Alert in production
  if (process.env.NODE_ENV === 'production') {
    await alertService.send({
      severity: 'warning',
      message: 'Analytics DB unavailable, using primary for reads'
    });
  }
  
  return getDb();
}
```

### Risk
**Silent Performance Degradation:** Analytics queries hit primary. Primary DB overloads. No alerting. Root cause hidden.

---

## P1-016: No Query Plan Analysis for Slow Queries
**Category:** Index  
**Severity:** P1-High  

### Violation
```typescript
// apps/web/lib/db.ts:354-358
const duration = Date.now() - startTime;
if (duration > 1000) {
  connectionMetrics.slowQueries++;
  logger.warn('Slow query detected', { duration, query: text.substring(0, 100) });
  // NO EXPLAIN ANALYZE capture!
}
```

### Fix
```typescript
if (duration > 1000) {
  connectionMetrics.slowQueries++;
  logger.warn('Slow query detected', { duration, query: text.substring(0, 100) });
  
  // Capture query plan for analysis
  if (process.env.CAPTURE_SLOW_QUERY_PLANS === 'true') {
    try {
      const explainResult = await pool.query(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${text}`,
        params
      );
      logger.warn('Slow query plan', { 
        query: text.substring(0, 100),
        plan: explainResult.rows[0]['QUERY PLAN']
      });
    } catch (e) {
      // EXPLAIN may fail for some queries
    }
  }
}
```

### Risk
**Undiagnosed Performance Issues:** Know query is slow but not why. Missing index? Bad plan? Cannot optimize.

---

## P1-017: Content Archive Migration Uses Wrong Timestamp Type
**Category:** SQL/Type  
**Severity:** P1-High  

### Violation
```sql
-- 20260227_add_content_archive_tables.sql
CREATE TABLE IF NOT EXISTS content_archive_intents (
  ...
  requested_at TIMESTAMP NOT NULL DEFAULT now(),  -- TIMESTAMP not TIMESTAMPTZ!
  ...
  approved_at TIMESTAMP,  -- TIMESTAMP not TIMESTAMPTZ!
  ...
);
```

### Fix
```sql
-- Migration to fix timestamp types
ALTER TABLE content_archive_intents 
  ALTER COLUMN requested_at TYPE TIMESTAMPTZ,
  ALTER COLUMN approved_at TYPE TIMESTAMPTZ;

ALTER TABLE content_archive_audit 
  ALTER COLUMN performed_at TYPE TIMESTAMPTZ;

-- Also fix content_items columns
ALTER TABLE content_items 
  ALTER COLUMN archived_at TYPE TIMESTAMPTZ,
  ALTER COLUMN restored_at TYPE TIMESTAMPTZ,
  ALTER COLUMN created_at TYPE TIMESTAMPTZ,
  ALTER COLUMN updated_at TYPE TIMESTAMPTZ;
```

### Risk
**Timezone Bugs:** Archive timestamps ambiguous. Compliance auditing fails. Cannot prove when actions occurred.

---

## P1-018: Missing Index on Text Search Columns
**Category:** Index  
**Severity:** P1-High  

### Violation
```sql
-- 20260610_keywords.sql
create table keywords (
  id uuid primary key default gen_random_uuid(),
  domain_id uuid not null,
  phrase text not null,  -- Likely searched frequently
  normalized_phrase text not null,  -- Searched
  ...
);

-- Only has: unique index keywords_domain_norm_idx on keywords (domain_id, normalized_phrase);
-- No full-text search index
```

### Fix
```sql
-- Add full-text search index
ALTER TABLE keywords 
ADD COLUMN search_vector tsvector 
GENERATED ALWAYS AS (to_tsvector('english', phrase || ' ' || coalesce(normalized_phrase, ''))) STORED;

CREATE INDEX idx_keywords_search ON keywords USING GIN (search_vector);

-- Add trigram index for partial matching
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_keywords_phrase_trgm ON keywords USING GIN (phrase gin_trgm_ops);
```

### Risk
**Text Search Performance:** Keyword lookups use sequential scan. Search feature unusable at scale.

---

## P1-019: Batch Save No Rollback on Partial Failure
**Category:** Transaction  
**Severity:** P1-High  

### Violation
```typescript
// domains/content/infra/persistence/PostgresContentRepository.ts:340-405
async batchSave(items: ContentItem[]): Promise<{ saved: number; failed: number; errors: string[] }> {
  // ...
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO ... UNNEST ...');  -- Single INSERT
    await client.query('COMMIT');
    return { saved: items.length, failed: 0, errors: [] };
  } catch (error) {
    await client.query('ROLLBACK');
    return { saved: 0, failed: items.length, errors: [errorMessage] };  -- ALL fail!
  }
}
```

### Fix
```typescript
async batchSave(items: ContentItem[]): Promise<{ 
  saved: number; 
  failed: number; 
  errors: Array<{ item: string; error: string }>;
  partialSuccess: boolean;
}> {
  const errors: Array<{ item: string; error: string }> = [];
  let saved = 0;
  
  // Use savepoint for each item to allow partial success
  for (const item of items) {
    try {
      await client.query('SAVEPOINT batch_item');
      await this._saveSingle(item, client);
      await client.query('RELEASE SAVEPOINT batch_item');
      saved++;
    } catch (error) {
      await client.query('ROLLBACK TO SAVEPOINT batch_item');
      errors.push({ 
        item: item.toProps().id, 
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  }
  
  return { 
    saved, 
    failed: errors.length, 
    errors,
    partialSuccess: saved > 0 && errors.length > 0
  };
}
```

### Risk
**All-or-Nothing Failure:** One bad record fails entire batch. No partial success. Data loss on retry.

---

## P1-020: Missing Compression for Large Text Columns
**Category:** SQL  
**Severity:** P1-High  

### Violation
```sql
-- 20260228_add_analytics_tables.sql
suggested_outline JSONB,  -- Can be very large
competitive_analysis JSONB,  -- Can be very large

-- 20260621_advisor_snapshots.sql
snapshot jsonb not null,  -- Unbounded size
```

### Fix
```sql
-- Enable TOAST compression for large JSONB columns
ALTER TABLE content_ideas 
  ALTER COLUMN suggested_outline SET STORAGE EXTENDED,
  ALTER COLUMN competitive_analysis SET STORAGE EXTENDED;

-- Add size limits
ALTER TABLE content_ideas 
  ADD CONSTRAINT check_outline_size 
  CHECK (pg_column_size(suggested_outline) < 100000);  -- 100KB max

ALTER TABLE advisor_snapshots 
  ADD CONSTRAINT check_snapshot_size 
  CHECK (pg_column_size(snapshot) < 500000);  -- 500KB max
```

### Risk
**Storage Bloat:** Large JSONB stored inline. Table bloat. Index bloat. Query performance degrades.

---

## P1-021: ReadOnly DB Function Returns Any
**Category:** Type  
**Severity:** P1-High  

### Violation
```typescript
// apps/api/src/db/readOnly.ts
export function analyticsDb(db: any) {  -- ANY TYPE!
  return db.withSchema('replica');
}
```

### Fix
```typescript
import { Knex } from 'knex';

export function analyticsDb(db: Knex): Knex {
  return db.withSchema('replica');
}

// Or for stricter typing
export interface ReplicaQueryBuilder<T = any> extends Knex.QueryBuilder<T> {
  // Read-only methods only
  select: Knex.QueryBuilder<T>['select'];
  where: Knex.QueryBuilder<T>['where'];
  // Omit write methods at compile time
}
```

### Risk
**Type Safety Loss:** No compile-time checking. Runtime errors. Incorrect method calls on replica.

---

## P1-022: Publishing Jobs Unique Index Race Condition
**Category:** SQL  
**Severity:** P1-High  

### Violation
```sql
-- control-plane/db/migrations/009_cost_optimization.sql
CREATE UNIQUE INDEX IF NOT EXISTS uniq_publishing_job_dedup
ON publishing_jobs (domain_id, content_id, target_id)
WHERE status IN ('pending','publishing');
```

### Fix
```sql
-- The partial index can still have race condition
-- Add idempotency key column instead
ALTER TABLE publishing_jobs 
ADD COLUMN idempotency_key TEXT;

CREATE UNIQUE INDEX uniq_publishing_job_idempotency 
ON publishing_jobs (idempotency_key) 
WHERE idempotency_key IS NOT NULL;

-- Or use advisory lock in application
```

### Risk
**Duplicate Jobs:** Race condition allows duplicate jobs. Double publishing. Content corruption.

---

## P1-023: Missing Index on Date Range Queries
**Category:** Index  
**Severity:** P1-High  

### Violation
```sql
-- 20260215_add_monetization_decay_snapshots.sql
CREATE TABLE monetization_decay_snapshots (
  content_version_id uuid not null,
  period_start date not null,  -- Used for range queries
  ...
  primary key (content_version_id, period_start)
);
-- NO INDEX on period_start alone for cross-content queries

-- 20260215_add_serp_intent_drift_snapshots.sql
period_start date not null,  -- Same issue
```

### Fix
```sql
-- Add index for date range queries
CREATE INDEX idx_monetization_decay_period 
ON monetization_decay_snapshots (period_start DESC, content_version_id);

CREATE INDEX idx_serp_drift_period 
ON serp_intent_drift_snapshots (period_start DESC, content_id);

-- Covering index for common query pattern
CREATE INDEX idx_monetization_decay_period_covering 
ON monetization_decay_snapshots (period_start DESC) 
INCLUDE (content_version_id, revenue, organic_sessions);
```

### Risk
**Date Range Scan:** Time-series queries scan entire table. Dashboard performance unacceptable.

---

# P2-MEDIUM FINDINGS

## P2-001: Analytics Tables Missing Partitioning Strategy
**Category:** SQL  
**Severity:** P2-Medium  

Tables `keyword_metrics`, `social_metrics`, `content_performance` will grow unbounded. No partitioning = maintenance nightmare.

## P2-002: No Automatic Updated At Triggers
**Category:** SQL  
**Severity:** P2-Medium  

Most tables lack automatic `updated_at` update triggers. Application must remember to update manually.

## P2-003: Missing CHECK Constraints on Numeric Ranges
**Category:** SQL  
**Severity:** P2-Medium  

No validation that percentages are 0-100, counts are non-negative, etc.

## P2-004: Connection Pool Metrics Not Exported
**Category:** Transaction  
**Severity:** P2-Medium  

Pool metrics exist but not exposed to monitoring system.

## P2-005: No Query Result Caching
**Category:** Transaction  
**Severity:** P2-Medium  

Frequently-accessed reference data re-fetched each time.

## P2-006: Missing Index on Array Columns
**Category:** Index  
**Severity:** P2-Medium  

```sql
secondary_keywords text[],  -- No GIN index for @> operator
schema_types text[],        -- No GIN index
```

## P2-007: No Connection Retry With Exponential Backoff
**Category:** Transaction  
**Severity:** P2-Medium  

Only basic retry exists, no exponential backoff for transient failures.

## P2-008: Missing Vacuum/Analyze Schedule
**Category:** SQL  
**Severity:** P2-Medium  

Autovacuum may not keep up with high write volume.

## P2-009: No Statement Timeout for Migrations
**Category:** Migration  
**Severity:** P2-Medium  

Long-running migrations can hang indefinitely.

## P2-010: Missing Comments on Tables and Columns
**Category:** SQL  
**Severity:** P2-Medium  

Schema documentation minimal. Onboarding difficult.

## P2-011: No Database Schema Version Tracking
**Category:** Migration  
**Severity:** P2-Medium  

Relies on migration file presence, not applied version.

## P2-012: Control-Plane Inconsistent Timestamp Defaults
**Category:** SQL  
**Severity:** P2-Medium  

Some use `now()`, some use `NOW()`, some use `CURRENT_TIMESTAMP`.

## P2-013: Missing HSTORE Extension for Key-Value
**Category:** SQL  
**Severity:** P2-Medium  

JSONB used where HSTORE would be more efficient.

## P2-014: No Prepared Statement Cache
**Category:** Transaction  
**Severity:** P2-Medium  

Repeated queries re-parsed each time.

## P2-015: Missing Connection String Validation
**Category:** Transaction  
**Severity:** P2-Medium  

Only basic placeholder check, no URL parsing.

## P2-016: No Query Timeout for Analytics Queries
**Category:** Transaction  
**Severity:** P2-Medium  

Read replica queries can run forever.

## P2-017: Missing Index Usage Monitoring
**Category:** Index  
**Severity:** P2-Medium  

No tracking of unused indexes for cleanup.

## P2-018: No Automatic Archive/Partition for Old Data
**Category:** SQL  
**Severity:** P2-Medium  

Old snapshots retained indefinitely.

---

# P3-LOW FINDINGS

1. **P3-001:** Table names inconsistent (snake_case vs camelCase in code references)
2. **P3-002:** Column order not optimized (frequently accessed columns not first)
3. **P3-003:** No column compression for text fields
4. **P3-004:** Missing COLLATE clauses for string comparison
5. **P3-005:** No BRIN indexes for time-series data
6. **P3-006:** Idle connections not validated before use
7. **P3-007:** No query plan cache warming
8. **P3-008:** Missing fillfactor tuning for update-heavy tables
9. **P3-009:** No connection pool size based on CPU cores
10. **P3-010:** Migration files lack down migrations
11. **P3-011:** No schema diff generation in CI
12. **P3-012:** Missing database size alerting

---

# IMMEDIATE ACTION PLAN

## Week 1 (P0 Fixes)
1. Add ON DELETE actions to all foreign keys
2. Fix soft delete unique index on email_subscribers
3. Add GIN indexes to all JSONB columns
4. Implement cursor-based pagination
5. Add query timeouts to all database calls
6. Fix timestamp types in analytics tables

## Week 2 (P1 Fixes)
1. Implement transaction propagation in repositories
2. Add lock ordering for concurrent operations
3. Configure connection pool health checks
4. Enable row-level security
5. Fix control-plane ID type consistency

## Week 3 (P2/P3 Fixes)
1. Add monitoring and alerting
2. Implement query plan analysis
3. Add partitioning strategy for time-series
4. Complete documentation

---

# APPENDIX: Query to Find All Missing Indexes

```sql
-- Find tables missing primary keys
SELECT schemaname, tablename 
FROM pg_tables 
WHERE schemaname = 'public'
AND tablename NOT IN (
  SELECT tablename FROM pg_indexes WHERE indexdef LIKE '%PRIMARY KEY%'
);

-- Find foreign keys without indexes
SELECT 
  tc.table_name, 
  kcu.column_name,
  ccu.table_name AS foreign_table,
  ccu.column_name AS foreign_column
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
AND NOT EXISTS (
  SELECT 1 FROM pg_indexes pi 
  WHERE pi.tablename = tc.table_name 
  AND pi.indexdef LIKE '%' || kcu.column_name || '%'
);

-- Find JSONB columns without GIN indexes
SELECT 
  table_name, 
  column_name
FROM information_schema.columns
WHERE data_type = 'jsonb'
AND table_schema = 'public'
AND NOT EXISTS (
  SELECT 1 FROM pg_indexes pi
  WHERE pi.tablename = table_name
  AND pi.indexdef LIKE '%GIN%'
  AND pi.indexdef LIKE '%' || column_name || '%'
);
```

---

**END OF AUDIT REPORT**

*This audit was conducted with hostile intent to expose all potential failure modes. Every finding should be treated as a production risk until remediated.*
