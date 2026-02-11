# Console.log to Structured Logger Migration Plan

## Executive Summary

This document outlines a systematic approach to migrate all `console.log` statements to the project's structured logger (`packages/kernel/logger.ts`).

**Current State:**
- **~800+** `console.log/error/warn/info/debug` statements across the codebase
- **150+** files affected
- Inconsistent logging formats
- No structured context or correlation IDs
- Security risk (potential sensitive data exposure)

**Target State:**
- All logging through `packages/kernel/logger.ts`
- Structured JSON logs with context
- Sensitive data redaction
- Correlation ID tracking
- Configurable log levels

---

## Current Logger Architecture

### Existing Structured Logger
**Location:** `packages/kernel/logger.ts`

**Features:**
```typescript
// Standalone functions
import { debug, info, warn, error, fatal } from '@kernel/logger';
info('Message', { metadata: 'value' });

// Logger class with service context
import { getLogger } from '@kernel/logger';
const logger = getLogger('ServiceName');
logger.info('Message', { userId: '123' });
logger.error('Failed', error, { context: 'data' });

// Child loggers
const childLogger = logger.child({ requestId: 'abc' });
```

**Log Output Format:**
```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "level": "ERROR",
  "message": "[ServiceName] Failed to process",
  "service": "ServiceName",
  "correlationId": "req-123",
  "userId": "user-456",
  "error": "Error message",
  "metadata": { "key": "value" }
}
```

---

## Migration Strategy

### Phase 1: Foundation & Tooling (Week 1)

#### 1.1 Create ESLint Rule
**File:** `.eslintrc.js` (update) or new rule file

Add rule to prevent new console.log usage:

```javascript
// .eslintrc.js
module.exports = {
  rules: {
    'no-console': ['warn', { allow: ['error'] }], // Temporarily allow error during migration
    // Or custom rule:
    '@smartbeak/no-raw-console': 'error'
  }
};
```

**Custom ESLint Rule:** `packages/eslint-plugin/rules/no-raw-console.js`

```javascript
module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow console.log, use structured logger instead',
      category: 'Best Practices',
      recommended: true,
    },
    fixable: 'code',
    schema: [],
    messages: {
      noConsoleLog: 'Use getLogger() from @kernel/logger instead of console.log',
      noConsoleWarn: 'Use getLogger() from @kernel/logger instead of console.warn',
      noConsoleError: 'Use getLogger() from @kernel/logger instead of console.error',
    },
  },
  create(context) {
    return {
      MemberExpression(node) {
        if (node.object.name === 'console') {
          const method = node.property.name;
          if (['log', 'warn', 'info', 'debug'].includes(method)) {
            context.report({
              node,
              messageId: `noConsole${method.charAt(0).toUpperCase() + method.slice(1)}`,
            });
          }
        }
      },
    };
  },
};
```

#### 1.2 Create Migration Script
**File:** `scripts/migrate-console-log.ts`

