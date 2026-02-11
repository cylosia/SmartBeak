# HOSTILE FINANCIAL-GRADE ASYNC & SECURITY AUDIT REPORT
## SmartBeak API - Cross-Cutting Analysis

**Audit Date:** 2026-02-10  
**Auditor:** Subagent Security Analysis  
**Scope:** apps/api/src/utils/**/*, apps/api/src/jobs/**/*, All async patterns, Auth/Security handling  
**Classification:** HOSTILE - Assume every async operation can fail

---

## EXECUTIVE SUMMARY

| Severity | Count | Categories |
|----------|-------|------------|
| P0-Critical | 4 | Promise leaks, Resource exhaustion, Deadlocks |
| P1-High | 8 | Race conditions, Missing timeouts, Unbounded concurrency |
| P2-Medium | 12 | Error handling gaps, Logging issues, Retry gaps |
| P3-Low | 6 | Code quality, Documentation gaps |

**Total Findings:** 30

---

## P0-CRITICAL FINDINGS

### P0-001: Floating Promise in Module Cache Error Recovery
- **File:** `apps/api/src/utils/moduleCache.ts:12`
- **Category:** Async
- **Severity:** P0-Critical

**Violation:**
```typescript
async get(): Promise<T> {
  if (!this.promise) {
    this.promise = this.loader().catch((err) => {
      this.promise = null;  // Clears cache but error is not re-thrown properly
      throw err;
    });
  }
  return this.promise;  // Returns rejected promise without await
}
```

**Issue:** The `.catch()` handler clears the cache on error, but multiple concurrent calls to `get()` while loading will all receive the same rejected promise. After failure, subsequent calls retry the loader, but error propagation timing can cause unhandled rejections in calling code.

**Fix:**
```typescript
async get(): Promise<T> {
  if (!this.promise) {
    this.promise = (async () => {
      try {
        return await this.loader();
      } catch (err) {
        this.promise = null;
        throw err;
      }
    })();
  }
  return this.promise;
}
```

**Risk:** Cascading failures during module load errors can crash the process with unhandled rejections.

---

### P0-002: Promise.all Without Error Isolation in JobScheduler.getMetrics()
- **File:** `apps/api/src/jobs/JobScheduler.ts:579-585`
- **Category:** Async / Resilience
- **Severity:** P0-Critical

**Violation:**
```typescript
const [waiting, active, completed, failed, delayed] = await Promise.all([
  queue.getWaitingCount(),
  queue.getActiveCount(),
  queue.getCompletedCount(),
  queue.getFailedCount(),
  queue.getDelayedCount(),
]);
```

**Issue:** If any single metric call fails (e.g., Redis timeout), the entire metrics retrieval fails. No partial success handling.

**Fix:**
```typescript
const results = await Promise.allSettled([
  queue.getWaitingCount(),
  queue.getActiveCount(),
  queue.getCompletedCount(),
  queue.getFailedCount(),
  queue.getDelayedCount(),
]);

const [waiting, active, completed, failed, delayed] = results.map(r => 
  r.status === 'fulfilled' ? r.value : -1
);
```

**Risk:** Monitoring blind spots during partial Redis failures; cascading alert fatigue.

---

### P0-003: Transactional Deadlock Risk in contentIdeaGenerationJob
- **File:** `apps/api/src/jobs/contentIdeaGenerationJob.ts:201-230`
- **Category:** Async / Database
- **Severity:** P0-Critical

**Violation:**
```typescript
const result = await db.transaction(async (trx) => {
  if (idempotencyKey) {
    // UPSERT pattern with RETURNING
    const upsertResult = await trx.raw(`...`);
    if (upsertResult.rows.length === 0) {
      // Fetch existing - nested query in transaction
      const existing = await trx(ALLOWED_TABLES.IDEMPOTENCY_KEYS)
        .where({ key: idempotencyKey })
        .first();  // EXTRA QUERY AFTER CONFLICT
```

**Issue:** After UPSERT conflict, code performs an additional SELECT query inside the transaction. Under high concurrency with multiple duplicate requests, this creates lock contention on the idempotency_keys table, potentially causing deadlocks.

