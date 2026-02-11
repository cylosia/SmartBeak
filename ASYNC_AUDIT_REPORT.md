# HOSTILE ASYNC PATTERN AUDIT REPORT
**Date:** 2026-02-10  
**Scope:** apps/api/src/utils/**/*, apps/api/src/jobs/**/*, packages/kernel/**/*  
**Auditor:** Automated + Manual Review  

---

## EXECUTIVE SUMMARY

| Category | NEW | FIXED | UNFIXED | TOTAL |
|----------|-----|-------|---------|-------|
| Floating Promises | 3 | 0 | 0 | 3 |
| Unbounded Promise.all | 2 | 0 | 0 | 2 |
| Missing AbortController | 2 | 0 | 0 | 2 |
| Unhandled Rejections | 2 | 0 | 0 | 2 |
| Memory Leaks | 1 | 0 | 0 | 1 |
| Circuit Breaker Gaps | 1 | 0 | 0 | 1 |
| **TOTAL** | **11** | **0** | **0** | **11** |

---

## DETAILED FINDINGS

### 1. FLOATING PROMISES (Unawaited Async)

#### 🔴 CRITICAL: packages/kernel/health-check.js:33
- **Issue:** `setInterval` with async callback creates floating promises
- **Code:**
  ```javascript
  setInterval(async () => {
      const result = await check.check();  // Floating if check() rejects
      lastResults.set(check.name, result);
  }, check.intervalMs);
  ```
- **Impact:** Unhandled promise rejection crashes process
- **Fix:**
  ```javascript
  setInterval(() => {
      check.check()
          .then(result => lastResults.set(check.name, result))
          .catch(err => logger.error('Health check failed', err));
  }, check.intervalMs);
  ```

#### 🔴 CRITICAL: packages/kernel/queues/bullmq-worker.js:3
- **Issue:** Worker created but not stored, error handlers not attached
- **Code:**
  ```javascript
  export function startWorker(eventBus) {
      new Worker('events', async (job) => {  // Return value ignored
          await eventBus.publish(job.data);
      });
  }
  ```
- **Impact:** Worker errors go unhandled, memory leak on reload
- **Fix:**
  ```javascript
  export function startWorker(eventBus) {
      const worker = new Worker('events', async (job) => {
          await eventBus.publish(job.data);
      });
      worker.on('failed', (job, err) => {
          logger.error(`Job ${job?.id} failed:`, err);
      });
      worker.on('error', err => {
          logger.error('Worker error:', err);
      });
      return worker;  // Allow caller to manage lifecycle
  }
  ```

#### 🟡 MEDIUM: apps/api/src/utils/shutdown.js:72-73
- **Issue:** Event handlers don't await async cleanup
- **Code:**
  ```javascript
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));  // Not awaited
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  ```
- **Impact:** Process may exit before cleanup completes
- **Note:** This is partially mitigated by the timeout in gracefulShutdown, but still a pattern violation

---

### 2. UNBOUNDED Promise.all (No Concurrency Limit)

#### 🔴 CRITICAL: packages/kernel/dlq.ts:308-312
- **Issue:** Unbounded parallel deletion in purge()
- **Code:**
  ```typescript
  async purge(): Promise<void> {
      const storage = getDLQStorageInstance();
      const messages = await storage.peek(10000);
      for (const msg of messages) {
          await storage.delete(msg.id);  // Sequential but could be parallel
      }
  }
  ```
- **Note:** Current implementation is sequential (safe), but there's commented code suggesting parallel approach
- **Status:** CURRENTLY SAFE - but monitor for changes

#### 🟡 MEDIUM: apps/api/src/jobs/contentIdeaGenerationJob.js:183
- **Issue:** Promise.all with batch chunks in transaction
- **Code:**
  ```javascript
  await Promise.all(batchChunk.map((batch, chunkIndex) => 
      insertBatch(trx, batch, domainId, idempotencyKey, i + chunkIndex)
  ));
  ```
