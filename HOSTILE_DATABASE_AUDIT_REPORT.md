# HOSTILE DATABASE AUDIT REPORT
## SmartBeak - Financial-Grade Security Assessment
**Date:** 2026-02-10  
**Auditor:** Hostile Database Audit Bot  
**Classification:** CRITICAL - IMMEDIATE ACTION REQUIRED

---

## EXECUTIVE SUMMARY

This audit assumes **EVERY transaction is wrong** and **EVERY query is vulnerable**. The codebase has been subjected to hostile analysis focusing on financial-grade database integrity issues.

### Critical Findings Summary
| Severity | Count | Categories |
|----------|-------|------------|
| P0-CRITICAL | 5 | Data Loss, Deadlocks, Security |
| P1-HIGH | 12 | Performance, Consistency |
| P2-MEDIUM | 8 | Maintainability, Monitoring |

---

## P0-CRITICAL ISSUES (Fix Immediately)

### 1. UNDEFINED VARIABLE REFERENCE - RUNTIME CRASH
**File:** `domains/media/infra/persistence/PostgresMediaRepository.ts`  
**Lines:** 27, 59, 105, 162, 222  
**Severity:** P0-CRITICAL

```typescript
// Line 27 - getById method
const queryable = this.getQueryable(client);  // ERROR: 'client' is not defined

// Line 59 - save method  
const queryable = this.getQueryable(client);  // ERROR: 'client' is not defined

// Line 105 - listByStatus method
const queryable = this.getQueryable(client);  // ERROR: 'client' is not defined

// Line 162 - batchSave method
if (client) {  // ERROR: 'client' is not defined

// Line 222 - delete method
const queryable = this.getQueryable(client);  // ERROR: 'client' is not defined
```

**Impact:** Runtime ReferenceError crashes on ALL database operations.  
**Fix:** Add optional `client` parameter to all methods:
```typescript
async getById(id: string, client?: PoolClient): Promise<MediaAsset | null> {
  // ...
}

async save(asset: MediaAsset, client?: PoolClient): Promise<void> {
  // ...
}
```

---

### 2. COMMENTED-OUT IMPORTS BREAK PRODUCTION
**File:** `control-plane/services/repository-factory.ts`  
**Lines:** 1-14  
**Severity:** P0-CRITICAL

```typescript
/**
import { LRUCache } from 'lru-cache';  // COMMENTED OUT
import { Pool } from 'pg';              // COMMENTED OUT

import { getLogger } from '@kernel/logger';  // COMMENTED OUT

import { PostgresContentRepository } from '../../domains/content/infra/persistence/PostgresContentRepository';  // COMMENTED OUT
import { PostgresContentRevisionRepository } from '../../domains/content/infra/persistence/PostgresContentRevisionRepository';  // COMMENTED OUT
import { resolveDomainDb } from './domain-registry';  // COMMENTED OUT
* Repository Factory
* Provides singleton instances of repositories with connection pooling
*/
```

**Impact:** File will fail to compile or crash at runtime when imports are referenced.  
**Fix:** Remove the comment block:
```typescript
import { LRUCache } from 'lru-cache';
import { Pool } from 'pg';
import { getLogger } from '@kernel/logger';
import { PostgresContentRepository } from '../../domains/content/infra/persistence/PostgresContentRepository';
import { PostgresContentRevisionRepository } from '../../domains/content/infra/persistence/PostgresContentRevisionRepository';
import { resolveDomainDb } from './domain-registry';
```

---

### 3. MISSING ON DELETE CASCADE - ORPHANED DATA
**File:** `packages/db/migrations/20260214_add_affiliate_links.sql`  
**Line:** 5  
**Severity:** P0-CRITICAL

```sql
create table if not exists affiliate_links (
  id uuid primary key default gen_random_uuid(),
  affiliate_offer_id uuid references affiliate_offers(id) ON DELETE CASCADE,
  content_version_id uuid,  -- MISSING FK CONSTRAINT
  -- ...
);
```

**Impact:** `content_version_id` has no foreign key constraint - orphaned records on content deletion.  
**Fix:**
```sql
ALTER TABLE affiliate_links 
  ADD CONSTRAINT fk_affiliate_links_content_version 
  FOREIGN KEY (content_version_id) REFERENCES content_versions(id) ON DELETE CASCADE;
```