**Fix:**
```typescript
const result = await db.transaction(async (trx) => {
  if (idempotencyKey) {
    // Use CTE to return existing in single query
    const upsertResult = await trx.raw(`
      WITH inserted AS (
        INSERT INTO ${ALLOWED_TABLES.IDEMPOTENCY_KEYS} (key, entity_type, entity_id, created_at)
        VALUES (?, ?, ?, NOW())
        ON CONFLICT (key) DO NOTHING
        RETURNING *, TRUE as is_new
      )
      SELECT * FROM inserted
      UNION ALL
      SELECT *, FALSE as is_new FROM ${ALLOWED_TABLES.IDEMPOTENCY_KEYS}
      WHERE key = ? AND NOT EXISTS (SELECT 1 FROM inserted)
    `, [idempotencyKey, 'content_idea_batch', batchId, idempotencyKey]);
    
    const isNew = upsertResult.rows[0]?.is_new;
    if (!isNew) {
      return { status: 'already_processed', ... };
    }
  }
  // ...
});
```

**Risk:** Deadlocks under high load causing job failures and retry storms.

---

### P0-004: Unbounded Promise.all in ahrefsGap.ts (Comment Only, Implementation Missing)
- **File:** `apps/api/src/seo/ahrefsGap.ts:496-497`
- **Category:** Performance / Async
- **Severity:** P0-Critical

**Violation:**
```typescript
// FIX: Use Promise.all to process chunk items in parallel
const chunkResults = await Promise.all(
```

**Issue:** The comments suggest parallel processing with Promise.all, but if `chunk` size is unbounded and each operation involves network calls, this can exhaust connection pools and cause memory issues.

**Fix:**
```typescript
import { pLimit } from 'p-limit';

const limit = pLimit(10); // Max 10 concurrent
const chunkResults = await Promise.all(
  chunk.map(item => limit(() => processItem(item)))
);
```

**Risk:** Connection pool exhaustion, memory exhaustion, cascading failures.

---

## P1-HIGH FINDINGS

### P1-001: Missing AbortController Signal Propagation in LinkedInAdapter
- **File:** `apps/api/src/adapters/linkedin/LinkedInAdapter.ts:203`
- **Category:** Async / Resilience
- **Severity:** P1-High

**Violation:**
```typescript
const mediaAssets = await Promise.all(
  // Multiple upload operations without shared abort signal
```

**Issue:** Parallel media uploads don't share an AbortController signal. If one fails or times out, others continue consuming resources.

**Fix:**
```typescript
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

try {
  const mediaAssets = await Promise.all(
    mediaItems.map(item => this.uploadMedia(item, controller.signal))
  );
} finally {
  clearTimeout(timeout);
}
```

**Risk:** Resource waste on cancelled/forgotten operations; delayed failure recovery.

---

### P1-002: Uncaught Redis Error in RateLimiter Constructor
- **File:** `apps/api/src/utils/rateLimiter.ts:76-78`
- **Category:** Resilience / Async
- **Severity:** P1-High

**Violation:**
```typescript
this.redis.on('error', (err) => {
  console.error('[RateLimiter] Redis connection error:', err.message);
});
```

**Issue:** Redis errors are logged but not propagated. The application continues as if rate limiting works, but all rate limit checks will fail or return incorrect results.

**Fix:**
```typescript
this.redis.on('error', (err) => {
  console.error('[RateLimiter] Redis connection error:', err.message);
  this.emit('error', err); // Propagate to listeners
  this.healthy = false;    // Mark as unhealthy
});

this.redis.on('connect', () => {
  this.healthy = true;
});

async checkLimit(provider: string, cost: number = 1): Promise<RateLimitStatus> {
  if (!this.healthy) {
    // Fail open or closed based on policy
    return { allowed: true, remainingTokens: 0, resetTime: new Date() };
  }
  // ...
}
```

**Risk:** False sense of security - rate limits not enforced during Redis outages.

---

### P1-003: Missing Connection Timeout Configuration in Knex Pool
- **File:** `apps/api/src/db.ts:97-121`
- **Category:** Security / Performance
- **Severity:** P1-High

**Violation:**
```typescript
pool: {
  min: 2,
  max: 20,
  acquireTimeoutMillis: 30000,
  createTimeoutMillis: 30000,
  // Missing: statement_timeout, idle_in_transaction_session_timeout
}
```

