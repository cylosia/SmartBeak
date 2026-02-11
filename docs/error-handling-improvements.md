# Error Handling Improvements (P1 Fixes)

This document describes the P1 error handling improvements implemented across the SmartBeak codebase.

## Summary of Changes

| Issue | Location | Fix Description |
|-------|----------|-----------------|
| Analytics DB init error swallowed | `apps/api/src/db.ts:319` | Added error logging with context and metrics emission |
| Module cache no circuit breaker | `apps/api/src/utils/moduleCache.ts:105-108` | Added circuit breaker wrapper for cascading failure protection |
| Worker uncaught exception gap | `apps/api/src/jobs/worker.ts:45-48` | Added timeout protection for graceful shutdown |
| Circuit breaker missing error classification | `packages/kernel/retry.ts:380-382` | Don't count 4xx errors toward circuit breaker threshold |

---

## 1. Analytics DB Error Logging and Metrics

**File:** `apps/api/src/db.ts`

### Problem
Errors during analytics database initialization were being silently swallowed with `.catch(() => { })`, making it impossible to detect and diagnose connection issues.

### Solution
- Added comprehensive error logging with context (error message, stack trace, duration, retry count)
- Added metrics emission for monitoring:
  - `analytics_db_init_failed_total` - Counter for initialization failures
  - `analytics_db_init_duration_ms_total` - Timer for initialization duration
  - `analytics_db_async_init_failed_total` - Counter for async init failures

### Key Changes
```typescript
// Before:
analyticsDb().catch(() => { });

// After:
analyticsDb().catch((error) => { 
  const err = error instanceof Error ? error : new Error(String(error));
  logger.warn('Analytics DB async initialization failed (using fallback)', { 
    error: err.message,
    fallback: 'primary_db'
  });
  emitCounter('analytics_db_async_init_failed', 1);
});
```

---

## 2. Module Cache Circuit Breaker

**File:** `apps/api/src/utils/moduleCache.ts`

### Problem
The `ThreadSafeModuleCache` had no protection against cascading failures when the module loader repeatedly fails. This could lead to resource exhaustion.

### Solution
- Added `CircuitBreaker` from `@kernel/retry` to wrap loader calls
- Circuit opens after 5 failures, preventing further load attempts for 30 seconds
- Errors are properly logged with the key that failed to load

### Key Changes
```typescript
// Added circuit breaker to constructor
constructor(private loader: (key: string) => Promise<T>) {
  this.circuitBreaker = new CircuitBreaker('ThreadSafeModuleCache', {
    failureThreshold: 5,
    resetTimeoutMs: 30000,
    halfOpenMaxCalls: 3,
  });
}

// Wrapped loader with circuit breaker
try {
  const promise = this.circuitBreaker.execute(() => this.loader(key)).catch((err) => {
    this.cache.delete(key);
    logger.error(`Module cache load failed for key: ${key}`, err);
    throw err;
  });
  // ...
}
```

---

## 3. Worker Shutdown Timeout Protection

**File:** `apps/api/src/jobs/worker.ts`

### Problem
The uncaught exception handler used a fixed 5-second timeout before calling `process.exit(1)`, but the `scheduler.stop()` call could hang indefinitely, preventing graceful shutdown.

### Solution
- Added `Promise.race()` to race shutdown against a 10-second timeout
- Added logging for both successful shutdown and timeout scenarios
- Reduced forced exit grace period to 1 second after shutdown attempt
- Applied same protection to `unhandledRejection` handler

### Key Changes
```typescript
// Before:
process.on('uncaughtException', async (err) => {
  logger.error('Uncaught exception', err);
  await scheduler.stop();
  setTimeout(() => process.exit(1), 5000);
});

// After:
process.on('uncaughtException', async (err) => {
  logger.error('Uncaught exception', err);
  
  const SHUTDOWN_TIMEOUT_MS = 10000;
  
  try {
    await Promise.race([
      scheduler.stop(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Shutdown timeout')), SHUTDOWN_TIMEOUT_MS)
      )
    ]);
    logger.info('Graceful shutdown completed after uncaught exception');
  } catch (shutdownError) {
    logger.error('Forced shutdown due to timeout or error', shutdownError);
  }
  
  setTimeout(() => {
    logger.error('Forcing exit after shutdown attempt');
    process.exit(1);
  }, 1000);
});
```

---

## 4. Circuit Breaker Error Classification

**File:** `packages/kernel/retry.ts`

### Problem
The circuit breaker counted all errors toward its failure threshold, including 4xx client errors. This could cause the circuit to open due to client mistakes rather than actual service failures.

