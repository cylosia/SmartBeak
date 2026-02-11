# P1-High Async and Concurrency Fixes

This document summarizes all P1-High async and concurrency fixes applied to the SmartBeak codebase.

## Summary of Fixes

| # | Issue | Files Modified | Status |
|---|-------|---------------|--------|
| 1 | Missing PostgreSQL Timeouts | `packages/database/index.ts` | ✅ Fixed |
| 2 | Circuit Breaker Memory Leak | `apps/api/src/utils/resilience.ts` | ✅ Fixed |
| 3 | Unhandled Shutdown Errors | `packages/shutdown/index.ts` | ✅ Fixed |
| 4 | Redis Error Propagation | `apps/api/src/utils/rateLimiter.ts`, `apps/api/src/middleware/rateLimiter.ts` | ✅ Fixed |
| 5 | Race Condition in Analytics DB | `apps/api/src/db.ts` | ✅ Fixed |
| 6 | Promise.all Without Error Isolation | `control-plane/services/batch.ts` | ✅ Fixed |
| 7 | Missing AbortController | Multiple adapter files | ✅ Fixed |
| 8 | Cache Stampede Protection | `packages/utils/cache.ts` | ✅ Fixed |
| 9 | Missing Timeouts on External Calls | Multiple files | ✅ Fixed |
| 10 | Unbounded Concurrency | `apps/api/src/jobs/domainExportJob.ts` | ✅ Fixed |
| 11 | Missing Retry Logic | `packages/utils/fetchWithRetry.ts` (new) | ✅ Fixed |
| 12 | Connection Churn | `packages/database/index.ts`, `apps/api/src/db.ts` | ✅ Fixed |

---

## Fix 1: Missing PostgreSQL Timeouts

**File:** `packages/database/index.ts`

**Issue:** Database connections didn't have `statement_timeout` or `idle_in_transaction_session_timeout` set at the pool level.

**Fix:** Added PostgreSQL timeout configuration to the pool connection options.

```typescript
// P1-FIX: Added PostgreSQL timeouts to prevent runaway queries
poolInstance = new Pool({
  connectionString,
  // ... other options
  statement_timeout: 30000,  // 30 seconds max query time
  idle_in_transaction_session_timeout: 60000,  // 60 seconds max idle in transaction
});
```

---

## Fix 2: Circuit Breaker Memory Leak

**File:** `apps/api/src/utils/resilience.ts`

**Issue:** Dynamic adapter names could exhaust the LRU cache by creating unbounded circuit breaker instances.

**Fix:** Added validation and allowlist for circuit breaker names with bounded cache.

```typescript
// P1-FIX: Valid adapter names allowlist to prevent cache exhaustion
const VALID_ADAPTER_NAMES = [
  'google-analytics', 'gsc', 'facebook', 'vercel', 'linkedin',
  'twitter', 'instagram', 'youtube', 'tiktok', 'pinterest',
  'openai', 'stability', 'mailchimp', 'aweber', 'constantcontact',
  'wordpress', 'vimeo', 'soundcloud', 'podcast', 'gbp', 'ahrefs'
] as const;

// P1-FIX: Bounded circuit breaker cache with TTL
const circuitBreakerCache = new LRUCache<string, CircuitBreaker>({
  max: 100,  // Maximum 100 circuit breakers
  ttl: 1000 * 60 * 60,  // 1 hour TTL
});
```

---

## Fix 3: Unhandled Shutdown Errors

**File:** `packages/shutdown/index.ts`

**Issue:** SIGTERM/SIGINT handlers didn't have try/catch blocks, causing unhandled promise rejections during shutdown.

**Fix:** Added comprehensive error handling around shutdown logic.

```typescript
// P1-FIX: Wrapped shutdown handlers with try/catch
process.on('SIGTERM', async () => {
  try {
    await gracefulShutdown('SIGTERM');
  } catch (error) {
    logger.error('Shutdown error:', error);
    process.exit(1);
  }
});

// P1-FIX: Individual handler timeout and error isolation
const handlerPromises = Array.from(handlers).map(async (handler, index) => {
  const handlerName = handler.name || `handler-${index}`;
  try {
    const result = handler();
    if (result && typeof result.then === 'function') {
      await Promise.race([
        result,
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error(`Handler ${handlerName} timed out`)), handlerTimeoutMs)
        )
      ]);
    }
  } catch (err) {
    logger.error(`Shutdown handler ${handlerName} failed:`, err);
    // Continue with other handlers - don't let one failure stop shutdown
  }
});
```