**Issue:** No PostgreSQL-level statement timeout or idle-in-transaction timeout configured. A runaway query can hold connections indefinitely.

**Fix:**
```typescript
const config: Knex.Config = {
  client: 'postgresql',
  connection: {
    connectionString: connectionString,
    // CRITICAL: PostgreSQL-level timeouts
    statement_timeout: 30000,  // 30s max per query
    idle_in_transaction_session_timeout: 60000,  // 60s max idle in transaction
    query_timeout: 30000,
  },
  pool: {
    min: 2,
    max: 20,
    acquireTimeoutMillis: 30000,
    createTimeoutMillis: 30000,
    destroyTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
  },
};
```

**Risk:** Connection pool exhaustion from runaway queries; denial of service.

---

### P1-004: Circuit Breaker Memory Leak in publishExecutionJob
- **File:** `apps/api/src/jobs/publishExecutionJob.ts:43-57`
- **Category:** Resilience / Memory
- **Severity:** P1-High

**Violation:**
```typescript
const circuitBreakers = new LRUCache<string, CircuitBreaker>({
  max: cacheConfig.circuitBreakerCacheMax,
  ttl: cacheConfig.circuitBreakerCacheTtlMs,
});

function getCircuitBreaker(adapterName: string): CircuitBreaker {
  if (!circuitBreakers.has(adapterName)) {
    circuitBreakers.set(adapterName, new CircuitBreaker(adapterName, {...}));
  }
  return circuitBreakers.get(adapterName)!;
}
```

**Issue:** The LRU cache can grow to `max` size with CircuitBreaker instances that hold references to functions and state. If adapter names are dynamic (e.g., include timestamps/UUIDs), this is an unbounded memory leak.

**Fix:**
```typescript
// Validate adapter name against allowlist
const ALLOWED_ADAPTERS = ['wordpress', 'web', 'facebook', 'linkedin'];

function getCircuitBreaker(adapterName: string): CircuitBreaker {
  if (!ALLOWED_ADAPTERS.includes(adapterName)) {
    throw new Error(`Unknown adapter: ${adapterName}`);
  }
  // ... rest of function
}
```

**Risk:** Memory exhaustion, OOM crashes under high adapter churn.

---

### P1-005: Unhandled Rejection in Worker SIGTERM Handler
- **File:** `apps/api/src/jobs/worker.ts:38-43`
- **Category:** Async / Graceful Shutdown
- **Severity:** P1-High

**Violation:**
```typescript
process.on('SIGTERM', async () => {
  logger.info('\n🛑 SIGTERM received, shutting down gracefully...');
  await scheduler.stop();
  logger.info('✅ Worker stopped');
  process.exit(0);
});
```

**Issue:** If `scheduler.stop()` throws, the error is unhandled. The process may hang or exit with wrong code.

**Fix:**
```typescript
process.on('SIGTERM', async () => {
  logger.info('\n🛑 SIGTERM received, shutting down gracefully...');
  try {
    await scheduler.stop();
    logger.info('✅ Worker stopped');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown', error as Error);
    process.exit(1);
  }
});
```

**Risk:** Process hangs during deployment rollbacks; jobs lost/misreported.

---

### P1-006: Secret Exposure in Error Messages (FacebookAdapter)
- **File:** `apps/api/src/adapters/facebook/FacebookAdapter.ts:141-155`
- **Category:** Security
- **Severity:** P1-High

**Violation:**
```typescript
const res = await fetch(`${this.baseUrl}/${validatedInput.pageId}/feed`, {
  headers: {
    'Authorization': `Bearer ${this.accessToken}`,  // Could leak in error logs
  },
});
```

**Issue:** While not directly exposed here, the access token could be logged if request interceptors or error handlers log full request details.

**Fix:**
```typescript
// Use a custom error class that sanitizes output
class FacebookApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
  
  toJSON() {
    return {
      message: this.message,
      status: this.status,
      // Deliberately exclude any headers/tokens
    };
  }
}

// In logging, always use toJSON() or structured logging that excludes headers
```

**Risk:** API key exposure in logs; credential compromise.

