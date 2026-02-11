# Console.log to Structured Logger Migration - Summary

## 📦 Deliverables

### Documentation

| File | Description |
|------|-------------|
| `CONSOLE_LOG_MIGRATION_PLAN.md` | High-level overview and quick reference |
| `docs/developers/console-log-migration-quickstart.md` | Quick start guide for developers |
| `docs/developers/console-log-migration-plan.md` | Comprehensive migration plan |

### Scripts & Tools

| File | Description |
|------|-------------|
| `scripts/migrate-console-logs.ts` | Automated migration script with dry-run support |
| `scripts/console-log-migration-tracker.csv` | Progress tracking spreadsheet (150 files) |
| `test/utils/logger-mock.ts` | Mock logger utilities for testing |

### Package.json Scripts Added

```json
{
  "logger:migrate": "tsx scripts/migrate-console-logs.ts",
  "logger:migrate:dry-run": "tsx scripts/migrate-console-logs.ts --dry-run",
  "logger:find": "grep -r 'console\\.\\(log\\|warn\\|info\\|debug\\)' ...",
  "logger:count": "npm run logger:find | wc -l",
  "logger:check": "npm run logger:find && exit 1 || echo '✅ No console.log'"
}
```

## 📊 Current State Analysis

### Console.log Usage Statistics

| File Type | Files Affected | Total Statements |
|-----------|---------------|------------------|
| `.ts` | ~100 | ~600 |
| `.js` | ~50 | ~200 |
| **Total** | **~150** | **~800** |

### Top 10 Files by Console Count

| File | Count | Priority |
|------|-------|----------|
| `scripts/performance-monitor.ts` | 55 | P2 |
| `scripts/cache-warming.ts` | 51 | P2 |
| `apps/web/pages/api/webhooks/stripe.ts` | 28 | P0 |
| `apps/web/pages/api/webhooks/clerk.ts` | 23 | P0 |
| `control-plane/services/billing.js` | 15 | P1 |
| `apps/api/src/routes/emailSubscribers.js` | 12 | P0 |
| `apps/api/src/routes/bulkPublishCreate.ts` | 11 | P0 |
| `apps/web/lib/auth.ts` | 11 | P0 |
| `apps/api/src/adapters/gbp/GbpAdapter.ts` | 10 | P1 |
| `control-plane/services/jwt.js` | 10 | P1 |

## 🎯 Migration Strategy

### Phased Approach

```
Phase 1 (Week 1): P0 - Critical (Security & Financial)
├── apps/api/src/routes/ (billing, email, auth)
├── apps/web/pages/api/webhooks/ (stripe, clerk)
└── apps/web/lib/auth.ts

Phase 2 (Week 2): P1 - High (Core Services)
├── control-plane/services/billing.js
├── control-plane/services/jwt.js
├── control-plane/services/api-key-vault.ts
└── packages/cache/

Phase 3 (Week 3): P2 - Medium (Workers & Scripts)
├── scripts/*.ts (performance-monitor, cache-warming)
├── packages/kernel/queues/
├── domains/*/application/*Worker.ts
└── packages/monitoring/

Phase 4 (Week 4): P3 - Low (Cleanup)
├── All remaining files
└── Documentation updates
```

## 🔧 Migration Patterns

### Pattern 1: Simple Log
```typescript
// BEFORE
console.log('[UserService] Creating user');

// AFTER
import { getLogger } from '@kernel/logger';
const logger = getLogger('UserService');
logger.info('Creating user');
```

### Pattern 2: With Variables
```typescript
// BEFORE
console.log(`Processing ${items.length} items for user ${userId}`);

// AFTER
logger.info('Processing items', { itemCount: items.length, userId });
```

### Pattern 3: Error Logging
```typescript
// BEFORE
console.error('Failed to save:', error);
console.error(`[Service] Error: ${error.message}`);

// AFTER
logger.error('Failed to save', error);
logger.error('Service operation failed', error, { context: 'additional' });
```

### Pattern 4: Debug Info
```typescript
// BEFORE
console.log('Debug:', JSON.stringify(payload, null, 2));

// AFTER
logger.debug('Debug info', { payload });
```

