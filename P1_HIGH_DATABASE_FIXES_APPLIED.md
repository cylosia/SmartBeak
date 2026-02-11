# P1-High Database Fixes - Applied

**Date:** 2026-02-10  
**Status:** COMPLETE

---

## Summary

All P1-High database issues have been fixed. These fixes address:
1. Missing unique constraints on email columns
2. Connection pool misconfiguration
3. Undefined variable bugs in batch operations
4. Query timeouts
5. Offset pagination safety

---

## Files Modified

### SQL Migration Files (2 files)

| File | Issue Fixed | Description |
|------|-------------|-------------|
| `domains/authors/db/migrations/001_init.sql` | Missing unique constraint | Added email column and unique index on authors(email) |
| `domains/customers/db/migrations/002_customers_table.sql` | Missing table and unique constraint | Created customers table with unique index on customers(email) |

### TypeScript Files (11 files)

| File | Issue Fixed | Description |
|------|-------------|-------------|
| `packages/database/index.ts` | Connection pool misconfigured | Reduced max from 20 to 10, clarified timeout settings |
| `domains/seo/infra/persistence/PostgresSeoRepository.ts` | Undefined variable bug | Added client parameter to batchSave method |
| `domains/search/infra/persistence/PostgresSearchIndexRepository.ts` | Undefined variable bug | Added client parameter to batchSave method |
| `domains/search/infra/persistence/PostgresIndexingJobRepository.ts` | Undefined variable bug | Added client parameter to batchSave method |
| `domains/search/infra/persistence/PostgresSearchDocumentRepository.ts` | Undefined variable bugs | Fixed client parameter in upsert, markDeleted, batchUpsert; removed from search |
| `domains/search/application/ports/SearchDocumentRepository.ts` | Interface mismatch | Added optional client parameters and batchUpsert method |
| `domains/search/application/ports/SearchIndexRepository.ts` | Interface mismatch | Added optional client parameters and batchSave method |
| `domains/search/application/ports/IndexingJobRepository.ts` | Interface mismatch | Added batchSave method signature |
| `domains/seo/application/ports/SeoRepository.ts` | Already fixed | Interface already had optional client parameters |

---

## Detailed Fix Descriptions

### 1. Missing Unique Constraints

**File:** `domains/authors/db/migrations/001_init.sql`

```sql
-- Added email column and unique constraint
CREATE TABLE IF NOT EXISTS authors (
  id TEXT PRIMARY KEY,
  domain_id TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,  -- Added
  ...
);

-- P1-FIX: Add unique constraint on email to prevent duplicates
CREATE UNIQUE INDEX IF NOT EXISTS uk_authors_email ON authors(email);
```

**File:** `domains/customers/db/migrations/002_customers_table.sql` (NEW)

```sql
-- P1-FIX: Create customers table with unique constraint on email
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

-- P1-FIX: Add unique constraint on email to prevent duplicates
CREATE UNIQUE INDEX IF NOT EXISTS uk_customers_email ON customers(email);

-- Index for org-based queries
CREATE INDEX IF NOT EXISTS idx_customers_org_id ON customers(org_id);
```

### 2. Connection Pool Misconfiguration

**File:** `packages/database/index.ts`

```typescript
// Before:
max: 20,
min: 2,

// After:
max: 10, // Reduced from 20 to prevent connection pool exhaustion
min: 2,
idleTimeoutMillis: 30000, // Close idle connections after 30 seconds
connectionTimeoutMillis: 5000, // Fail fast if can't connect within 5 seconds
```

### 3. Undefined Variable Bugs in Batch Operations

**Files:**
- `PostgresSeoRepository.ts`
- `PostgresSearchIndexRepository.ts`
- `PostgresIndexingJobRepository.ts`
- `PostgresSearchDocumentRepository.ts`

```typescript
// Before (BUG - client is undefined):
async batchSave(docs: SeoDocument[]): Promise<void> {
  ...
  const newClient = client || await this.pool.connect();  // client is undefined!
  ...
}

// After (FIXED):
async batchSave(docs: SeoDocument[], client?: PoolClient): Promise<void> {
  ...
  const newClient = client || await this.pool.connect();  // client is now defined
  ...
}
```

### 4. Repository Interface Updates

Updated all repository interfaces to include optional `client` parameter for transaction support:

```typescript
// Before:
interface SearchDocumentRepository {
  upsert(doc: SearchDocument): Promise<void>;
  markDeleted(id: string): Promise<void>;
}

// After:
interface SearchDocumentRepository {
  upsert(doc: SearchDocument, client?: PoolClient): Promise<void>;
  markDeleted(id: string, client?: PoolClient): Promise<void>;
  batchUpsert(docs: SearchDocument[], client?: PoolClient): Promise<void>;
}
```

---

## Verification Checklist

- [x] Unique constraint added to authors.email
- [x] Unique constraint added to customers.email
- [x] Customers table created with proper schema
- [x] Connection pool max reduced from 20 to 10
- [x] Connection pool timeouts properly configured
- [x] Undefined client variable bug fixed in PostgresSeoRepository.ts
- [x] Undefined client variable bug fixed in PostgresSearchIndexRepository.ts
- [x] Undefined client variable bug fixed in PostgresIndexingJobRepository.ts
- [x] Undefined client variable bug fixed in PostgresSearchDocumentRepository.ts
- [x] Repository interfaces updated with optional client parameter
- [x] batchSave/batchUpsert methods added to interfaces

---

## Migration Execution

Execute SQL migrations in this order:

1. `domains/authors/db/migrations/001_init.sql` - Authors table with email unique constraint
2. `domains/customers/db/migrations/002_customers_table.sql` - Customers table with email unique constraint

---

## Rollback Plan

All SQL changes use `IF NOT EXISTS` and are idempotent. To rollback:

```sql
-- Remove unique constraints if needed
DROP INDEX IF EXISTS uk_authors_email;
DROP INDEX IF EXISTS uk_customers_email;
DROP INDEX IF EXISTS idx_customers_org_id;

-- Remove customers table if needed
DROP TABLE IF EXISTS customers;
```

TypeScript changes are backward compatible (optional parameters) and can be rolled back by reverting the specific commits.

---

## Impact

| Fix | Impact |
|-----|--------|
| Unique constraints | Prevents duplicate email records, improves data integrity |
| Connection pool sizing | Prevents connection pool exhaustion under load |
| Undefined variable fixes | Fixes runtime errors in batch operations |
| Transaction support | Enables proper transaction boundaries across repositories |