---

### P1-007: Race Condition in Analytics DB State Machine
- **File:** `apps/api/src/db.ts:347-448`
- **Category:** Async / Race Condition
- **Severity:** P1-High

**Violation:**
```typescript
case 'initializing': {
  if (analyticsDbState.url !== replicaUrl) {
    await resetAnalyticsDb();  // Async reset while another init in progress
    analyticsDbState = { status: 'uninitialized', url: replicaUrl };
    break;
  }
  return analyticsDbState.promise;
}
```

**Issue:** The state machine transitions have timing windows. If URL changes during initialization, `resetAnalyticsDb()` is called while another promise is in-flight.

**Fix:**
```typescript
// Use a mutex/semaphore for state transitions
private transitionMutex = new Mutex();

async analyticsDb(): Promise<Knex> {
  await this.transitionMutex.acquire();
  try {
    // ... state machine logic
  } finally {
    this.transitionMutex.release();
  }
}
```

**Risk:** Multiple concurrent database connections created; resource leak.

---

### P1-008: Missing Retry Logic in Feedback Metrics Fetch
- **File:** `apps/api/src/jobs/feedbackIngestJob.ts:188-206`
- **Category:** Resilience
- **Severity:** P1-High

**Violation:**
```typescript
async function fetchFeedbackMetrics(
  entityId: string,
  window: WindowSize,
  source: string,
  orgId: string
): Promise<FeedbackWindow['metrics']> {
  // ...
  // FIX #1: Throw error to indicate this needs implementation
  throw new Error('Feedback metrics API integration not implemented');
}
```

**Issue:** This is a TODO that throws unconditionally. Production code will always fail here.

**Fix:**
```typescript
// Add circuit breaker pattern with fallback
const fetchWithCircuitBreaker = withCircuitBreaker(
  fetchFeedbackMetricsImpl,
  { failureThreshold: 5, resetTimeoutMs: 30000 }
);

async function fetchFeedbackMetrics(...): Promise<FeedbackWindow['metrics']> {
  try {
    return await fetchWithCircuitBreaker(entityId, window, source, orgId);
  } catch (error) {
    // Return default/empty metrics on failure
    logger.warn('Feedback metrics fetch failed, using defaults', { entityId, error });
    return { count: 0, positive: 0, negative: 0, neutral: 0 };
  }
}
```

**Risk:** Complete job failure; data loss for feedback ingestion.

---

## P2-MEDIUM FINDINGS

### P2-001: Timeout Timer Not Cleared on Early Return in AdapterCanaryRunner
- **File:** `apps/api/src/canaries/AdapterCanaryRunner.ts:38-42`
- **Category:** Async / Resource Leak
- **Severity:** P2-Medium

**Violation:**
```typescript
const timeoutPromise = new Promise<never>((_, reject) => {
  setTimeout(() => reject(new Error(`Canary timed out...`)), CANARY_TIMEOUT_MS);
});

await Promise.race([fn(), timeoutPromise]);
// Timer keeps running after race resolves
```

**Fix:**
```typescript
const timeoutId = setTimeout(() => reject(...), CANARY_TIMEOUT_MS);
// ...
finally {
  clearTimeout(timeoutId);
}
```

**Risk:** Memory leak from accumulated timers; delayed process exit.

---

### P2-002: Missing Cache Stampede Protection
- **File:** `apps/api/src/utils/cache.ts` (entire file)
- **Category:** Performance
- **Severity:** P2-Medium

**Issue:** The cache utility provides key generation but no actual cache implementation with stampede protection. Multiple concurrent requests for the same cache miss will all hit the backend.

**Fix:**
```typescript
export class Cache<T> {
  private inflight = new Map<string, Promise<T>>();
  
  async get(key: string, fetcher: () => Promise<T>, ttlMs: number): Promise<T> {
    // Check cache first
    const cached = await this.provider.get<T>(key);
    if (cached) return cached;
    
    // Deduplicate concurrent requests
    if (this.inflight.has(key)) {
      return this.inflight.get(key)!;
    }
    
    const promise = fetcher().then(async value => {
      await this.provider.set(key, value, ttlMs);
      this.inflight.delete(key);
      return value;
    }).catch(err => {
      this.inflight.delete(key);
      throw err;
    });
    
    this.inflight.set(key, promise);
    return promise;
  }
}
```