```typescript
#!/usr/bin/env ts-node
/**
 * Automated console.log migration script
 * 
 * Usage: npx ts-node scripts/migrate-console-log.ts [file-pattern]
 * Example: npx ts-node scripts/migrate-console-log.ts "apps/api/**/*.ts"
 */

import { glob } from 'glob';
import { readFile, writeFile } from 'fs/promises';
import { parse } from '@babel/parser';
import generate from '@babel/generator';
import traverse from '@babel/traverse';
import * as t from '@babel/types';

interface MigrationResult {
  file: string;
  changes: number;
  errors: string[];
}

// Patterns for different console.log use cases
const MIGRATION_PATTERNS = {
  // Simple string: console.log('message') -> logger.info('message')
  simpleString: {
    pattern: /console\.log\(['"]([^'"]*)['"]\)/g,
    replacement: "logger.info('$1')",
  },
  // String with variables: console.log('message', var1, var2)
  stringWithVars: {
    pattern: /console\.log\(['"]([^'"]*)['"],\s*(.+)\)/g,
    replacement: "logger.info('$1', { data: [$2] })",
  },
  // Error: console.error('message', err) -> logger.error('message', err)
  errorWithError: {
    pattern: /console\.error\(['"]([^'"]*)['"],\s*(\w+)\)/g,
    replacement: "logger.error('$1', $2)",
  },
  // Warn: console.warn('message') -> logger.warn('message')
  warn: {
    pattern: /console\.warn\(['"]([^'"]*)['"]\)/g,
    replacement: "logger.warn('$1')",
  },
};

async function migrateFile(filePath: string): Promise<MigrationResult> {
  const result: MigrationResult = { file: filePath, changes: 0, errors: [] };
  
  try {
    let content = await readFile(filePath, 'utf8');
    const originalContent = content;
    
    // Check if file already imports logger
    const hasLoggerImport = /import.*getLogger.*from.*@kernel\/logger/.test(content);
    
    // Apply migrations
    for (const [name, { pattern, replacement }] of Object.entries(MIGRATION_PATTERNS)) {
      const matches = content.match(pattern);
      if (matches) {
        content = content.replace(pattern, replacement);
        result.changes += matches.length;
      }
    }
    
    // Add import if needed and changes were made
    if (result.changes > 0 && !hasLoggerImport) {
      // Determine service name from file path
      const serviceName = filePath
        .replace(/.*\//, '')
        .replace('.ts', '')
        .replace(/[-_]/g, '');
      
      const importStatement = `import { getLogger } from '@kernel/logger';\nconst logger = getLogger('${serviceName}');\n\n`;
      content = importStatement + content;
    }
    
    // Write if changes were made
    if (content !== originalContent) {
      await writeFile(filePath, content);
    }
    
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : 'Unknown error');
  }
  
  return result;
}

async function main() {
  const pattern = process.argv[2] || '**/*.ts';
  const files = await glob(pattern, { ignore: ['node_modules/**', 'dist/**', '*.d.ts'] });
  
  console.log(`Found ${files.length} files to process`);
  
  const results: MigrationResult[] = [];
  for (const file of files) {
    const result = await migrateFile(file);
    if (result.changes > 0 || result.errors.length > 0) {
      results.push(result);
    }
  }
  
  // Report
  console.log('\n=== Migration Report ===');
  console.log(`Files modified: ${results.filter(r => r.changes > 0).length}`);
  console.log(`Total changes: ${results.reduce((sum, r) => sum + r.changes, 0)}`);
  console.log(`Errors: ${results.reduce((sum, r) => sum + r.errors.length, 0)}`);
  
  // List files with errors
  const filesWithErrors = results.filter(r => r.errors.length > 0);
  if (filesWithErrors.length > 0) {
    console.log('\n=== Files with Errors ===');
    filesWithErrors.forEach(r => {
      console.log(`${r.file}:`);
      r.errors.forEach(e => console.log(`  - ${e}`));
    });
  }
}

main().catch(console.error);
```

#### 1.3 Create Logger Testing Utilities
**File:** `test/utils/logger-mock.ts`

```typescript
/**
 * Mock utilities for testing with structured logger
 */

import { LogEntry, LogHandler, addLogHandler, clearLogHandlers } from '@kernel/logger';

export class MockLogger {
  private entries: LogEntry[] = [];
  private cleanup: (() => void) | null = null;

  startCapturing(): void {
    const handler: LogHandler = (entry) => {
      this.entries.push(entry);
    };
    this.cleanup = addLogHandler(handler);
  }

  stopCapturing(): void {
    if (this.cleanup) {
      this.cleanup();
      this.cleanup = null;
    }
  }

  getEntries(): LogEntry[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries = [];
  }

  hasLog(level: string, messagePattern: RegExp): boolean {
    return this.entries.some(
      e => e.level === level && messagePattern.test(e.message)
    );
  }

  getErrors(): LogEntry[] {
    return this.entries.filter(e => e.level === 'error' || e.level === 'fatal');
  }
}

// Jest helper
export function setupMockLogger() {
  const mock = new MockLogger();
  
  beforeEach(() => {
    mock.clear();
    mock.startCapturing();
  });
  
  afterEach(() => {
    mock.stopCapturing();
  });
  
  return mock;
}
```

---

## Phase 2: Critical Path Migration (Week 2)

### Priority 1: API Routes (Security Critical)
**Files:** `apps/api/src/routes/*.ts`

| File | Count | Priority |
|------|-------|----------|
| `bulkPublishCreate.ts` | 11 | P0 - Critical |
| `email/index.ts` | 10 | P0 - Critical |
| `emailSubscribers.js` | 12 | P0 - Critical |
| `billing/*.ts` | 9 | P0 - Financial |

**Migration Pattern:**
```typescript
// BEFORE
console.error(`[bulkPublishCreate] Error: ${error.message}`);
console.warn(`[publish/bulk] Unauthorized: user ${userId}`);

// AFTER
import { getLogger } from '@kernel/logger';
const logger = getLogger('bulkPublishCreate');

logger.error('Error publishing content', error, { draftId, targetId });
logger.warn('Unauthorized publish attempt', { userId, requiredRole: 'editor' });
```

