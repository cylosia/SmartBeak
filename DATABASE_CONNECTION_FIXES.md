# Database Connection Fragmentation Fixes

## Summary

Fixed database connection fragmentation by consolidating all database access patterns to use the lazy async `getDb()` function instead of direct `db` imports.

## Problem

Three different database access patterns were causing connection pool fragmentation:

1. **apps/api/src/db.ts** - Knex with lazy async `getDb()`
2. **apps/web/lib/db.ts** - pg Pool with `getPool()` + Knex `getDb()`
3. **control-plane/api/http.ts** - Direct `new Pool()` instantiation
4. **apps/api/src/jobs/*.ts** - Direct `db` import without initialization check

## Solution

### 1. Changed all direct `import { db }` to use `getDb()` async function

All files now import `getDb` and call `await getDb()` before database operations.

### 2. Fixed Cross-Imports from web/lib/db in api jobs

Files that were importing from `../../../web/lib/db` now use the local `../db` module.

### 3. Updated Lazy Initialization Pattern

The `apps/api/src/db.ts` already had a proper lazy initialization pattern with `getDb()`. The issue was that many files were importing `db` directly instead of using the async getter.

## Files Modified

### Job Files (apps/api/src/jobs/)

| File | Changes |
|------|---------|
| `domainTransferJob.ts` | Changed to `getDb()`, added `await getDb()` before transaction |
| `domainTransferJob.js` | Changed to `getDb()`, added `await getDb()` before transaction |
| `experimentStartJob.ts` | Changed to `getDb()`, added `await getDb()` before transaction |
| `experimentStartJob.js` | Changed to `getDb()`, added `await getDb()` before transaction |
| `contentIdeaGenerationJob.ts` | Changed to `getDb()`, added `await getDb()` before transaction |
| `contentIdeaGenerationJob.js` | Changed to `getDb()`, added `await getDb()` before transaction |
| `publishExecutionJob.ts` | Changed to `getDb()`, added `await getDb()` before each DB operation |
| `publishExecutionJob.js` | Changed to `getDb()`, added `await getDb()` before each DB operation |
| `feedbackIngestJob.ts` | Removed `createModuleCache` import from `../../../web/lib/db`, uses `getDb()` |
| `domainExportJob.ts` | Removed `createModuleCache` import from `../../../web/lib/db`, uses `getDb()` |

### Keyword Files (apps/api/src/keywords/)

| File | Changes |
|------|---------|
| `keywords.ts` | Changed to `getDb()`, added `await getDb()` in all functions |
| `keywords.js` | Changed to `getDb()`, added `await getDb()` in all functions |

### Billing Files (apps/api/src/billing/)

| File | Changes |
|------|---------|
| `stripeWebhook.ts` | Changed to `getDb()`, added `await getDb()` before DB operations |
| `stripeWebhook.js` | Changed to `getDb()`, added `await getDb()` before DB operations |
| `planManager.ts` | Changed to `getDb()`, added `await getDb()` in both functions |
| `planManager.js` | Changed to `getDb()`, added `await getDb()` in both functions |
| `paddleWebhook.ts` | Changed to `getDb()`, added `await getDb()` before DB operations |
| `paddleWebhook.js` | Changed to `getDb()`, added `await getDb()` before DB operations |

### Email Files (apps/api/src/email/)

| File | Changes |
|------|---------|
| `doubleOptin.ts` | Changed to `getDb()`, added `await getDb()` in both functions |
| `doubleOptin.js` | Changed to `getDb()`, added `await getDb()` in both functions |

### Route Files (apps/api/src/routes/)

| File | Changes |
|------|---------|
| `adminAudit.ts` | Changed to `getDb()` |
| `adminAudit.js` | Changed to `getDb()` |
| `adminAuditExport.ts` | Changed to `getDb()` |
| `adminAuditExport.js` | Changed to `getDb()` |
| `adminBilling.ts` | Changed to `getDb()` |
| `adminBilling.js` | Changed to `getDb()` |
| `bulkPublishCreate.ts` | Changed to `getDb()` |
| `bulkPublishCreate.js` | Changed to `getDb()` |
| `bulkPublishDryRun.ts` | Changed to `getDb()` |
| `bulkPublishDryRun.js` | Changed to `getDb()` |
| `buyerSeoReport.ts` | Changed to `getDb()` |
| `buyerSeoReport.js` | Changed to `getDb()` |
| `buyerRoi.ts` | Changed to `getDb()` |
| `buyerRoi.js` | Changed to `getDb()` |
| `contentRoi.ts` | Changed to `getDb()` |
| `contentRoi.js` | Changed to `getDb()` |
| `domainSaleReadiness.ts` | Changed to `getDb()` |
| `domainSaleReadiness.js` | Changed to `getDb()` |
| `email.ts` | Changed to `getDb()` |
| `email.js` | Changed to `getDb()` |
| `emailSubscribers.ts` | Changed to `getDb()` |
| `emailSubscribers.js` | Changed to `getDb()` |
| `experiments.ts` | Changed to `getDb()` |
| `experiments.js` | Changed to `getDb()` |
| `exports.ts` | Changed to `getDb()` |
| `exports.js` | Changed to `getDb()` |
| `feedback.ts` | Changed to `getDb()` |
| `feedback.js` | Changed to `getDb()` |
| `nextActionsAdvisor.ts` | Changed to `getDb()` |
| `nextActionsAdvisor.js` | Changed to `getDb()` |
| `portfolioHeatmap.ts` | Changed to `getDb()` |
| `portfolioHeatmap.js` | Changed to `getDb()` |
| `publishRetry.ts` | Changed to `getDb()` |
| `publishRetry.js` | Changed to `getDb()` |

### Advisor Files (apps/api/src/advisor/)

| File | Changes |
|------|---------|
| `keywordCoverage.ts` | Changed to `getDb()` |
| `keywordCoverage.js` | Changed to `getDb()` |

### Portfolio Files (apps/api/src/portfolio/)

| File | Changes |
|------|---------|
| `heatmapKeywords.ts` | Changed to `getDb()` |
| `heatmapKeywords.js` | Changed to `getDb()` |

### Database Files (apps/api/src/)

| File | Changes |
|------|---------|
| `db.js` | Added deprecation warning on direct `db` export, added `getDb()` export function for consistency |

## Migration Pattern

### Before (Incorrect):
```typescript
import { db } from '../db';

export async function myFunction() {
  const result = await db('table').select('*');
  return result;
}
```

### After (Correct):
```typescript
import { getDb } from '../db';

export async function myFunction() {
  const db = await getDb();
  const result = await db('table').select('*');
  return result;
}
```

## Benefits

1. **Lazy Initialization**: Database connection is only created when first needed
2. **No Module-Load Side Effects**: Importing the module doesn't trigger DB connection
3. **Consistent Pattern**: All files use the same pattern for database access
4. **Better Testability**: Easier to mock the database in tests
5. **Proper Shutdown Handling**: Shutdown handlers are registered after initialization

## Future ESLint Rule

To prevent regression, consider adding an ESLint rule to prevent direct `db` imports:

```javascript
// .eslintrc.js
module.exports = {
  rules: {
    'no-restricted-imports': ['error', {
      paths: [{
        name: '../db',
        importNames: ['db'],
        message: 'Use getDb() instead of direct db import for lazy initialization'
      }]
    }]
  }
};
```

## Remaining Work

The following files still use different database patterns and should be consolidated in future work:

1. **apps/web/lib/db.ts** - Uses pg Pool + Knex dual approach
2. **control-plane/api/http.ts** - Uses direct `new Pool()` instantiation

These are separate applications/services and may require more careful refactoring to ensure compatibility.