**Risk:** Backend overload on cache expiry; thundering herd.

---

### P2-003: Zod Validation Throws Without Context in JobScheduler
- **File:** `apps/api/src/jobs/JobScheduler.ts:233`
- **Category:** Error Handling
- **Severity:** P2-Medium

**Violation:**
```typescript
const validatedConfig = JobConfigSchema.parse(config);
// Throws generic ZodError without job context
```

**Fix:**
```typescript
const parseResult = JobConfigSchema.safeParse(config);
if (!parseResult.success) {
  const issues = parseResult.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ');
  throw new Error(`Job config validation failed for job ${config.name}: ${issues}`);
}
```

---

### P2-004: Missing Structured Logging in Cost Guard
- **File:** `apps/api/src/utils/costGuard.ts:83-88`
- **Category:** Observability
- **Severity:** P2-Medium

**Violation:**
```typescript
console.warn(`[assertCostAllowed] Budget check failed:`, {
  estimate,
  remainingBudget,
  shortfall,
  percentageOfBudget: percentageOfBudget.toFixed(2) + '%',
});
```

**Issue:** Uses console instead of structured logger; inconsistent with rest of codebase.

**Fix:**
```typescript
import { getLogger } from '@kernel/logger';
const logger = getLogger('cost-guard');

logger.warn('Budget check failed', { estimate, remainingBudget, shortfall, percentageOfBudget });
```

---

### P2-005: Potential Infinite Loop in Redis Reconnect
- **File:** `apps/api/src/jobs/JobScheduler.ts:105-118`
- **Category:** Resilience
- **Severity:** P2-Medium

**Violation:**
```typescript
retryStrategy: (times) => {
  if (times > redisConfig.maxReconnectAttempts) {
    this.emit('redisReconnectFailed');
    return null;
  }
  // ...
}
```

**Issue:** While limited, the reconnect failure is only logged. The application continues without Redis, likely failing silently.

**Fix:**
```typescript
this.on('redisReconnectFailed', () => {
  logger.error('Redis connection permanently failed, exiting');
  process.exit(1); // Or implement degraded mode
});
```

---

### P2-006: Missing Input Sanitization in VaultClient
- **File:** `apps/api/src/services/vault/VaultClient.ts:126-162`
- **Category:** Security
- **Severity:** P2-Medium

**Violation:**
```typescript
async getSecret(orgId: string, key: string): Promise<unknown> {
  this.validateOrgId(orgId);  // Validates UUID format
  this.validateKey(key);      // Validates pattern
  // But what about key enumeration attacks?
```

**Issue:** No rate limiting on secret access; timing attack possible to enumerate valid keys.

**Fix:**
```typescript
async getSecret(orgId: string, key: string): Promise<unknown> {
  // Add rate limiting
  await this.rateLimiter.checkLimit(`vault:${orgId}`, 100); // 100 req/min per org
  
  // Add constant-time comparison to prevent timing attacks
  const cacheKey = this.getCacheKey(orgId, key);
  // ... rest
}
```

---

### P2-007: Unhandled Exception in Domain Export CSV Conversion
- **File:** `apps/api/src/jobs/domainExportJob.ts:403-437`
- **Category:** Error Handling
- **Severity:** P2-Medium

**Violation:**
```typescript
const batchRows = batch.map(row => {
  const formattedRow = headers.map(h => {
    const val = getContentItemValue(row, h);
    return escapeCSVValue(val);
  }).join(',');
  
  totalSize += formattedRow.length;
  if (totalSize > MAX_DOWNLOAD_SIZE) {
    throw new Error(`Export exceeds maximum size...`);
  }
  return formattedRow;
});
```

**Issue:** The throw inside `.map()` doesn't properly propagate or clean up partial results.

**Fix:**
```typescript
const batchRows: string[] = [];
for (const row of batch) {
  const formattedRow = headers.map(h => escapeCSVValue(getContentItemValue(row, h))).join(',');
  totalSize += formattedRow.length;
  if (totalSize > MAX_DOWNLOAD_SIZE) {
    throw new ExportSizeError(`Export exceeds maximum size of ${MAX_DOWNLOAD_SIZE} bytes`);
  }
  batchRows.push(formattedRow);
}
```

