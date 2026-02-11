# Transaction Safety Improvements

## CRITICAL FIX: Silent Transaction Rollback Failures

### Summary

Fixed silent transaction rollback failures across the codebase. Previously, ROLLBACK errors were silently swallowed using empty catch blocks, masking critical database integrity issues and making debugging extremely difficult.

### Vulnerability Details

**Severity:** CRITICAL

**Issue:** When a database transaction fails and the subsequent ROLLBACK also fails, the original error was thrown but the rollback failure was silently ignored. This could lead to:

1. **Data Inconsistency:** Partial transaction state persisting in the database
2. **Connection Pool Pollution:** Connections returned to the pool with active transactions
3. **Silent Failures:** Developers unaware that rollbacks failed
4. **Debugging Nightmare:** Missing context about why transactions failed

**Example of Vulnerable Code:**
```typescript
// VULNERABLE - Silent failure
catch (error) {
  await client.query('ROLLBACK').catch(() => { });  // Silent!
  throw error;
}
```

### Files Fixed

| File | Line | Issue | Fix |
|------|------|-------|-----|
| `apps/api/src/routes/publish.ts` | 47 | Empty catch block on ROLLBACK | Added proper error logging and chaining |
| `apps/web/pages/api/domains/create.ts` | 153 | Empty catch block on ROLLBACK | Added proper error logging and chaining |
| `packages/database/pgbouncer.ts` | 127 | Empty catch block on ROLLBACK | Added proper error logging and chaining |
| `control-plane/services/webhook-idempotency.ts` | 116 | Empty catch with comment only | Added proper error logging and chaining |
| `domains/search/infra/persistence/PostgresSearchDocumentRepository.ts` | 153 | Empty catch block on ROLLBACK | Added proper error logging and chaining |

### Solution Implemented

#### 1. New TransactionError Class

Created a specialized error class in `packages/database/errors/index.ts`:

```typescript
export class TransactionError extends Error {
  constructor(
    message: string,
    public readonly originalError: Error,
    public readonly rollbackError?: Error
  ) {
    super(message);
    this.name = 'TransactionError';
  }

  get rootCause(): Error {
    return this.originalError;
  }

  get hasRollbackFailure(): boolean {
    return this.rollbackError !== undefined;
  }
}
```

#### 2. Updated Error Handling Pattern

**Before:**
```typescript
catch (error) {
  await client.query('ROLLBACK').catch(() => { });  // Silent!
  throw error;
}
```

**After:**
```typescript
catch (error) {
  try {
    await client.query('ROLLBACK');
  } catch (rollbackError) {
    // Log the rollback failure with full context
    logger.error('Rollback failed', rollbackError, {
      originalError: error instanceof Error ? error.message : String(error),
    });
    
    // Chain errors for better debugging
    const originalErr = error instanceof Error ? error : new Error(String(error));
    const rollbackErr = rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
    
    throw new TransactionError(
      `Transaction failed and rollback also failed: ${originalErr.message}`,
      originalErr,
      rollbackErr
    );
  }
  throw error;
}
```

#### 3. Updated withTransaction Helper

Enhanced the `withTransaction` helper in `packages/database/transactions/index.ts`:

- Now throws `TransactionError` when both transaction and rollback fail
- Logs rollback failures with full context
- Releases client with error flag when rollback fails
- Maintains original error as the root cause

### Test Coverage

Created comprehensive test suite in `packages/database/__tests__/transaction-error-handling.test.ts`:

#### Test Categories

1. **Rollback Failure Logging**
   - Verifies rollback errors are logged with original error context
   - Ensures both errors appear in logs

2. **Original Error Preservation**
   - Original error is always thrown, even when rollback fails
   - TransactionError chains both errors for debugging

3. **Transaction State Consistency**
   - Client released with error flag when rollback fails
   - Client released normally when rollback succeeds
   - Double-release attempts handled gracefully

4. **PgBouncer Transaction Handling**
   - Same error handling for PgBouncer-specific transactions
   - Proper error chaining in PgBouncer context