### Solution
- Added `shouldCountFailure()` method to classify errors
- 4xx client errors (400-499) are excluded from failure counting
- Common client error codes are recognized (BAD_REQUEST, VALIDATION_ERROR, etc.)
- Error message patterns are also checked for client error indicators

### Key Changes
```typescript
// Added error classification
private shouldCountFailure(error: unknown): boolean {
  if (error && typeof error === 'object') {
    const err = error as { statusCode?: number; code?: string; message?: string };
    
    // Don't count HTTP 4xx errors
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      return false;
    }
    
    // Check for client error codes
    if (err.code) {
      const clientErrorCodes = [
        'BAD_REQUEST', 'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND',
        'VALIDATION_ERROR', 'EINVAL', 'ENOENT'
      ];
      if (clientErrorCodes.some(code => err.code?.includes(code))) {
        return false;
      }
    }
    
    // Check error message patterns
    if (err.message) {
      const clientErrorPatterns = [
        'bad request', 'unauthorized', 'forbidden', 'not found',
        'validation failed', 'invalid input'
      ];
      // ...
    }
  }
  
  return true;
}

// Modified onFailure to use classification
private async onFailure(error?: unknown): Promise<void> {
  if (error && !this.shouldCountFailure(error)) {
    logger.debug(`Circuit breaker ignoring client error for ${this.name}`);
    return;
  }
  // ... count failure
}
```

### Excluded Error Types
| Category | Examples |
|----------|----------|
| HTTP 4xx | 400, 401, 403, 404, 422 |
| Error Codes | BAD_REQUEST, UNAUTHORIZED, FORBIDDEN, NOT_FOUND, VALIDATION_ERROR, EINVAL, ENOENT |
| Message Patterns | "bad request", "unauthorized", "forbidden", "not found", "validation failed", "invalid input" |

---

## Testing

All improvements include comprehensive test coverage:

| Test File | Coverage |
|-----------|----------|
| `packages/kernel/__tests__/circuit-breaker-error-classification.test.ts` | 4xx error exclusion, 5xx error counting, mixed error types |
| `apps/api/src/utils/__tests__/moduleCache.circuit-breaker.test.ts` | Circuit breaker integration, cascading failure prevention |
| `apps/api/src/jobs/__tests__/worker.shutdown.test.ts` | Shutdown timeout protection, signal handling |
| `apps/api/src/__tests__/db.analytics-error-handling.test.ts` | Error logging, metrics emission, fallback behavior |

### Running Tests
```bash
# Run all error handling tests
npm test -- --testPathPattern="error-handling|circuit-breaker|shutdown"

# Run specific test file
npm test -- packages/kernel/__tests__/circuit-breaker-error-classification.test.ts
```

---

## Monitoring

### Metrics to Watch

| Metric | Description | Alert Threshold |
|--------|-------------|-----------------|
| `analytics_db_init_failed_total` | Analytics DB initialization failures | > 5 in 5 minutes |
| `analytics_db_init_duration_ms_total` | Analytics DB init duration | > 5000ms |
| Circuit breaker open events | Circuit breaker state changes | Any open event |
| Worker uncaught exceptions | Unhandled worker errors | > 0 |
| Worker shutdown timeouts | Shutdown timeout occurrences | > 1 in 10 minutes |

### Log Patterns

Watch for these log patterns:
- `"Analytics DB async initialization failed"` - Analytics DB connection issues
- `"Circuit breaker open for ThreadSafeModuleCache"` - Module loading failures
- `"Forced shutdown due to timeout"` - Worker shutdown issues
- `"Circuit breaker ignoring client error"` - Client errors being filtered (debug level)

---

## Migration Guide

No migration required. These changes are backward compatible and activate automatically.

### Configuration (Optional)

To customize circuit breaker behavior:

```typescript
import { ThreadSafeModuleCache } from '@api/utils/moduleCache';

// Custom cache with different circuit breaker settings
const cache = new ThreadSafeModuleCache(async (key) => {
  // Your loader logic
}, {
  // Optional: override circuit breaker options
  failureThreshold: 3,      // Default: 5
  resetTimeoutMs: 60000,    // Default: 30000
  halfOpenMaxCalls: 1,      // Default: 3
});
```

---

## Future Improvements

Potential future enhancements:
1. Configurable error classification rules
2. Adaptive circuit breaker thresholds based on error rate
3. Health check integration for automatic recovery detection
4. Distributed circuit breaker state for multi-instance deployments