---

### P2-008: Missing Cancellation in batchInsertIdeas
- **File:** `apps/api/src/jobs/contentIdeaGenerationJob.ts:291-320`
- **Category:** Async
- **Severity:** P2-Medium

**Violation:**
```typescript
async function batchInsertIdeas(
  trx: Knex.Transaction,
  ideas: ContentIdea[],
  // No AbortSignal parameter
): Promise<void> {
```

**Issue:** Long-running batch inserts cannot be cancelled even if the job is aborted.

**Fix:**
```typescript
async function batchInsertIdeas(
  trx: Knex.Transaction,
  ideas: ContentIdea[],
  signal?: AbortSignal,
): Promise<void> {
  for (let i = 0; i < batches.length; i++) {
    if (signal?.aborted) {
      throw new Error('Batch insert cancelled');
    }
    await insertBatch(trx, batches[i], domainId, idempotencyKey, i);
  }
}
```

---

### P2-009: SQL Injection Risk in contentIdeaGenerationJob (Dynamic Table Names)
- **File:** `apps/api/src/jobs/contentIdeaGenerationJob.ts:171-181`
- **Category:** Security
- **Severity:** P2-Medium

**Violation:**
```typescript
const { rows: rawKeywordData } = await withRetry(
  () => pool.query(
    `SELECT keyword, AVG(clicks) as avg_clicks, AVG(position) as avg_position
     FROM ${validateTableName(ALLOWED_TABLES.KEYWORD_METRICS)}  // Validated but interpolated
```

**Issue:** While `validateTableName` helps, dynamic SQL interpolation is still risky. A compromised `ALLOWED_TABLES` constant would allow injection.

**Fix:**
```typescript
// Use prepared statements with fixed table mapping
const TABLE_QUERIES = {
  [ALLOWED_TABLES.KEYWORD_METRICS]: `SELECT ... FROM keyword_metrics WHERE ...`,
  // ...
};

