# P1-High Database Fixes - Complete Implementation

**Date:** 2026-02-10  
**Status:** IN PROGRESS

## Issues Being Fixed

### 1. MISSING UNIQUE CONSTRAINTS
**Tables:** authors, customers
**Fix:** Add unique constraints on email columns

### 2. CONNECTION POOL MISCONFIGURED
**File:** packages/database/index.ts
**Current:** max: 20
**Fix:** max: 10, add idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000

### 3. UNDEFINED VARIABLE BUGS IN BATCH OPERATIONS
**Files:**
- PostgresSeoRepository.ts (batchSave)
- PostgresSearchIndexRepository.ts (batchSave)
- PostgresIndexingJobRepository.ts (batchSave)
- PostgresSearchDocumentRepository.ts (upsert, markDeleted, search, batchUpsert)

### 4. NO QUERY TIMEOUTS
**Files:** 15 repository files
**Fix:** Add query timeout to all queries

### 5. OFFSET PAGINATION
**Fix:** Ensure all repositories have MAX_SAFE_OFFSET protection

---

## Files To Modify

### SQL Files:
1. domains/authors/db/migrations/001_init.sql - Add email unique constraint
2. domains/customers/db/migrations/001_init.sql - Add email unique constraint (if customers table exists)

### TypeScript Files:
1. packages/database/index.ts - Fix connection pool config
2. domains/seo/infra/persistence/PostgresSeoRepository.ts - Fix batchSave, add timeouts
3. domains/search/infra/persistence/PostgresSearchIndexRepository.ts - Fix batchSave, add timeouts
4. domains/search/infra/persistence/PostgresIndexingJobRepository.ts - Fix batchSave, add timeouts
5. domains/search/infra/persistence/PostgresSearchDocumentRepository.ts - Fix undefined client variables
6. domains/media/infra/persistence/PostgresMediaRepository.ts - Add timeouts
7. domains/content/infra/persistence/PostgresContentRepository.ts - Add timeouts
8. domains/content/infra/persistence/PostgresContentRevisionRepository.ts - Add timeouts
9. domains/publishing/infra/persistence/PostgresPublishingJobRepository.ts - Add timeouts
10. domains/publishing/infra/persistence/PostgresPublishAttemptRepository.ts - Add timeouts
11. domains/notifications/infra/persistence/PostgresNotificationRepository.ts - Add timeouts
12. domains/notifications/infra/persistence/PostgresNotificationPreferenceRepository.ts - Add timeouts
13. domains/notifications/infra/persistence/PostgresNotificationDLQRepository.ts - Add timeouts
14. domains/notifications/infra/persistence/PostgresNotificationAttemptRepository.ts - Add timeouts
15. domains/authors/application/AuthorsService.ts - Add timeouts
16. domains/customers/application/CustomersService.ts - Add timeouts