---

### 4. TIMESTAMP WITHOUT TIMEZONE - DATA CORRUPTION
**File:** `packages/db/migrations/20260228_add_analytics_tables.sql`  
**Lines:** 17-18, 42-43, 63-64, 81, 100-101, 118, 134  
**Severity:** P0-CRITICAL

```sql
-- Multiple tables affected
CREATE TABLE IF NOT EXISTS keyword_metrics (
  -- ...
  timestamp TIMESTAMP NOT NULL DEFAULT NOW(),  -- NO TIMEZONE!
  created_at TIMESTAMP DEFAULT NOW()           -- NO TIMEZONE!
);
```

**Impact:** Timezone ambiguity causes data corruption during daylight saving transitions, server migrations, or multi-region deployments.  
**Fix:** Migration already exists in `20260210_fix_analytics_timestamp_timezone.sql` - ensure it has been applied.

---

### 5. DEADLOCK RISK - MISSING FOR UPDATE
**File:** `domains/publishing/application/PublishingService.ts`  
**Lines:** 83-110  
**Severity:** P0-CRITICAL

```typescript
await client.query('BEGIN');

// Verify target exists - NO LOCK!
const target = await this.targets.getById(targetId);
if (!target) {
  await client.query('ROLLBACK');
  return { success: false, error: `Publish target '${targetId}' not found` };
}

// Verify target belongs to domain - NO LOCK!
if (target.domainId !== domainId) {
  await client.query('ROLLBACK');
  return { success: false, error: 'Target does not belong to the specified domain' };
}

// Create job
const job = PublishingJob.create({/* ... */});
await this.jobs.save(job);  // Race condition possible here

await client.query('COMMIT');
```

**Impact:** Concurrent publishing requests can create duplicate jobs or violate domain constraints.  
**Fix:**
```typescript
await client.query('BEGIN');

// Lock target for update
const target = await this.targets.getById(targetId, client, { forUpdate: true });
// ... rest of transaction
```

---

## P1-HIGH ISSUES

### 6. UNBOUNDED CONCURRENCY - CONNECTION POOL EXHAUSTION
**File:** `control-plane/services/keyword-ingestion.ts`  
**Lines:** 108-119  
**Severity:** P1-HIGH

```typescript
async function batchInsertSuggestions(
  db: Database,
  suggestions: KeywordSuggestion[],
  domainId: string,
  source: string,
  jobId: string,
  batchSize = 100
): Promise<void> {
  for (let i = 0; i < suggestions.length; i += batchSize) {
    const batch = suggestions.slice(i, i + batchSize);
    await Promise.all(  // UNBOUNDED CONCURRENCY!
      batch.map(s => db.keyword_suggestions.insert({
        domain_id: domainId,
        keyword: s.keyword,
        source: source,
        metrics: s.metrics,
        ingestion_job_id: jobId
      }))
    );
  }
}
```

**Impact:** Promise.all with 100 concurrent DB operations can exhaust connection pool.  
**Fix:**
```typescript
import { withConcurrencyLimit } from '@kernel/concurrency';

await withConcurrencyLimit(
  batch.map(s => () => db.keyword_suggestions.insert({...})),
  10  // Max 10 concurrent
);
```

---

### 7. N+1 QUERY PATTERN - PERFORMANCE KILLER
**File:** `domains/notifications/application/NotificationPreferenceService.ts`  
**Line:** 170  
**Severity:** P1-HIGH

```typescript
// Fallback: Use Promise.all for parallel execution
await Promise.all(updated.map((pref) => this.repo.upsert(pref)));
```

**Impact:** Each preference triggers a separate database round-trip. With 100 preferences = 100 queries.  
**Fix:** Use batch insert with unnest pattern (already implemented in other repositories).

---

### 8. MISSING COMPOSITE INDEX - SEQUENTIAL SCAN
**File:** `packages/db/migrations/20260228_add_analytics_tables.sql`  
**Table:** `keyword_metrics`  
**Severity:** P1-HIGH

```sql
CREATE INDEX IF NOT EXISTS idx_keyword_metrics_domain_keyword 
ON keyword_metrics(domain_id, keyword, timestamp DESC);
```