## 🚀 How to Start

### 1. Understand the Current Logger

Read the existing logger at `packages/kernel/logger.ts`:

```typescript
// Standalone functions
import { debug, info, warn, error, fatal } from '@kernel/logger';
info('Message', { metadata: 'value' });

// Logger class
import { getLogger } from '@kernel/logger';
const logger = getLogger('ServiceName');
logger.info('Message');
logger.error('Failed', error, { context: 'data' });

// Child loggers
const childLogger = logger.child({ requestId: 'abc' });
```

### 2. Run the Migration Tool

```bash
# Preview changes (dry run)
npm run logger:migrate:dry-run -- "apps/api/src/routes/*.ts"

# Apply changes
npm run logger:migrate -- "apps/api/src/routes/*.ts"
```

### 3. Verify

```bash
# Check for remaining console.log
npm run logger:find

# Run linter
npm run lint

# Run tests
npm test
```

## 📈 Progress Tracking

The CSV file `scripts/console-log-migration-tracker.csv` contains all 150 files with:
- File path
- Console statement count
- Priority (P0-P3)
- Status (pending/in-progress/done)
- Assigned developer
- Notes

Update this file as you progress through the migration.

## ✅ Success Criteria

- [ ] Zero `console.log` statements (except justified cases in scripts)
- [ ] All `console.error` migrated with Error objects
- [ ] ESLint `no-console` rule enabled
- [ ] All tests pass
- [ ] Log output validated (JSON format)
- [ ] No sensitive data in logs (redaction working)

## 🛡️ Safety Measures

### Automated Migration Features

The migration script includes:

1. **Dry-run mode** - Preview changes before applying
2. **Service name detection** - Auto-extracts from filename
3. **Pattern matching** - Handles common console.log patterns
4. **Import preservation** - Won't duplicate imports
5. **Backup capability** - Git history serves as backup

### Testing Utilities

The mock logger (`test/utils/logger-mock.ts`) provides:

```typescript
// Capture and assert on logs
const mockLogger = setupMockLogger();
expect(mockLogger.hasLog('info', /Processing/)).toBe(true);
mockLogger.assertNoErrors();
```

## 📅 Timeline

| Phase | Duration | Files | Effort |
|-------|----------|-------|--------|
| P0 - Critical | 3 days | 15 | High |
| P1 - High | 2 days | 10 | Medium |
| P2 - Medium | 5 days | 40 | Medium |
| P3 - Low | 5 days | 85 | Low |
| Testing & QA | 3 days | All | Medium |
| **Total** | **~3 weeks** | **~150** | - |

## 🔗 Related Files

| File | Purpose |
|------|---------|
| `packages/kernel/logger.ts` | Structured logger implementation |
| `.env.example` | Logger configuration (LOG_LEVEL) |
| `.eslintrc.js` | ESLint rules (add no-console rule) |

## 🆘 Troubleshooting

### Issue: Migration script doesn't match my pattern

**Solution:** The script handles common patterns. For complex cases, migrate manually following the patterns in this guide.

### Issue: Circular dependency with logger import

**Solution:** Use dynamic import or move the logger import to the top of the file after other imports.

### Issue: Tests fail after migration

**Solution:** Update tests to use `MockLogger` from `test/utils/logger-mock.ts`.

### Issue: Need to keep console.log for CLI output

**Solution:** For CLI scripts, use a hybrid approach:

```typescript
// Structured log for monitoring
logger.info('Cache warming complete', { count, duration });

// Human-readable for CLI
if (process.env['CLI_MODE']) {
  console.log(`✓ Warmed ${count} entries`);
}
```

## 📚 Additional Resources

- [Structured Logger Source](../packages/kernel/logger.ts)
- [Jest Mock Logger](../test/utils/logger-mock.ts)
- [Migration Tracker](../scripts/console-log-migration-tracker.csv)

---

**Ready to start?** Begin with the [Quick Start Guide](developers/console-log-migration-quickstart.md) and migrate the P0 files first.