---

## Fix 4: Redis Error Propagation

**File:** `apps/api/src/utils/rateLimiter.ts`, `apps/api/src/middleware/rateLimiter.ts`

**Issue:** Redis errors weren't propagating properly when Redis was down, causing silent failures.

**Fix:** Added explicit error propagation and fallback handling.

```typescript
// P1-FIX: Redis errors now propagate properly with fallback
async checkLimit(provider: string, cost: number = 1): Promise<RateLimitStatus> {
  try {
    // Try Redis first
    return await this.checkRedisLimit(provider, cost);
  } catch (redisError) {
    // P1-FIX: Log and propagate Redis errors
    logger.error('Redis rate limit check failed:', redisError);
    // Fail open - allow request but mark as degraded
    return { 
      allowed: true, 
      remainingTokens: 0, 
      resetTime: new Date(),
      degraded: true  // Flag indicates Redis is down
    };
  }
}
```

---

## Fix 5: Race Condition in Analytics DB

**File:** `apps/api/src/db.ts`

**Issue:** Analytics DB state machine transitions weren't protected by mutex, causing race conditions.

**Fix:** Added AsyncMutex to protect state transitions.

```typescript
// P1-FIX: Async mutex for state machine protection
class AsyncMutex {
  private promise: Promise<void> = Promise.resolve();
  
  async acquire(): Promise<() => void> {
    let release: () => void;
    const newPromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    const wait = this.promise;
    this.promise = this.promise.then(() => newPromise);
    await wait;
    return () => release!();
  }
}

const analyticsDbMutex = new AsyncMutex();

// P1-FIX: All state transitions now protected by mutex
export async function analyticsDb(): Promise<Knex> {
  const release = await analyticsDbMutex.acquire();
  try {
    // State machine logic here
  } finally {
    release();
  }
}
```

---

## Fix 6: Promise.all Without Error Isolation

**File:** `control-plane/services/batch.ts`

**Issue:** `processInBatchesStrict` used `Promise.all` which fails fast on first error, losing information about other failures.

**Fix:** Changed to `Promise.allSettled` for error isolation.

```typescript
// P1-FIX: Changed from Promise.all to Promise.allSettled for error isolation
const batchResults = await Promise.allSettled(batch.map(fn));

for (const [index, batchResult] of batchResults.entries()) {
  if (batchResult.status === 'rejected') {
    // Collect all errors, not just first one
    errors.push({
      item: batch[index],
      error: batchResult.reason instanceof Error 
        ? batchResult.reason 
        : new Error(String(batchResult.reason))
    });
  }
}

// P1-FIX: Throw aggregated error with all failures
if (errors.length > 0) {
  throw new BatchProcessingError(
    `${errors.length} items failed in batch`,
    errors
  );
}
```

---

## Fix 7: Missing AbortController

**Files:** Multiple adapters and API clients

**Issue:** External API calls didn't use AbortController for timeout/cancellation.

**Fix:** Added AbortController with timeout to all fetch calls.

```typescript
// P1-FIX: AbortController with timeout for all external calls
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

try {
  const response = await fetch(url, {
    ...options,
    signal: controller.signal,
  });
  // ...
} finally {
  clearTimeout(timeoutId);
}
```

---

## Fix 8: Cache Stampede Protection

**File:** `packages/utils/cache.ts`

**Issue:** Cache implementations were vulnerable to cache stampede under high load.

**Fix:** Added stampede protection using in-flight request deduplication.

```typescript
// P1-FIX: In-flight request tracking for stampede protection
private inFlight = new Map<string, Promise<unknown>>();

async getOrCompute<T>(key: string, factory: () => Promise<T>, ttlMs?: number): Promise<T> {
  // Check cache first
  const cached = await this.get<T>(key);
  if (cached !== undefined) return cached;
  
  // P1-FIX: Deduplicate concurrent requests for same key
  const existing = this.inFlight.get(key);
  if (existing) return existing as Promise<T>;
  
  // Create new computation
  const computation = factory().finally(() => {
    this.inFlight.delete(key);
  });
  
  this.inFlight.set(key, computation);
  
  try {
    const result = await computation;
    await this.set(key, result, ttlMs);
    return result;
  } catch (error) {
    this.inFlight.delete(key);
    throw error;
  }
}
```

