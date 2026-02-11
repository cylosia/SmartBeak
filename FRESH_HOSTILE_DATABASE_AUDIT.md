# FRESH HOSTILE DATABASE AUDIT REPORT - SmartBeak
**Audit Date:** 2026-02-10  
**Auditor:** Hostile Database Security Analysis  
**Scope:** packages/db/**/*, apps/api/src/db.ts, control-plane/db/**/*, ALL .sql files (90+ total)

---

## EXECUTIVE SUMMARY

| Severity | Count | Status |
|----------|-------|--------|
| **P0-Critical** | 8 | IMMEDIATE ACTION REQUIRED |
| **P1-High** | 11 | Fix within 48 hours |
| **P2-Medium** | 6 | Fix within 2 weeks |
| **P3-Low** | 4 | Fix within 1 month |

**CRITICAL RISK:** Multiple database issues remain that could cause production outages, data corruption, and performance degradation under load.

---

# P0-CRITICAL FINDINGS (NEW/UNFIXED)

## P0-001: Missing ON DELETE CASCADE on Foreign Keys (PARTIALLY FIXED)
**File:** packages/db/migrations/20260214_add_affiliate_links.sql:4  
**Severity:** P0-Critical  
**Status:** NEW

### Violation
```sql
-- Line 4: Missing ON DELETE action
affiliate_offer_id uuid references affiliate_offers(id),  -- NO ON DELETE
content_version_id uuid,  -- No FK constraint at all
```

The fix migration (20260210_fix_foreign_key_cascade.sql) does NOT cover affiliate_links table.

### SQL Fix
```sql
-- Add proper ON DELETE actions for affiliate_links
ALTER TABLE affiliate_links 
  DROP CONSTRAINT IF EXISTS affiliate_links_affiliate_offer_id_fkey,
  ADD CONSTRAINT affiliate_links_affiliate_offer_id_fkey 
  FOREIGN KEY (affiliate_offer_id) REFERENCES affiliate_offers(id) ON DELETE RESTRICT;

-- Add FK for content_version_id if it should reference content_versions
ALTER TABLE affiliate_links 
  ADD CONSTRAINT affiliate_links_content_version_id_fkey 
  FOREIGN KEY (content_version_id) REFERENCES content_versions(id) ON DELETE CASCADE;
```

---

## P0-002: TIMESTAMP Without Timezone (PARTIALLY FIXED)
**File:** packages/db/migrations/20260227_add_content_archive_tables.sql  
**Severity:** P0-Critical  
**Status:** NEW

### Violation
```sql
-- Lines 9, 12, 28: TIMESTAMP without timezone
requested_at TIMESTAMP NOT NULL DEFAULT now(),  -- Line 9
approved_at TIMESTAMP,  -- Line 12
performed_at TIMESTAMP NOT NULL DEFAULT now()  -- Line 28
```

Migration 20260210_fix_analytics_timestamp_timezone.sql does NOT cover content_archive tables.

### SQL Fix
```sql
-- Fix content archive tables timezone
ALTER TABLE content_archive_intents 
  ALTER COLUMN requested_at TYPE TIMESTAMPTZ USING requested_at AT TIME ZONE 'UTC',
  ALTER COLUMN approved_at TYPE TIMESTAMPTZ USING approved_at AT TIME ZONE 'UTC';

ALTER TABLE content_archive_audit 
  ALTER COLUMN performed_at TYPE TIMESTAMPTZ USING performed_at AT TIME ZONE 'UTC';
```

---

## P0-003: Unbounded OFFSET Pagination (NOT FIXED)
**Files:** Multiple repository files  
**Severity:** P0-Critical  
**Status:** UNFIXED

### Violation
```typescript
// PostgresContentRepository.ts:215, 227, 299
LIMIT $3 OFFSET $4  -- Unbounded OFFSET - causes sequential scans

// PostgresNotificationRepository.ts:142, 205
LIMIT $1 OFFSET $2

// 12 total occurrences across domain repositories
```

Page 100,000 with limit 100 = OFFSET 9,999,900. PostgreSQL must scan and discard 10M rows.