### Priority 2: Authentication & Webhooks
**Files:** 
- `apps/web/pages/api/webhooks/*.ts` (51 console statements)
- `apps/web/lib/auth.ts` (22 console statements)

**Security Considerations:**
- Redact tokens and credentials
- Include request context
- Log correlation IDs

```typescript
// BEFORE
console.log(`[Webhook] Received Stripe event: ${event.type}`);
console.error('[Clerk] Webhook error:', error);

// AFTER
const logger = getLogger('stripeWebhook');

logger.info('Received webhook event', { 
  eventType: event.type, 
  eventId: event.id 
});
logger.error('Webhook processing failed', error, { 
  eventType: event.type,
  signature: req.headers['stripe-signature']?.slice(0, 10) + '...'
});
```

### Priority 3: Control Plane Services
**Files:** `control-plane/services/*.ts`

| File | Count | Notes |
|------|-------|-------|
| `billing.js` | 15 | Financial - high priority |
| `jwt.js` | 10 | Security - high priority |
| `container.js` | 7 | Core infrastructure |
| `batch.js` | 8 | Job processing |

---

## Phase 3: Infrastructure & Workers (Week 3)

### Jobs & Workers
**Files:**
- `packages/kernel/queues/*.ts`
- `apps/api/src/jobs/*.ts`
- `domains/*/application/*Worker.ts`

```typescript
// BEFORE
console.log(`[Job] Processing job ${job.id}`);
console.error('[Worker] Job failed:', error);

// AFTER
const logger = getLogger('PublishingWorker');
const jobLogger = logger.child({ jobId: job.id, jobType: job.type });

jobLogger.info('Starting job processing', { 
  payloadSize: JSON.stringify(job.payload).length 
});
jobLogger.error('Job processing failed', error, { 
  attempt: job.attemptsMade,
  maxAttempts: job.opts.attempts 
});
```

### Scripts
**Files:** `scripts/*.ts`

| File | Count | Notes |
|------|-------|-------|
| `performance-monitor.ts` | 55 | CLI tool - use stdout for output |
| `cache-warming.ts` | 51 | Background script |
| `validate-env.ts` | 5 | Validation script |

**Special Case - CLI Scripts:**
For CLI scripts that need human-readable output, use a hybrid approach:

```typescript
import { getLogger } from '@kernel/logger';
const logger = getLogger('cacheWarming');

// Structured log for monitoring
logger.info('Cache warming complete', { 
  warmed: count, 
  durationMs: Date.now() - start 
});

// Human-readable output for CLI (stdout)
if (process.env['CLI_MODE']) {
  console.log(`✓ Warmed ${count} cache entries in ${duration}ms`);
}
```

---

## Phase 4: Domain Layer & Cleanup (Week 4)

### Domain Handlers
**Files:** `domains/*/application/handlers/*.ts`

```typescript
// BEFORE
console.log(`[UpdateDraft] Updating draft ${draftId}`);

// AFTER
const logger = getLogger('UpdateDraftHandler');
logger.info('Updating draft', { draftId, userId, changes: Object.keys(data) });
```

### Adapters
**Files:** `apps/api/src/adapters/**/*.ts`

| File | Count |
|------|-------|
| `gbp/GbpAdapter.ts` | 10 |
| `wordpress/WordPressAdapter.ts` | 2 |

### Monitoring & Observability
**Files:** `packages/monitoring/*.ts`

---

## Migration Patterns Reference

### Pattern 1: Simple String Message
```typescript
// BEFORE
console.log('Processing started');

// AFTER
logger.info('Processing started');
```

### Pattern 2: String with Variables
```typescript
// BEFORE
console.log(`Processing user ${userId} with ${items.length} items`);

// AFTER
logger.info('Processing user', { userId, itemCount: items.length });
```

### Pattern 3: Error Logging
```typescript
// BEFORE
console.error('Failed to process:', error);
console.error(`[Service] Error: ${error.message}`);

// AFTER
logger.error('Failed to process', error);
logger.error('Service operation failed', error, { context: 'additional' });
```

### Pattern 4: Debug Logging
```typescript
// BEFORE
console.log('Debug: request payload:', payload);
console.debug('Detailed state:', state);

// AFTER
logger.debug('Request payload', { payload }); // Only logs if LOG_LEVEL=debug
```