5. **Edge Cases**
   - Non-Error rollback failures (strings, objects)
   - Timeout during rollback
   - Release errors after rollback failure

#### Running Tests

```bash
# Run transaction error handling tests
npm test -- packages/database/__tests__/transaction-error-handling.test.ts

# Run all database tests
npm test -- packages/database
```

### Migration Guide

#### For Existing Code

If you have code using the old pattern:

```typescript
// OLD - Vulnerable
catch (error) {
  await client.query('ROLLBACK').catch(() => { });
  throw error;
}
```

Update to the new pattern:

```typescript
// NEW - Safe
catch (error) {
  try {
    await client.query('ROLLBACK');
  } catch (rollbackError) {
    logger.error('Rollback failed', rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError)));
    
    const originalErr = error instanceof Error ? error : new Error(String(error));
    const rollbackErr = rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
    
    throw new Error(
      `Transaction failed: ${originalErr.message}. ` +
      `Additionally, rollback failed: ${rollbackErr.message}`
    );
  }
  throw error;
}
```

#### Using withTransaction Helper

Prefer using the `withTransaction` helper which handles all edge cases:

```typescript
import { withTransaction, TransactionError } from '@kernel/database/transactions';

try {
  await withTransaction(async (client) => {
    // Your transaction logic here
    await client.query('INSERT INTO ...');
    await client.query('UPDATE ...');
  });
} catch (error) {
  if (error instanceof TransactionError) {
    // Both transaction and rollback failed
    console.error('Original error:', error.originalError);
    console.error('Rollback error:', error.rollbackError);
  }
  // Handle error
}
```

### Monitoring and Alerting

#### Log Patterns to Monitor

```
# Critical: Rollback failed - possible data inconsistency
"Rollback failed" 

# Critical: Transaction failed and rollback also failed
"Transaction failed and rollback also failed"

# Warning: Attempted to release already-released client
"Attempted to release already-released client"

# Warning: Error releasing client
"Error releasing client"
```

#### Recommended Alerts

1. **High Priority:** Any log containing "Rollback failed"
2. **Medium Priority:** Any log containing "TransactionError"
3. **Low Priority:** Logs containing "Attempted to release already-released client"

### Rollback Failure Scenarios

Common causes of ROLLBACK failures:

1. **Connection Lost:** Network interruption during rollback
2. **Connection Terminated:** Database killed the connection
3. **Timeout:** Rollback took too long and timed out
4. **Protocol Error:** Database protocol violation
5. **Already Rolled Back:** Transaction already rolled back by database

### Best Practices

1. **Always Use withTransaction Helper:**
   ```typescript
   // Recommended
   await withTransaction(async (client) => { ... });
   
   // Avoid manual transaction management
   await client.query('BEGIN');
   // ... operations ...
   await client.query('COMMIT');
   ```

2. **Handle TransactionError Specifically:**
   ```typescript
   } catch (error) {
     if (error instanceof TransactionError) {
       // Special handling for rollback failures
       await notifyOpsTeam(error);
     }
     throw error;
   }
   ```

3. **Monitor for Rollback Failures:**
   - Set up alerts for "Rollback failed" logs
   - Investigate patterns of rollback failures
   - Check database connection pool health

4. **Test Transaction Error Handling:**
   - Include transaction failure scenarios in tests
   - Mock ROLLBACK failures to verify error handling
   - Verify data consistency after transaction failures

### Verification

To verify the fixes are working:

1. **Run the test suite:**
   ```bash
   npm test -- packages/database/__tests__/transaction-error-handling.test.ts
   ```

2. **Check for silent catch blocks:**
   ```bash
   grep -r "\.catch(() => {})" --include="*.ts" packages/
   grep -r "\.catch(() => { })" --include="*.ts" apps/
   ```
   Should return no results.

3. **Verify logging:**
   Check that rollback failures now appear in logs with full context.

### References

- [PostgreSQL Transaction Processing](https://www.postgresql.org/docs/current/tutorial-transactions.html)
- [Node.js pg Client](https://node-postgres.com/apis/client)
- [Error Cause Proposal](https://github.com/tc39/proposal-error-cause)