### Fix
```typescript
// Implement cursor-based pagination
async listByStatusWithCursor(
  status: ContentStatus,
  cursor?: { publishAt: Date; id: string },
  limit: number = 50
): Promise<{ items: ContentItem[]; nextCursor?: string }> {
  const query = cursor
    ? `SELECT * FROM content_items 
       WHERE status = $1 
       AND (publish_at, id) < ($2, $3)
       ORDER BY publish_at DESC, id DESC
       LIMIT $4`
    : `SELECT * FROM content_items 
       WHERE status = $1 
       ORDER BY publish_at DESC, id DESC
       LIMIT $2`;
  
  const params = cursor 
    ? [status, cursor.publishAt, cursor.id, limit]
    : [status, limit];
  
  // ... execute and return nextCursor
}
```

---

## P0-004: N+1 Query Pattern in SearchIndexingWorker (NEW)
**File:** domains/search/application/SearchIndexingWorker.ts:192  
**Severity:** P0-Critical  
**Status:** NEW

### Violation
```typescript
// Line 192: Sequential processing creates N+1 pattern
async processBatch(jobIds: string[]): Promise<Map<string, ProcessResult>> {
  const results = new Map<string, ProcessResult>();
  
  // Process sequentially - each job = one transaction + queries
  for (const jobId of jobIds) {  // N iterations
    results.set(jobId, await this.process(jobId));  // N queries
  }
  
  return results;
}
```

With MAX_BATCH_SIZE = 100, this creates 100 separate transactions.

### Fix
```typescript
// Batch process with single transaction
async processBatch(jobIds: string[]): Promise<Map<string, ProcessResult>> {
  const client = await this.pool.connect();
  const results = new Map<string, ProcessResult>();
  
  try {
    await client.query('BEGIN');
    
    // Fetch all jobs in single query
    const { rows: jobs } = await client.query(
      'SELECT * FROM indexing_jobs WHERE id = ANY($1) AND status = $2',
      [jobIds, 'pending']
    );
    
    // Batch update status
    await client.query(
      `UPDATE indexing_jobs SET status = 'processing' 
       WHERE id = ANY($1)`,
      [jobIds]
    );
    
    await client.query('COMMIT');
    
    // Process indexing outside transaction
    for (const job of jobs) {
      results.set(job.id, await this.executeIndexing(job));
    }
  } finally {
    client.release();
  }
  
  return results;
}
```

---

## P0-005: Connection Pool Without Lock Timeout (NOT FIXED)
**File:** apps/web/lib/db.ts:51-59  
**Severity:** P0-Critical  
**Status:** UNFIXED

### Violation
```typescript
poolInstance = new Pool({
  connectionString,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  max: 20,
  min: 2,
  // NO lock_timeout configuration!
  // NO statement_timeout at pool level!
});
```

Query timeout is OPTIONAL in the query function (line 331), most callers don't provide it.

### Fix
```typescript
poolInstance = new Pool({
  connectionString,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  max: 20,
  min: 2,
  // Add query timeout at connection level
  query_timeout: 30000,  // 30 seconds max for any query
  // Or use connection handler
  application_name: 'smartbeak_web',
});

// On connect, set session timeouts
poolInstance.on('connect', (client) => {
  client.query('SET statement_timeout = 30000');  // 30 seconds
  client.query('SET lock_timeout = 10000');  // 10 seconds max lock wait
});
```

---

## P0-006: Missing lock_timeout in Transactions (NOT FIXED)
**File:** apps/web/lib/db.ts:275  
**Severity:** P0-Critical  
**Status:** UNFIXED

### Violation
```typescript
// Line 275: Only sets statement_timeout, not lock_timeout
await client.query('SET LOCAL statement_timeout = $1', [timeoutMs]);
// lock_timeout defaults to 0 (wait forever)!
```

### Fix
```typescript
// Add lock timeout to prevent infinite waits
const lockTimeoutMs = Math.min(timeoutMs / 2, 10000);  // Lock timeout < statement timeout

await client.query('SET LOCAL statement_timeout = $1', [timeoutMs]);
await client.query('SET LOCAL lock_timeout = $1', [lockTimeoutMs]);
```

---