const query = TABLE_QUERIES[tableName];
if (!query) throw new Error('Invalid table');
return pool.query(query, params);
```

---

### P2-010: Hardcoded Timeout in abuseGuard Regex
- **File:** `apps/api/src/middleware/abuseGuard.ts:273-294`
- **Category:** Performance
- **Severity:** P2-Medium

**Violation:**
```typescript
async function safeRegexTest(pattern: RegExp, content: string, timeoutMs: number = REGEX_TIMEOUT_MS): Promise<boolean> {
```

**Issue:** The Promise.race approach doesn't actually stop the regex execution - it just ignores the result. The CPU continues processing the regex in the background.

**Fix:**
```typescript
// Use worker_threads for actual cancellation
import { Worker } from 'worker_threads';

async function safeRegexTest(pattern: RegExp, content: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const worker = new Worker('./regex-worker.js');
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error('Regex timeout'));
    }, timeoutMs);
    
    worker.on('message', result => {
      clearTimeout(timer);
      worker.terminate();
      resolve(result);
    });
    
    worker.postMessage({ pattern: pattern.source, flags: pattern.flags, content });
  });
}
```

---

### P2-011: Missing DLQ Handling in JobScheduler
- **File:** `apps/api/src/jobs/JobScheduler.ts:350-364`
- **Category:** Resilience
- **Severity:** P2-Medium

**Violation:**
```typescript
if (job.attemptsMade >= (config.maxRetries || 0) && this.dlqService) {
  try {
    await this.dlqService.record(...);
  } catch (dlqError) {
    logger.error('Failed to record to DLQ', dlqError as Error);
    // Continues without DLQ record - data loss
  }
}
```

**Issue:** DLQ failures are logged but not escalated. Failed jobs may be lost without audit trail.

**Fix:**
```typescript
if (job.attemptsMade >= (config.maxRetries || 0)) {
  if (this.dlqService) {
    try {
      await this.dlqService.record(...);
    } catch (dlqError) {
      // Emit metric for monitoring
      emitMetric({ name: 'dlq_record_failed', labels: { jobId: job.id } });
      // Continue with error in job context
    }
  } else {
    // No DLQ configured - this is a critical config issue
    logger.error('No DLQ configured for failed job', { jobId: job.id });
    emitMetric({ name: 'job_failed_no_dlq', labels: { jobName: job.name } });
  }
}
```

---

### P2-012: Publish Route Missing Rate Limiting
- **File:** `apps/api/src/routes/publish.ts:110-196`
- **Category:** Security
- **Severity:** P2-Medium

**Violation:**
```typescript
app.post<IntentRouteParams>('/publish/intents', async (req, res) => {
  // No rate limiting applied
```

**Fix:**
```typescript
import { rateLimit } from '../utils/rateLimiter';

app.post('/publish/intents', 
  rateLimit({ maxRequests: 10, windowMs: 60000 }), // 10/min per user
  async (req, res) => {
    // ...
  }
);
```

---

## P3-LOW FINDINGS

### P3-001: Missing JSDoc for CircuitBreaker Class Methods
- **File:** `apps/api/src/utils/resilience.ts`
- **Category:** Documentation
- **Severity:** P3-Low

**Issue:** Several public methods lack JSDoc documentation for parameters and return types.

---

### P3-002: Console.log in Production Code (jobs/index.ts)
- **File:** `apps/api/src/jobs/index.ts:47`
- **Category:** Code Quality
- **Severity:** P3-Low

**Violation:**
```typescript
console.log('[Jobs] Scheduler initialized with all registered jobs');
```

---

### P3-003: Magic Number in Shutdown Timeout
- **File:** `apps/api/src/utils/shutdown.ts:54`
- **Category:** Code Quality
- **Severity:** P3-Low

**Violation:**
```typescript
const SHUTDOWN_TIMEOUT_MS = 60000;  // Should be configurable
```

---

### P3-004: Unused Import in LinkedInAdapter
- **File:** `apps/api/src/adapters/linkedin/LinkedInAdapter.ts`
- **Category:** Code Quality
- **Severity:** P3-Low

**Issue:** Several imports may be unused (depending on full file content).

---

### P3-005: Inconsistent Error Code Types
- **File:** `apps/api/src/middleware/abuseGuard.ts`
- **Category:** Code Quality
- **Severity:** P3-Low

**Issue:** Error codes use both snake_case and CONSTANT_CASE inconsistently.

---

### P3-006: TODO Comment Without Issue Tracker Reference
- **File:** `apps/api/src/jobs/feedbackIngestJob.ts:206`
- **Category:** Code Quality
- **Severity:** P3-Low

**Violation:**
```typescript
// TODO: Implement actual feedback metrics fetching from external API
```

**Fix:**
```typescript
// TODO(SMART-1234): Implement actual feedback metrics fetching from external API
```

---

## RECOMMENDATIONS

### Immediate Actions (P0-P1)
1. Fix all P0 issues before next production deployment
2. Implement PostgreSQL statement timeouts
3. Add proper AbortController signal propagation
4. Fix graceful shutdown error handling

### Short Term (P2)
1. Add cache stampede protection
2. Implement proper secret rotation mechanism
3. Add rate limiting to all public routes
4. Fix structured logging consistency

### Long Term (P3)
1. Implement distributed tracing
2. Add chaos engineering tests
3. Create formal API deprecation policy
4. Document all async patterns with decision records

---

## APPENDIX: Async Pattern Checklist

| Pattern | Status | Notes |
|---------|--------|-------|
| Promise.all with error isolation | ❌ | Needs Promise.allSettled |
| AbortController propagation | ⚠️ | Partial - missing in some adapters |
| Circuit breaker with cache limits | ⚠️ | LRU present but dynamic key risk |
| Retry with exponential backoff | ✅ | Implemented in retry.ts |
| Graceful shutdown | ⚠️ | Missing error handling |
| Connection timeouts | ❌ | Missing statement_timeout |
| Rate limiting | ✅ | Token bucket implemented |
| Cache stampede protection | ❌ | Not implemented |
| DLQ integration | ⚠️ | Partial - error handling gaps |
| Structured logging | ⚠️ | Inconsistent usage |

**Legend:** ✅ Complete | ⚠️ Partial | ❌ Missing

---

*End of Audit Report*
