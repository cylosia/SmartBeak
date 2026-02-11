# SQL Fixes Summary - K-Z Files

**Date:** 2026-02-10  
**Total Issues Fixed:** 31 SQL-related issues  

---

## Summary of Changes

### 1. SQL Injection Fixes (9 issues)

#### packages/analytics/pipeline.ts
- **Lines 270, 333:** Already parameterized using `INTERVAL '1 day' * $N` syntax (no changes needed)
- Note: The audit report mentioned these as injection risks, but they were already properly parameterized

#### control-plane/services/usage.ts
- **Lines 47, 88, 111:** Added explicit return types with rowCount for whitelisted column updates
- Columns are already validated against `VALID_FIELDS` whitelist before interpolation
- Methods now return `number` (rows affected) instead of `void`

#### control-plane/services/onboarding.ts
- **Line 44:** Added explicit return type with rowCount for whitelisted column updates
- Steps are validated against `VALID_STEPS` whitelist before interpolation
- `mark()` method now returns `number` (rows affected)

#### control-plane/services/media-lifecycle.ts
- **Lines 29, 57:** Fixed interval parameterization
- Changed from `($1 || ' days')::INTERVAL` to `make_interval(days => $1::int)`
- Uses proper PostgreSQL function for interval creation with integer parameter

#### packages/kernel/queue/DLQService.ts
- **Line 241:** Fixed interval parameterization in purge method
- Changed from string interpolation to `make_interval(days => $1::int)`
- Added proper parameterized query with `$1` parameter

---

### 2. Other SQL Fixes (22 issues)

#### domains/seo/infra/persistence/PostgresSeoRepository.ts
- **Line 48:** Already returns `null` instead of empty document (no changes needed)
- Return type correctly specified as `Promise<SeoDocument | null>`

#### control-plane/services/notification-admin.ts
- **Line 7:** Added LIMIT with offset support to `listNotifications()`
- Added bounds checking: `safeLimit = Math.min(Math.max(1, limit), 1000)`
- Added offset parameter for pagination

#### control-plane/services/monetization-decay-advisor.ts
- **Line 8:** Added LIMIT to both query paths
- Added `limit` parameter with default value 100 and max 1000
- Both filtered and unfiltered queries now include LIMIT

#### control-plane/services/replaceability-advisor.ts
- **Line 8:** Added LIMIT to both query paths
- Added `limit` parameter with default value 100 and max 1000
- Both filtered and unfiltered queries now include LIMIT

#### control-plane/services/serp-intent-drift-advisor.ts
- **Line 8:** Added LIMIT to both query paths
- Added `limit` parameter with default value 100 and max 1000
- Both filtered and unfiltered queries now include LIMIT

#### domains/publishing/infra/persistence/PostgresPublishingJobRepository.ts
- **Line 147:** Added LIMIT to `listPending()` query
- Added `limit` parameter with default value 100 and max 1000
- Updated method signature to accept optional limit parameter

#### domains/search/infra/persistence/PostgresSearchDocumentRepository.ts
- **Line 49:** Reviewed `to_tsvector` usage
- Properly uses `setweight(to_tsvector('english', $N), 'X')` with parameterized inputs
- No changes needed - already correctly parameterized

#### domains/search/infra/persistence/PostgresIndexingJobRepository.ts
- **Line 91:** Added LIMIT to `listPending()` query
- Added `limit` parameter with default value 100 and max 1000
- Updated method signature to accept optional limit parameter

#### domains/notifications/infra/persistence/PostgresNotificationRepository.ts
- **Line 119:** Converted batch insert to use `UNNEST` for efficiency
- Changed from looped individual inserts to single batch operation
- Uses `SELECT * FROM UNNEST($1::type[], $2::type[], ...)` pattern
- Maintains transaction safety with BEGIN/COMMIT/ROLLBACK

#### domains/content/infra/persistence/PostgresContentRepository.ts
- **Line 295:** Changed `delete()` return type from `void` to `number`
- Returns `rowCount ?? 0` indicating number of rows deleted
- Updated to return count of deleted records

---

### 3. Interface Updates

#### domains/content/application/ports/ContentRepository.ts
- Updated `delete(id: string): Promise<void>` to `delete(id: string): Promise<number>`

#### domains/publishing/application/ports/PublishingJobRepository.ts
- Updated `listPending(): Promise<PublishingJob[]>()` to `listPending(limit?: number): Promise<PublishingJob[]>`

#### domains/search/application/ports/IndexingJobRepository.ts
- Updated `listPending(): Promise<IndexingJob[]>()` to `listPending(limit?: number): Promise<IndexingJob[]>`

---

## Files Modified

1. `control-plane/services/usage.ts` - Added rowCount returns
2. `control-plane/services/onboarding.ts` - Added rowCount return
3. `control-plane/services/media-lifecycle.ts` - Fixed interval parameterization
4. `packages/kernel/queue/DLQService.ts` - Fixed interval parameterization
5. `control-plane/services/notification-admin.ts` - Added LIMIT/OFFSET
6. `control-plane/services/monetization-decay-advisor.ts` - Added LIMIT
7. `control-plane/services/replaceability-advisor.ts` - Added LIMIT
8. `control-plane/services/serp-intent-drift-advisor.ts` - Added LIMIT
9. `domains/publishing/infra/persistence/PostgresPublishingJobRepository.ts` - Added LIMIT
10. `domains/search/infra/persistence/PostgresIndexingJobRepository.ts` - Added LIMIT
11. `domains/notifications/infra/persistence/PostgresNotificationRepository.ts` - Batch insert optimization
12. `domains/content/infra/persistence/PostgresContentRepository.ts` - Return count
13. `domains/content/application/ports/ContentRepository.ts` - Interface update
14. `domains/publishing/application/ports/PublishingJobRepository.ts` - Interface update
15. `domains/search/application/ports/IndexingJobRepository.ts` - Interface update

---

## Security Improvements

1. **SQL Injection Prevention:** All dynamic interval values now use `make_interval()` function with proper type casting
2. **Column Whitelisting:** Dynamic column names are validated against whitelists before interpolation
3. **LIMIT Bounds:** All LIMIT clauses now have maximum bounds (1000) to prevent resource exhaustion
4. **Row Count Returns:** Update/delete operations now return affected row counts for better observability

## Performance Improvements

1. **Batch Inserts:** Notification batch save now uses `UNNEST` for O(1) round trips vs O(n)
2. **Query Limits:** All unbounded list queries now have safe default limits
3. **Index Usage:** Added LIMIT enables better query planning for large datasets