**Issue:** Missing index for common query pattern: `WHERE domain_id = $1 AND timestamp > $2`  
**Fix:**
```sql
CREATE INDEX idx_keyword_metrics_domain_timestamp 
ON keyword_metrics(domain_id, timestamp DESC);
```

---

### 9. TRANSACTION BOUNDARY VIOLATION - READ OUTSIDE TX
**File:** `domains/publishing/application/PublishingService.ts`  
**Line:** 83  
**Severity:** P1-HIGH

```typescript
await client.query('BEGIN');

// This read should be inside transaction but uses pool directly
const target = await this.targets.getById(targetId);  // POTENTIAL STALE READ

await client.query('COMMIT');
```

**Impact:** Target could be modified between read and transaction commit.  
**Fix:** Pass client to repository methods:
```typescript
const target = await this.targets.getById(targetId, client);
```

---

### 10. SQL INJECTION VECTOR - DYNAMIC TABLE NAMES
**File:** `apps/api/src/jobs/domainExportJob.ts`  
**Lines:** 225-238  
**Severity:** P1-HIGH

```typescript
const tableName = validateTableName(ALLOWED_TABLES.CONTENT_ITEMS);

let query = db(tableName)  // Dynamic table name
  .select('id', 'title', 'body', 'status')
  .where({ domain_id: domainId })
```

**Impact:** If `validateTableName` is bypassed, SQL injection possible.  
**Mitigation:** Whitelist validation is present but should be hardened:
```typescript
const ALLOWED_TABLES = new Set(['content_items', 'keyword_metrics', ...]);
if (!ALLOWED_TABLES.has(tableName)) {
  throw new Error('Invalid table name');
}
```

---

### 11. MISSING GIN INDEX ON JSONB
**File:** `packages/db/migrations/20260213_add_llm_models.sql`  
**Line:** 6  
**Severity:** P1-HIGH

```sql
create table if not exists llm_models (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  model_identifier text not null,
  modality text not null,
  capabilities jsonb not null,  -- NO GIN INDEX!
  -- ...
);
```

**Impact:** JSONB queries will perform sequential scans.  
**Fix:**
```sql
CREATE INDEX idx_llm_models_capabilities_gin 
ON llm_models USING GIN (capabilities);
```

---

### 12. DEADLOCK RISK - INCONSISTENT LOCK ORDER
**File:** `control-plane/services/domain-ownership.ts`  
**Lines:** 35-79  
**Severity:** P1-HIGH

Multiple transactions lock `domain_registry` and `domain_transfer_log` in different orders:

```typescript
// Transaction 1: Locks domain_registry first
await client.query('SELECT org_id FROM domain_registry WHERE id = $1 FOR UPDATE', [domainId]);
// ... later locks domain_transfer_log

// Transaction 2 (elsewhere): Locks domain_transfer_log first
// This creates deadlock potential
```

**Fix:** Establish global lock hierarchy and document it:
```typescript
// Lock order: domain_registry -> domain_transfer_log -> domain_settings
```

---

### 13. IRREVERSIBLE MIGRATION - NO ROLLBACK
**File:** `packages/db/migrations/20260228_add_analytics_tables.sql`  
**Severity:** P1-HIGH

Migration creates tables without `IF NOT EXISTS` in some sections and lacks down migration.

**Fix:** Always provide down migration:
```sql
-- Up
CREATE TABLE IF NOT EXISTS keyword_metrics (...);

-- Down (in separate file or commented)
-- DROP TABLE IF EXISTS keyword_metrics;
```

---

### 14. CONNECTION POOL MISCONFIGURATION
**File:** `control-plane/services/repository-factory.ts`  
**Lines:** 28-34  
**Severity:** P1-HIGH

```typescript
pool = new Pool({
  connectionString,
  max: 20, // Maximum pool size
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,  // TOO SHORT for production
});
```

**Impact:** 2-second connection timeout causes failures under load.  
**Fix:**
```typescript
connectionTimeoutMillis: 10000,  // 10 seconds minimum
```

---

### 15. MISSING UNIQUE CONSTRAINT - DUPLICATE DATA
**File:** `packages/db/migrations/20260214_add_affiliate_offers.sql`  
**Severity:** P1-HIGH