## P0-007: Seed File Without Transaction Safety (NOT FIXED)
**File:** packages/db/seeds/20260210_backfill_human_intents.sql  
**Severity:** P0-Critical  
**Status:** UNFIXED

### Violation
```sql
-- No transaction wrapper!
-- No idempotency check!
-- No progress tracking!
insert into human_intents (...)
select ... from content_versions c
where c.status = 'published';  -- If fails mid-way, partial backfill with no tracking
```

### Fix
```sql
BEGIN;

-- Create tracking table if not exists
CREATE TABLE IF NOT EXISTS migration_backfill_log (
  migration_name TEXT PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  records_processed INTEGER DEFAULT 0
);

-- Prevent duplicate runs
INSERT INTO migration_backfill_log (migration_name) 
VALUES ('20260210_backfill_human_intents')
ON CONFLICT (migration_name) DO NOTHING;

-- Skip if already completed
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM migration_backfill_log 
             WHERE migration_name = '20260210_backfill_human_intents' 
             AND completed_at IS NOT NULL) THEN
    RAISE NOTICE 'Backfill already completed, skipping';
    RETURN;
  END IF;
END $$;

-- Idempotent insert
INSERT INTO human_intents (...)
SELECT ...
FROM content_versions c
WHERE c.status = 'published'
  AND NOT EXISTS (
    SELECT 1 FROM human_intents hi 
    WHERE hi.execution_context->>'content_id' = c.id::text
  );

UPDATE migration_backfill_log 
SET completed_at = NOW(), 
    records_processed = (SELECT COUNT(*) FROM human_intents 
                         WHERE execution_context->>'source' = 'historical_backfill')
WHERE migration_name = '20260210_backfill_human_intents';

COMMIT;
```

---

## P0-008: Missing NOT NULL on Financial Fields (NEW)
**File:** packages/db/migrations/20260214_add_affiliate_offers.sql:10  
**Severity:** P0-Critical  
**Status:** NEW

### Violation
```sql
commission_rate numeric,  -- No NOT NULL, no CHECK constraint
```

NULL in financial calculations causes incorrect aggregates.

### Fix
```sql
-- Add constraint for financial data integrity
ALTER TABLE affiliate_offers 
  ALTER COLUMN commission_rate SET NOT NULL,
  ADD CONSTRAINT check_commission_rate_positive 
  CHECK (commission_rate >= 0 AND commission_rate <= 1);

-- Backfill existing data
UPDATE affiliate_offers 
SET commission_rate = 0 
WHERE commission_rate IS NULL;
```

---

# P1-HIGH FINDINGS (NEW/UNFIXED)

## P1-001: Missing Index on High-Cardinality Foreign Keys (NEW)
**File:** packages/db/migrations/20260212_add_content_genesis.sql:4  
**Severity:** P1-High  
**Status:** NEW

### Violation
```sql
ai_advisory_artifact_id uuid references ai_advisory_artifacts(id),
-- NO INDEX - table will have millions of rows
```

### SQL Fix
```sql
CREATE INDEX idx_content_genesis_artifact ON content_genesis(ai_advisory_artifact_id);
```

---

## P1-002: Missing GIN Indexes on content_ideas JSONB (PARTIALLY FIXED)
**File:** packages/db/migrations/20260228_add_analytics_tables.sql:97-98  
**Severity:** P1-High  
**Status:** PARTIALLY FIXED

### Violation
```sql
suggested_outline JSONB,  -- GIN index added in fix migration
competitive_analysis JSONB,  -- GIN index added in fix migration
-- BUT: No size limits or constraints
```

### SQL Fix
```sql
-- Add size limits for large JSONB columns
ALTER TABLE content_ideas 
  ADD CONSTRAINT check_outline_size 
  CHECK (pg_column_size(suggested_outline) < 100000);  -- 100KB max

ALTER TABLE content_ideas 
  ADD CONSTRAINT check_competitive_analysis_size 
  CHECK (pg_column_size(competitive_analysis) < 200000);  -- 200KB max
```

---

## P1-003: ContentRevisionRepository Uses Pool Instead of Client Parameter (NEW)
**File:** domains/content/infra/persistence/PostgresContentRevisionRepository.ts:18  
**Severity:** P1-High  
**Status:** NEW