### Pattern 5: Object Logging
```typescript
// BEFORE
console.log('Config:', config);
console.log('Result:', JSON.stringify(result, null, 2));

// AFTER
logger.info('Configuration loaded', { config });
logger.info('Operation complete', { result }); // Auto-serialized
```

### Pattern 6: Conditional Logging
```typescript
// BEFORE
if (process.env.DEBUG) {
  console.log('Debug info:', data);
}

// AFTER
logger.debug('Debug info', { data }); // Handled by log level
```

---

## File Groups for Batch Migration

### Group A: API Routes (High Priority)
```bash
# Run automated migration
npx ts-node scripts/migrate-console-log.ts "apps/api/src/routes/*.ts"
npx ts-node scripts/migrate-console-log.ts "apps/web/pages/api/**/*.ts"
```

### Group B: Control Plane
```bash
npx ts-node scripts/migrate-console-log.ts "control-plane/services/*.ts"
npx ts-node scripts/migrate-console-log.ts "control-plane/api/routes/*.ts"
```

### Group C: Domain Layer
```bash
npx ts-node scripts/migrate-console-log.ts "domains/*/application/**/*.ts"
```

### Group D: Infrastructure
```bash
npx ts-node scripts/migrate-console-log.ts "packages/kernel/**/*.ts"
npx ts-node scripts/migrate-console-log.ts "packages/database/**/*.ts"
```

### Group E: Scripts (Manual Review)
```bash
# Review manually for CLI output requirements
npx ts-node scripts/migrate-console-log.ts "scripts/*.ts" --dry-run
```

---

## Quality Assurance Checklist

### Pre-Migration
- [ ] Back up codebase
- [ ] Run full test suite
- [ ] Document current log output

### Per-File Migration
- [ ] Replace console.log with logger
- [ ] Add appropriate import
- [ ] Convert string interpolation to metadata objects
- [ ] Ensure errors are passed as Error objects
- [ ] Verify no sensitive data in logs

### Post-Migration
- [ ] Run ESLint to catch missed console statements
- [ ] Run test suite
- [ ] Verify log output format
- [ ] Check for sensitive data exposure
- [ ] Performance test (ensure no overhead)

### Final Verification
- [ ] Zero console.log (except in scripts with justification)
- [ ] All tests pass
- [ ] Structured logs validated
- [ ] Documentation updated

---

## Rollback Plan

If critical issues arise:

1. **Immediate:** Disable structured logger, fall back to console
   ```typescript
   // In logger.ts
   export const MIGRATION_MODE = process.env['LOGGER_MIGRATION_MODE'] !== 'false';
   if (!MIGRATION_MODE) {
     // Fallback to console
     console.log(...);
   }
   ```

2. **Short-term:** Revert specific files showing issues
   ```bash
   git checkout HEAD -- apps/api/src/routes/problematic-file.ts
   ```

3. **Long-term:** Fix issues and re-migrate

---

## Success Metrics

| Metric | Before | Target | Measurement |
|--------|--------|--------|-------------|
| console.log count | ~800 | 0 | grep -r "console.log" |
| Structured log coverage | 20% | 100% | Logger import analysis |
| Test pass rate | 100% | 100% | npm test |
| Log parsing errors | N/A | 0 | Log validator |
| Sensitive data leaks | Unknown | 0 | Security audit |

---

## Timeline Summary

| Week | Focus | Files | Effort |
|------|-------|-------|--------|
| 1 | Tooling & Foundation | 10 | Setup |
| 2 | API Routes & Auth | 40 | High |
| 3 | Workers & Scripts | 60 | Medium |
| 4 | Domain & Cleanup | 40 | Medium |
| 5 | Testing & QA | All | Verification |

**Total Estimated Effort:** 4-5 weeks

---

## Appendix: Common Migration Issues

### Issue 1: Circular Dependencies
**Problem:** Logger import causes circular dependency
**Solution:** Use dynamic import or move logger to separate entry point

### Issue 2: Test Failures
**Problem:** Tests expect console output
**Solution:** Use MockLogger in tests

### Issue 3: Performance
**Problem:** JSON serialization overhead
**Solution:** Lazy evaluation, log level filtering

### Issue 4: Third-party Code
**Problem:** Libraries use console.log
**Solution:** Monkey-patch console in initialization

```typescript
// In app initialization
const originalLog = console.log;
console.log = (...args) => {
  getLogger('thirdParty').info(args.join(' '));
};
```