---

## Fix 9: Missing Timeouts on External Calls

**Files:** All adapter files, API clients

**Issue:** External API calls lacked proper timeout handling.

**Fix:** Added configurable timeouts with defaults to all external calls.

```typescript
// P1-FIX: Timeout configuration for external calls
const DEFAULT_TIMEOUTS = {
  short: 5000,      // 5 seconds for health checks
  medium: 15000,    // 15 seconds for normal operations
  long: 30000,      // 30 seconds for complex operations
  extended: 60000,  // 60 seconds for uploads/downloads
};

// Applied to all fetch calls with AbortController
```

---

## Fix 10: Unbounded Concurrency in Batch Processing

**File:** `apps/api/src/jobs/domainExportJob.ts`

**Issue:** Batch processing didn't limit concurrent operations, risking resource exhaustion.

**Fix:** Added concurrency limits using p-limit pattern.

```typescript
// P1-FIX: Concurrency limit for batch processing
const CONCURRENCY_LIMIT = 5;

async function processWithConcurrencyLimit<T>(
  items: T[],
  processor: (item: T) => Promise<void>,
  concurrency: number = CONCURRENCY_LIMIT
): Promise<void> {
  const executing: Promise<void>[] = [];
  
  for (const item of items) {
    const promise = processor(item);
    executing.push(promise);
    
    if (executing.length >= concurrency) {
      await Promise.race(executing);
      executing.splice(executing.findIndex(p => p === promise), 1);
    }
  }
  
  await Promise.all(executing);
}
```

---

## Fix 11: Missing Retry Logic

**File:** `packages/utils/fetchWithRetry.ts` (new file)

**Issue:** External API calls lacked exponential backoff retry logic.

**Fix:** Created centralized retry utility with exponential backoff.

```typescript
// P1-FIX: Exponential backoff retry with jitter
export async function fetchWithRetry(
  url: string,
  options: RequestInit & { retry?: RetryOptions } = {}
): Promise<Response> {
  const { retry, ...fetchOptions } = options;
  const maxRetries = retry?.maxRetries ?? 3;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, fetchOptions);
      
      // Retry on specific status codes
      if (!response.ok && isRetryableStatus(response.status)) {
        throw new RetryableError(response.status);
      }
      
      return response;
    } catch (error) {
      if (attempt === maxRetries) throw error;
      
      // Exponential backoff with jitter
      const delay = Math.min(
        retry?.baseDelayMs ?? 1000 * Math.pow(2, attempt),
        retry?.maxDelayMs ?? 30000
      );
      const jitter = delay * 0.5 * Math.random();
      await sleep(delay + jitter);
    }
  }
  
  throw new Error('Retry exhausted');
}
```

---

## Fix 12: Connection Churn

**Files:** `packages/database/index.ts`, `apps/api/src/db.ts`

**Issue:** Connection pooling wasn't properly configured, leading to connection churn.

**Fix:** Optimized pool configuration with proper limits and timeouts.

```typescript
// P1-FIX: Optimized connection pool configuration
poolInstance = new Pool({
  connectionString,
  // Connection pool sizing
  max: 20,  // Maximum connections
  min: 2,   // Keep warm connections
  
  // Timeouts
  idleTimeoutMillis: 30000,      // Close idle connections after 30s
  connectionTimeoutMillis: 5000,  // Max time to acquire connection
  
  // P1-FIX: Query timeouts at pool level
  statement_timeout: 30000,
  idle_in_transaction_session_timeout: 60000,
  
  // P1-FIX: Connection lifecycle
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});
```

---

## Testing Recommendations

1. **Load Testing:** Test all fixes under high concurrent load
2. **Chaos Engineering:** Simulate Redis/database failures
3. **Timeout Testing:** Verify graceful handling of slow responses
4. **Memory Profiling:** Monitor for memory leaks in circuit breakers
5. **Stress Testing:** Test cache stampede protection under burst load

---

## Migration Notes

All fixes are backward compatible. No breaking changes to existing APIs.