- **Impact:** Can exhaust connection pool, cause deadlocks
- **Mitigation:** MAX_CONCURRENT_BATCHES limits chunks, but each Promise.all is unbounded within chunk

---

### 3. Promise.all WITHOUT ERROR ISOLATION

#### 🟡 MEDIUM: packages/kernel/event-bus.js:69
- **Issue:** Uses Promise.allSettled but doesn't handle all failure cases
- **Code:**
  ```javascript
  const results = await Promise.allSettled(handlers.map(...));
  // Only logs errors, doesn't propagate circuit breaker state
  ```
- **Status:** PARTIALLY FIXED in .ts version with circuit breaker, .js version vulnerable

---

### 4. MISSING AbortController

#### 🔴 CRITICAL: apps/api/src/utils/retry.ts:168
- **Issue:** fetchWithRetry missing AbortController signal forwarding
- **Code:**
  ```typescript
  return withRetry(async () => {
      const response = await fetch(url, fetchInit);  // No abort signal
      ...
  }, retry);
  ```
- **Impact:** Requests cannot be cancelled, resource leaks
- **Fix:**
  ```typescript
  export async function fetchWithRetry(
      url: string,
      init: RequestInit & { retry?: RetryOptions; signal?: AbortSignal } = {}
  ): Promise<Response> {
      const { retry, signal, ...fetchInit } = init;
      return withRetry(async () => {
          const response = await fetch(url, { ...fetchInit, signal });
          ...
      }, retry);
  }
  ```

#### 🟡 MEDIUM: apps/api/src/jobs/JobScheduler.js:420
- **Issue:** Promise.all for metrics without abort/timeout
- **Code:**
  ```javascript
  const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      ...
  ]);
  ```
- **Impact:** If one Redis call hangs, entire metrics call hangs forever
- **Fix:** Use Promise.race with timeout or individual timeouts

---

### 5. RACE CONDITIONS

#### 🟡 MEDIUM: packages/kernel/retry.js:172-189
- **Issue:** CircuitBreaker.execute() not atomic - state check and execution are separate
- **Code:**
  ```javascript
  async execute(fn) {
      if (this.state === CircuitState.OPEN) {
          // Gap here - state can change between check and execution
          const timeSinceLastFailure = Date.now() - (this.lastFailureTime || 0);
          ...
      }
      // Another gap before actual execution
      const result = await fn();
      this.onSuccess();
      return result;
  }
  ```
- **Impact:** Race condition allows requests through open circuit
- **Mitigation:** .ts version uses AsyncLock - .js version still vulnerable

---

### 6. DEADLOCK POTENTIAL

#### 🟢 LOW: apps/api/src/jobs/contentIdeaGenerationJob.ts:202-235
- **Issue:** Transaction with potential long-running operations
- **Code:**
  ```typescript
  const result = await db.transaction(async (trx) => {
      await trx.raw('SET LOCAL statement_timeout = ?', [60000]);
      // UPSERT operation
      ...
      await batchInsertIdeas(trx, ideas, domainId, idempotencyKey);
  });
  ```
- **Status:** MITIGATED - statement_timeout set, sequential batch processing
- **Note:** Monitor for deadlock reports in production

---

### 7. MISSING TIMEOUT CONFIGURATIONS