```sql
create table if not exists affiliate_offers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  domain_id uuid,  -- NO UNIQUE CONSTRAINT on (tenant_id, merchant_name)!
  merchant_name text not null,
  -- ...
);
```

**Impact:** Duplicate affiliate offers for same tenant/merchant.  
**Fix:**
```sql
CREATE UNIQUE INDEX uniq_affiliate_offers_tenant_merchant 
ON affiliate_offers(tenant_id, merchant_name) 
WHERE status = 'active';
```

---

### 16. UNBOUNDED OFFSET PAGINATION - PERFORMANCE DEGRADATION
**File:** `control-plane/services/notification-admin.ts`  
**Line:** 11  
**Severity:** P1-HIGH

```typescript
const { rows } = await this.pool.query(
  `SELECT id, org_id, user_id, channel, template, status, created_at
  FROM notifications ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
  [safeLimit, safeOffset]  // Offset can be very large
);
```

**Impact:** Large offsets cause O(n) scans, killing performance.  
**Fix:** Use cursor-based pagination (already implemented in `apps/api/src/utils/pagination.ts`).

---

### 17. TRANSACTION TIMEOUT NOT SET
**File:** `domains/content/infra/persistence/PostgresContentRepository.ts`  
**Lines:** 391-402  
**Severity:** P1-HIGH

```typescript
const newClient = await this.pool.connect();
try {
  await newClient.query('BEGIN');
  // NO statement_timeout SET!
  const result = await this.executeBatchSave(items, newClient);
  await newClient.query('COMMIT');
}
```

**Impact:** Long-running transactions can hold locks indefinitely.  
**Fix:**
```typescript
await newClient.query('SET LOCAL statement_timeout = 30000'); // 30 seconds
await newClient.query('BEGIN');
```

---

## P2-MEDIUM ISSUES

### 18. MISSING INDEX ON FOREIGN KEY
**File:** `packages/db/migrations/20260220_add_domain_dns_and_transfer.sql`  
**Table:** `domain_transfers`  
**Severity:** P2-MEDIUM

```sql
create table if not exists domain_transfers (
  id uuid primary key default gen_random_uuid(),
  domain_id uuid not null,  -- NO INDEX!
  from_org_id uuid not null,  -- NO INDEX!
  to_org_id uuid,  -- NO INDEX!
  -- ...
);
```

**Fix:**
```sql
CREATE INDEX idx_domain_transfers_domain ON domain_transfers(domain_id);
CREATE INDEX idx_domain_transfers_from_org ON domain_transfers(from_org_id);
CREATE INDEX idx_domain_transfers_to_org ON domain_transfers(to_org_id);
```

---

### 19. BRIN INDEX CANDIDATE MISSED
**File:** `packages/db/migrations/20260228_add_analytics_tables.sql`  
**Table:** `content_performance`  
**Severity:** P2-MEDIUM

Time-series data should use BRIN indexes for space efficiency:

```sql
-- Current B-tree index (large)
CREATE INDEX idx_content_performance_content 
ON content_performance(content_id, timestamp DESC);

-- Better for time-series
CREATE INDEX idx_content_performance_timestamp_brin 
ON content_performance USING BRIN (timestamp);
```

---

### 20. MISSING CHECK CONSTRAINT
**File:** `packages/db/migrations/20260214_add_affiliate_offers.sql`  
**Line:** 10  
**Severity:** P2-MEDIUM

```sql
commission_rate numeric,  -- NO CHECK CONSTRAINT!
```

**Fix:**
```sql
commission_rate numeric CHECK (commission_rate >= 0 AND commission_rate <= 100),
```

---

### 21. SOFT DELETE VIOLATION - UNIQUE INDEX
**File:** `packages/db/migrations/20260610_keywords.sql`  
**Line:** 11  
**Severity:** P2-MEDIUM

```sql
create unique index keywords_domain_norm_idx
  on keywords (domain_id, normalized_phrase);  -- Blocks re-adding deleted keywords!