### Violation
```typescript
// Constructor only takes pool - no transaction support!
constructor(private pool: Pool) {}

async add(rev: ContentRevision): Promise<void> {
  // Always uses pool - cannot participate in transaction
  await this.pool.query(...);
}
```

Unlike PostgresContentRepository, this doesn't accept optional client parameter.

### Fix
```typescript
constructor(private pool: Pool) {}

private getQueryable(client?: PoolClient): Pool | PoolClient {
  return client || this.pool;
}

async add(rev: ContentRevision, client?: PoolClient): Promise<void> {
  const queryable = this.getQueryable(client);
  await queryable.query(...);
}
```

---

## P1-004: Batch Save No Partial Success Recovery (NEW)
**File:** domains/content/infra/persistence/PostgresContentRepository.ts:400-447  
**Severity:** P1-High  
**Status:** NEW

### Violation
```typescript
private async executeBatchSave(...): Promise<{ saved: number; failed: number; errors: string[] }> {
  try {
    await client.query(
      `INSERT ... UNNEST ...`,  // Single INSERT
    );
    return { saved: items.length, failed: 0, errors: [] };  // All succeed or all fail
  } catch (error) {
    return { saved: 0, failed: items.length, errors: [errorMessage] };  // ALL fail!
  }
}
```

One bad record fails entire batch.

### Fix
```typescript
private async executeBatchSave(
  items: ContentItem[],
  client: PoolClient
): Promise<{ saved: number; failed: number; errors: Array<{ item: string; error: string }> }> {
  const errors: Array<{ item: string; error: string }> = [];
  let saved = 0;
  
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
  
  return { saved, failed: errors.length, errors };
}
```

---

## P1-005: Missing Index on domain_id for domain_sale_readiness (NEW)
**File:** packages/db/migrations/20260515_domain_sale_readiness.sql  
**Severity:** P1-High  
**Status:** NEW

### Violation
```sql
CREATE TABLE domain_sale_readiness (
  id uuid primary key default gen_random_uuid(),
  domain_id uuid not null,  -- High cardinality, queried frequently
  -- ...
  -- NO INDEX on domain_id!
);
```

### SQL Fix
```sql
CREATE INDEX idx_domain_sale_readiness_domain ON domain_sale_readiness(domain_id);
```

---

## P1-006: Missing Read Replica Lag Validation (NOT FIXED)
**File:** apps/api/src/db.ts:310-352  
**Severity:** P1-High  
**Status:** UNFIXED

