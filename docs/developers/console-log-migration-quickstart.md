# Console.log Migration Quick Start

## TL;DR

1. **Find** console.log usage: `npm run find-console`
2. **Migrate** a file: Use the patterns below
3. **Verify**: `npm run lint` + `npm test`

## Migration in 3 Steps

### Step 1: Add Import
```typescript
import { getLogger } from '@kernel/logger';

const logger = getLogger('ServiceName'); // Use file/service name
```

### Step 2: Replace Statements

| console.log | logger |
|-------------|--------|
| `console.log('message')` | `logger.info('message')` |
| `console.log('msg:', data)` | `logger.info('msg', { data })` |
| `console.error('msg:', err)` | `logger.error('msg', err)` |
| `console.warn('msg')` | `logger.warn('msg')` |

### Step 3: Clean Up
- Run `npm run lint` to catch missed statements
- Run tests to verify

## Before & After Examples

### Example 1: Simple Log
```typescript
// BEFORE
console.log('[UserService] Creating user');

// AFTER
import { getLogger } from '@kernel/logger';
const logger = getLogger('UserService');

logger.info('Creating user');
```

### Example 2: With Variables
```typescript
// BEFORE
console.log(`Processing ${items.length} items for user ${userId}`);

// AFTER
logger.info('Processing items', { itemCount: items.length, userId });
```

### Example 3: Error Logging
```typescript
// BEFORE
console.error('Failed to save:', error);
console.error(`[DB] Error: ${error.message}`);

// AFTER
logger.error('Failed to save', error);
logger.error('Database operation failed', error, { table: 'users' });
```

### Example 4: Debug Info
```typescript
// BEFORE
console.log('Debug - request:', JSON.stringify(req.body, null, 2));

// AFTER
logger.debug('Request payload', { body: req.body });
```

## Priority Order (Migrate in this order)

1. **P0 - Security**: Auth, webhooks, billing (`apps/api/src/routes/`, `apps/web/pages/api/webhooks/`)
2. **P1 - Core**: API routes, services (`apps/api/src/`, `control-plane/`)
3. **P2 - Workers**: Jobs, domain handlers (`apps/api/src/jobs/`, `domains/`)
4. **P3 - Scripts**: CLI tools (`scripts/`)

## ESLint Rule

Add to `.eslintrc.js`:

```javascript
module.exports = {
  rules: {
    'no-console': ['warn', { 
      allow: ['error'] // Only console.error allowed temporarily
    }]
  }
};
```

## Batch Migration Commands

```bash
# Find all console.log statements
npm run find-console

# Migrate specific directory (automated)
npm run migrate-logs -- "apps/api/src/routes/*.ts"

# Check migration status
npm run check-logs
```

## Testing with Mock Logger

```typescript
import { getLogger } from '@kernel/logger';
import { MockLogger } from '@test/utils/logger-mock';

describe('MyService', () => {
  const mockLogger = new MockLogger();
  
  beforeEach(() => mockLogger.startCapturing());
  afterEach(() => mockLogger.stopCapturing());
  
  it('should log correctly', () => {
    // Run your code
    
    // Assert on logs
    expect(mockLogger.hasLog('info', /Processing/)).toBe(true);
    expect(mockLogger.getErrors()).toHaveLength(0);
  });
});
```

## Quick Reference Card

```typescript
import { getLogger } from '@kernel/logger';
const logger = getLogger('ServiceName');

// Levels
logger.debug('Debug info');           // Only in development
logger.info('General info');          // Standard logging
logger.warn('Warning');               // Non-critical issues
logger.error('Error', error);         // Errors with stack
logger.fatal('Critical', error);      // System-stopping

// With context
logger.info('Message', { key: 'value', userId: '123' });

// Child logger
const child = logger.child({ requestId: 'abc' });
child.info('In request'); // Includes requestId automatically
```

## Checklist for Each File

- [ ] Add `import { getLogger } from '@kernel/logger';`
- [ ] Create logger: `const logger = getLogger('ServiceName');`
- [ ] Replace `console.log` → `logger.info`
- [ ] Replace `console.error` → `logger.error` (pass Error object)
- [ ] Replace `console.warn` → `logger.warn`
- [ ] Convert template strings to metadata objects
- [ ] Run linter
- [ ] Run tests

## Need Help?

- Full plan: `docs/developers/console-log-migration-plan.md`
- Logger docs: `packages/kernel/logger.ts`
- Ask in #dev-ops channel