```

**Fix:** Partial unique index excluding soft deletes:
```sql
CREATE UNIQUE INDEX keywords_domain_norm_idx 
ON keywords (domain_id, normalized_phrase) 
WHERE deleted_at IS NULL;
```

---

### 22. MISSING TABLE COMMENTS
**File:** Multiple migration files  
**Severity:** P2-MEDIUM

Tables lack documentation comments for future maintainers.

**Fix:**
```sql
COMMENT ON TABLE dependency_edges IS 'Asset dependency graph for impact analysis';
```

---

### 23. NO CONNECTION POOL MONITORING
**File:** `apps/api/src/db.ts`  
**Lines:** 121-131  
**Severity:** P2-MEDIUM

```typescript
pool: {
  min: 2,
  max: 20,
  // NO afterCreate hook for validation
  // NO monitoring callbacks
}
```

**Fix:** Add pool monitoring:
```typescript
pool: {
  // ... existing config
  afterCreate: (conn, done) => {
    conn.query('SET timezone = UTC', (err) => done(err, conn));
  }
}
```

---

### 24. PARTIAL RLS POLICY - SECURITY GAP
**File:** `packages/db/migrations/20260228_add_rls_policies.sql`  
**Lines:** 159-172  
**Severity:** P2-MEDIUM

```sql
-- content_genesis has complex nested policy
CREATE POLICY tenant_isolation_genesis ON content_genesis
  USING (
    content_version_id IN (
      SELECT id FROM content_versions WHERE content_id IN (
        SELECT id FROM content_items WHERE domain_id IN (
          SELECT id FROM domains WHERE org_id = current_tenant_id()
        )
      )
    ) OR is_admin_user()
  );
```

**Issue:** Nested subqueries in RLS policies can be bypassed or cause performance issues.  
**Fix:** Use security definer functions or materialized tenant paths.

---

### 25. MISSING RETRY LOGIC
**File:** `domains/media/infra/persistence/PostgresMediaRepository.ts`  
**Lines:** 21-46  
**Severity:** P2-MEDIUM

```typescript
async getById(id: string): Promise<MediaAsset | null> {
  // NO RETRY on transient failures
  const { rows } = await queryable.query(
    `SELECT id, storage_key, mime_type, status FROM media_assets WHERE id = $1`,
    [id]
  );
}
```

**Fix:** Use `withRetry` wrapper from `@kernel/retry`.

---

## AUDIT TRAIL & COMPLIANCE

### Migrations Applied (Corrective)
1. `20260210_fix_foreign_key_cascade.sql` - Added missing CASCADE constraints
2. `20260210_fix_analytics_timestamp_timezone.sql` - Fixed TIMESTAMP -> TIMESTAMPTZ
3. `20260210_add_jsonb_gin_indexes.sql` - Added GIN indexes for JSONB columns
4. `20260228_add_rls_policies.sql` - Added Row Level Security
5. `20260228_fix_content_archive_transaction.sql` - Fixed irreversible migration

### Positive Patterns Observed
- ✅ `ON CONFLICT` upsert pattern used consistently
- ✅ `UNNEST` batch insert pattern in most repositories
- ✅ Pagination limits enforced (`MAX_SAFE_OFFSET = 10000`)
- ✅ `IF NOT EXISTS` used in most migrations
- ✅ Transaction timeout settings in `apps/api/src/db.ts`

---

## REMEDIATION PRIORITY MATRIX

| Priority | Issue | Effort | Risk |
|----------|-------|--------|------|
| 1 | Fix undefined `client` in MediaRepository | 1 hour | Production crash |
| 2 | Uncomment imports in repository-factory | 15 min | Compile failure |
| 3 | Add missing FK constraints | 2 hours | Data integrity |
| 4 | Fix TIMESTAMP columns | 1 hour | Data corruption |
| 5 | Add FOR UPDATE locks | 4 hours | Race conditions |
| 6 | Fix unbounded concurrency | 2 hours | Pool exhaustion |
| 7 | Add missing indexes | 3 hours | Query performance |
| 8 | Fix N+1 queries | 4 hours | Performance |

---

## SIGN-OFF

**This audit was conducted with the assumption that every transaction is wrong and every query is vulnerable.**

The codebase shows evidence of multiple prior audits and fixes (based on FIX comments found), but several critical issues remain that could cause production outages or data corruption.

**Immediate action required on P0 issues before next deployment.**

---

*Report generated by Hostile Database Audit Bot*  
*Classification: FINANCIAL-GRADE CRITICAL*