### Violation
```typescript
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

---

## P1-007: Missing Connection Validation Before Use (NOT FIXED)
**File:** apps/web/lib/db.ts:51-59  
**Severity:** P1-High  
**Status:** UNFIXED

### Violation
```typescript
poolInstance = new Pool({
  // ...
  // NO validateConnection or testOnBorrow!
});
```

Stale connections after network blip cause query failures.

### Fix
```typescript
poolInstance = new Pool({
  connectionString,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  max: 20,
  min: 2,
  // Add connection validation
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

// Validate on connect
poolInstance.on('connect', async (client) => {
  try {
    await client.query('SELECT 1');
  } catch (err) {
    logger.error('New connection validation failed', err as Error);
    client.release(err as Error);
  }
});
```

---

## P1-008: Repository Methods Don't Share Transaction Context (NEW)
**File:** domains/search/application/SearchIndexingWorker.ts:72-170  
**Severity:** P1-High  
**Status:** NEW

### Violation
```typescript
const client = await this.pool.connect();
await client.query('BEGIN');

const job = await this.jobs.getById(jobId);  // Uses different connection!

await this.jobs.save(processingJob);  // May use different connection!

// Transaction context lost between repository calls
```

The repository doesn't accept client parameter for transaction propagation.

### Fix
```typescript
// In repository
async getById(id: string, client?: PoolClient): Promise<Job | null> {
  const queryable = client || this.pool;
  const { rows } = await queryable.query(...);
  return mapRowToJob(rows[0]);
}

// In worker
await withTransaction(async (client) => {
  const job = await this.jobs.getById(jobId, client);  // Same transaction
  await this.jobs.save(processingJob, client);  // Same transaction
});
```

---

## P1-009: Analytics DB Fallback Silent in Production (NOT FIXED)
**File:** apps/api/src/db.ts:387-391  
**Severity:** P1-High  
**Status:** UNFIXED

### Violation
```typescript
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

---

## P1-010: No Query Plan Capture for Slow Queries (NOT FIXED)
**File:** apps/web/lib/db.ts:354-358  
**Severity:** P1-High  
**Status:** UNFIXED

### Violation
```typescript
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

---

## P1-011: Irreversible Migration Pattern (NEW)
**File:** packages/db/migrations/20260227_add_content_archive_tables.sql:39-91  
**Severity:** P1-High  
**Status:** NEW

### Violation
```sql
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'content_items') THEN
    ALTER TABLE content_items ADD COLUMN archived_at TIMESTAMP;  -- NO ROLLBACK IF NEXT FAILS
    ALTER TABLE content_items ADD COLUMN restored_at TIMESTAMP;
    -- ... 8 more ALTER statements
  END IF;
END $$;
-- No transaction wrapper!
```

If migration fails mid-way, database is in inconsistent state.

### Fix
```sql
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

---

# P2-MEDIUM FINDINGS

## P2-001: Missing NOT NULL on llm_task_preferences Foreign Key (NEW)
**File:** packages/db/migrations/20260213_add_llm_task_preferences.sql  
**Severity:** P2-Medium  
**Status:** NEW

### Violation
```sql
llm_model_id uuid references llm_models(id),  -- No ON DELETE, nullable
```

### SQL Fix
```sql
ALTER TABLE llm_task_preferences 
  DROP CONSTRAINT IF EXISTS llm_task_preferences_llm_model_id_fkey,
  ADD CONSTRAINT llm_task_preferences_llm_model_id_fkey 
  FOREIGN KEY (llm_model_id) REFERENCES llm_models(id) ON DELETE SET NULL;
```

---

## P2-002: Missing Index on job_executions.entity_id Type Mismatch (NEW)
**File:** packages/db/migrations/20260310_job_executions.sql:4  
**Severity:** P2-Medium  
**Status:** NEW

### Violation
```sql
entity_id uuid,  -- Nullable, no index until line 12
```

### SQL Fix
```sql
-- Add index for entity lookups (already present but verify)
CREATE INDEX IF NOT EXISTS idx_job_exec_entity ON job_executions(entity_id) 
WHERE entity_id IS NOT NULL;
```

---

## P2-003: Missing Row-Level Security Policies (NOT FIXED)
**File:** Multiple tables  
**Severity:** P2-Medium  
**Status:** UNFIXED

### Violation
No RLS enabled on any table despite multi-tenant architecture.

### SQL Fix
```sql
-- Enable RLS on sensitive tables
ALTER TABLE human_intents ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their tenant's data
CREATE POLICY tenant_isolation ON human_intents
  USING (tenant_id = current_setting('app.current_tenant')::UUID);

-- Bypass for admin roles
CREATE POLICY admin_full_access ON human_intents
  USING (current_setting('app.is_admin')::BOOLEAN);
```

---

## P2-004: Missing Compression Settings for Large JSONB (NOT FIXED)
**File:** packages/db/migrations/20260621_advisor_snapshots.sql  
**Severity:** P2-Medium  
**Status:** UNFIXED

### Violation
```sql
snapshot jsonb not null,  -- Unbounded size, no TOAST settings
```

### SQL Fix
```sql
-- Enable TOAST compression for large JSONB
ALTER TABLE advisor_snapshots 
  ALTER COLUMN snapshot SET STORAGE EXTENDED;

-- Add size limit
ALTER TABLE advisor_snapshots 
  ADD CONSTRAINT check_snapshot_size 
  CHECK (pg_column_size(snapshot) < 500000);  -- 500KB max
```

---

## P2-005: BIGINT Primary Key Without Sequence Monitoring (NOT FIXED)
**File:** packages/db/migrations/20260228_add_analytics_tables.sql  
**Severity:** P2-Medium  
**Status:** UNFIXED

### Violation
```sql
CREATE TABLE keyword_metrics (
  id BIGSERIAL PRIMARY KEY,  -- Can exhaust 64-bit space
);
```

### SQL Fix
```sql
-- Add monitoring view
CREATE OR REPLACE VIEW sequence_usage_monitor AS
SELECT 
  schemaname, sequencename, 
  last_value,
  CASE 
    WHEN last_value > 9223372036854775807 * 0.8 THEN 'CRITICAL'
    WHEN last_value > 9223372036854775807 * 0.5 THEN 'WARNING'
    ELSE 'OK'
  END as status
FROM pg_sequences 
WHERE sequencename LIKE '%_id_seq';
```

---

## P2-006: Control-Plane Missing Foreign Key Constraints (NOT FIXED)
**File:** control-plane/db/migrations/002_domains_org.sql  
**Severity:** P2-Medium  
**Status:** UNFIXED

### Violation
```sql
-- domain_registry has org_id but no FK enforcement for related tables
-- No FK from domains to domain_registry
-- No FK from content to domains
```

### SQL Fix
```sql
-- Add FK constraints (may require data cleanup first)
ALTER TABLE domains 
ADD CONSTRAINT fk_domains_registry 
FOREIGN KEY (id) REFERENCES domain_registry(id);

-- Validate existing data before adding constraint
ALTER TABLE content_items 
VALIDATE CONSTRAINT fk_content_items_domain;
```

---

# P3-LOW FINDINGS

1. **P3-001:** Table names inconsistent (snake_case vs camelCase in code references)
2. **P3-002:** Column order not optimized (frequently accessed columns not first)
3. **P3-003:** No BRIN indexes for time-series data (keyword_metrics, social_metrics)
4. **P3-004:** Missing fillfactor tuning for update-heavy tables

---

# SUMMARY OF FIX STATUS

## Previously Fixed (From Earlier Audit)
| Issue | File | Status |
|-------|------|--------|
| ON DELETE CASCADE | Multiple | FIXED via 20260210_fix_foreign_key_cascade.sql |
| Soft delete unique index | email_subscribers | FIXED via 20260210_fix_email_subscribers_soft_delete.sql |
| GIN indexes | JSONB columns | FIXED via 20260210_add_jsonb_gin_indexes.sql |
| Timestamp timezone | Analytics tables | FIXED via 20260210_fix_analytics_timestamp_timezone.sql |
| Connection timeouts | apps/api/src/db.ts | FIXED - statement_timeout and idle_in_transaction_session_timeout added |

## Remaining Critical Issues
| Issue | Count | Priority |
|-------|-------|----------|
| Unbounded OFFSET pagination | 12 occurrences | P0 - Implement cursor pagination |
| N+1 query patterns | 3 workers | P0 - Add batch methods |
| Missing lock_timeout | 2 files | P0 - Add to transaction helpers |
| TIMESTAMP without timezone | 1 migration | P0 - Add migration to fix |
| Seed file transaction safety | 1 file | P0 - Wrap in transaction |
| Missing FK ON DELETE | 2 tables | P0 - Add constraints |
| Repository transaction support | 2 repositories | P1 - Add client parameter |
| Connection pool validation | 1 file | P1 - Add validation |
| RLS policies | All tables | P2 - Enable RLS |

---

# IMMEDIATE ACTION PLAN

## Today (P0 Fixes)
1. Add lock_timeout to apps/web/lib/db.ts withTransaction
2. Create migration to fix content_archive timestamp types
3. Add ON DELETE actions for affiliate_links table
4. Wrap seed file in transaction with idempotency

## This Week (P0/P1 Fixes)
1. Implement cursor-based pagination for all list methods
2. Add batch processing methods for workers
3. Add connection validation and replica lag checks
4. Fix repository transaction propagation

## Next Week (P1/P2 Fixes)
1. Enable Row-Level Security on all tenant tables
2. Add size constraints for large JSONB columns
3. Add sequence monitoring for BIGSERIAL tables
4. Add query plan capture for slow queries

---

**END OF FRESH HOSTILE AUDIT**

*This audit was conducted with hostile intent to expose all potential failure modes. Every finding should be treated as a production risk until remediated.*