#### 🟡 MEDIUM: packages/kernel/safe-handler.js:92-94
- **Issue:** Timeout promise created but not cleared on success
- **Code:**
  ```javascript
  const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Handler timed out...`)), HANDLER_TIMEOUT_MS);
  });
  ```
- **Impact:** setTimeout keeps process alive even after handler succeeds
- **Fix:**
  ```javascript
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(`Handler timed out...`)), HANDLER_TIMEOUT_MS);
  });
  try {
      await Promise.race([handler(), timeoutPromise]);
  } finally {
      clearTimeout(timeoutId);
  }
  ```

---

### 8. UNHANDLED REJECTIONS IN EVENT EMITTERS

#### 🔴 CRITICAL: apps/api/src/jobs/JobScheduler.js:207-299
- **Issue:** Worker event handlers don't catch all errors
- **Code:**
  ```javascript
  const worker = new Worker(queueName, async (job) => {
      ...
      this.emit('jobStarted', job);
      // If emit handler throws, it's unhandled
  });
  ```
- **Impact:** Event handler errors crash the worker
- **Fix:** Wrap emits in try-catch or use safe-emitter pattern

---

### 9. MEMORY LEAKS (Unremoved Listeners)

#### 🟡 MEDIUM: packages/kernel/health-check.js:33
- **Issue:** setInterval creates recurring promise chains
- **Code:**
  ```javascript
  setInterval(async () => {
      const result = await check.check();
      lastResults.set(check.name, result);
  }, check.intervalMs);
  ```
- **Impact:** Each interval tick creates new promise, old promises may retain memory
- **Fix:** Store interval handle for cleanup, add stop mechanism

---

### 10. CIRCUIT BREAKER GAPS

#### 🔴 CRITICAL: apps/api/src/utils/resilience.js:36-124
- **Issue:** JavaScript version lacks AsyncLock, vulnerable to race conditions
- **Comparison:**
  - .ts version: Uses AsyncLock for state transitions
  - .js version: Direct state access, no locking
- **Impact:** Multiple concurrent requests can bypass open circuit
- **Fix:** Port AsyncLock implementation to .js or use shared compiled output

---

## RECOMMENDATIONS BY PRIORITY

### Immediate (P0) - Fix within 24 hours
1. **packages/kernel/health-check.js:33** - Add error handling to setInterval
2. **packages/kernel/queues/bullmq-worker.js:3** - Add error handlers and return worker
3. **apps/api/src/utils/resilience.js** - Port AsyncLock from .ts version

### High (P1) - Fix within 1 week
4. **apps/api/src/utils/retry.ts:168** - Add AbortController support to fetchWithRetry
5. **apps/api/src/jobs/JobScheduler.js:420** - Add timeouts to metrics calls
6. **packages/kernel/safe-handler.js:92-94** - Clear timeout on success

### Medium (P2) - Fix within 1 month
7. **apps/api/src/jobs/contentIdeaGenerationJob.js:183** - Add concurrency limit to Promise.all
8. **packages/kernel/event-bus.js:69** - Ensure consistent circuit breaker usage
9. Add comprehensive async trace logging

### Low (P3) - Monitor and improve
10. Add async resource metrics
11. Implement distributed circuit breaker (Redis-backed)
12. Add chaos engineering tests for async failures

---

## FILES REQUIRING IMMEDIATE ATTENTION

```
packages/kernel/health-check.js        (CRITICAL - floating promises)
packages/kernel/queues/bullmq-worker.js (CRITICAL - unhandled errors)
apps/api/src/utils/resilience.js       (CRITICAL - race conditions)
apps/api/src/utils/retry.ts            (HIGH - missing abort support)
apps/api/src/jobs/JobScheduler.js      (HIGH - hanging metrics)
```

---

## POSITIVE FINDINGS (Well Implemented Patterns)

1. **JobScheduler.ts** - Proper cleanup of event listeners in stop()
2. **RegionWorker.ts** - Bounded concurrency with adaptive limits
3. **DLQService.ts** - Transaction timeouts configured
4. **contentIdeaGenerationJob.ts** - Sequential batch processing to avoid deadlocks
5. **domainExportJob.ts** - Concurrency limits on markdown processing
6. **retry.ts (kernel)** - AsyncLock for thread-safe circuit breaker
7. **event-bus.ts** - Promise.allSettled with circuit breaker protection

---

*Report generated with hostile audit methodology - assumes every promise can fail.*
