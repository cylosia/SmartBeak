# Security Audit — `f*` Files
**Date:** 2026-02-18
**Branch:** `claude/security-audit-typescript-postgres-ZgBtc`
**Scope:** All TypeScript/TSX files whose filename begins with `f` (19 files)
**Method:** 5 parallel specialist agents (Security, TypeScript, SQL, Async/Concurrency, Architecture) + adversarial re-examination pass

---

## Files Audited

| File | Lines |
|------|-------|
| `apps/api/src/adapters/facebook/FacebookAdapter.ts` | 387 |
| `apps/api/src/email/__tests__/fallback.test.ts` | 384 |
| `apps/api/src/email/provider/fallback.ts` | 424 |
| `apps/api/src/jobs/feedbackIngestJob.ts` | 357 |
| `apps/api/src/routes/feedback.ts` | 144 |
| `apps/api/src/types/fastify.d.ts` | 26 |
| `apps/api/tests/adapters/facebook.adapter.spec.ts` | 13 |
| `apps/web/pages/system/feature-flags.tsx` | 168 |
| `control-plane/adapters/facebook/FacebookAdapter.ts` | 191 |
| `control-plane/adapters/facebook/__tests__/FacebookAdapter.test.ts` | 179 |
| `control-plane/services/flags.test.ts` | 116 |
| `control-plane/services/flags.ts` | 67 |
| `packages/config/__tests__/features.config.test.ts` | 257 |
| `packages/config/features.ts` | 90 |
| `packages/database/fencing.ts` | 39 |
| `packages/utils/fetchWithRetry.ts` | 395 |
| `plugins/publishing-adapters/facebook/facebook.adapter.test.ts` | 13 |
| `test/a11y/focus-trap.test.tsx` | 43 |
| `types/fernet.d.ts` | 11 |

---

## P0 — CRITICAL: Immediate Production Incident Risk

### P0-1 · `packages/database/fencing.ts:30-38` · SQL · Race Condition
**TOCTOU: two concurrent workers both receive `rowCount = 1`, both believe they hold exclusive access**

```sql
INSERT INTO fence_tokens (resource_type, resource_id, fence_token, updated_at)
VALUES ($1, $2, $3, NOW())
ON CONFLICT (resource_type, resource_id)
DO UPDATE SET fence_token = $3, updated_at = NOW()
WHERE fence_tokens.fence_token < $3;   -- ← NOT ATOMIC
```

Two concurrent transactions that both read `fence_token = 5` and both attempt to write `6` will **both** satisfy the WHERE clause, both update the row, and both get back `rowCount = 1`. The fencing guarantee is completely violated.

**Fix:**
```sql
-- Wrap in SERIALIZABLE transaction with retry on serialisation failure (40001)
BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;
SELECT fence_token FROM fence_tokens
  WHERE resource_type = $1 AND resource_id = $2 FOR UPDATE;
-- conditional INSERT/UPDATE follows safely
COMMIT;
```
Or lock the row with `SELECT ... FOR UPDATE` before the upsert.

**Blast radius:** Silent data corruption on any resource protected by distributed locking (publishing jobs, scheduled tasks). Both workers proceed; both mutate the same record. No error is raised.

---

### P0-2 · `apps/api/src/jobs/feedbackIngestJob.ts:308` · SQL · Multi-Tenant Data Corruption
**`ON CONFLICT (entity_id, window_days)` is missing `org_id` — cross-org row overwrite**

```sql
ON CONFLICT (entity_id, window_days)     -- ← org_id absent
DO UPDATE SET metric_count = EXCLUDED.metric_count, ...
```

If `entity_id` is not globally unique (i.e. it is scoped per-org), Org B's insert silently overwrites Org A's row. No constraint violation, no error, no log entry.

**Fix:** Change conflict key to `(org_id, entity_id, window_days)` and add a matching UNIQUE constraint in the migration.

**Blast radius:** Silent cross-organisation analytics corruption. GDPR / SOC 2 violation. Impossible to detect without a separate audit log.

---

### P0-3 · `apps/api/src/email/__tests__/fallback.test.ts:146-149` · Security · PII in Redis (proven by test)
**Test explicitly asserts raw email addresses are stored in Redis — implementation confirmed to store unmasked PII**

```typescript
// fallback.ts:373 — queueForRetry
await redis.lpush('email:failed', JSON.stringify(failedMessage));
// failedMessage.to = message.to  ← raw address, never masked

// fallback.test.ts:146-149 — proves it
expect(mockRedis.lpush).toHaveBeenCalledWith(
  'email:failed',
  expect.stringContaining('test@example.com')  // ← raw PII confirmed
);
```

`maskEmail()` is used for logs only. Redis stores the full address.

**Fix:**
```typescript
// fallback.ts queueForRetry
const failedMessage = {
  to: Array.isArray(message.to)
    ? message.to.map(maskSingleEmail)
    : maskSingleEmail(message.to as string),
  ...
};
// Also update the test assertion to expect masked form
```

**Blast radius:** Every Redis breach exposes the complete failed-email queue with customer addresses. Mandatory GDPR breach notification.

---

### P0-4 · `packages/utils/fetchWithRetry.ts:233-235` · Security · Cache Key Collision → Cross-User Data Leakage
**Auth token is hashed then truncated to 16 hex chars (64 bits); birthday collision leaks User A's response to User B**

```typescript
const authKey = rawAuth
  ? createHash('sha256').update(rawAuth).digest('hex').slice(0, 16)  // ← truncated
  : '';
return `${method}:${url}:${body}:${authKey}`;
```

Additionally, header extraction at lines 221-228 is case-sensitive for `Record<string,string>` headers (`Authorization` vs `authorization`) but case-insensitive for the `Headers` API — the same token can produce two different cache keys depending on how headers are passed, allowing stale responses from other users to be served.

**Fix:**
```typescript
// Remove .slice(0, 16) — use full 64-char digest
const authKey = rawAuth
  ? createHash('sha256').update(rawAuth).digest('hex')
  : '';
// Normalise header key to lowercase before lookup
const normHeaders: Record<string, string> = {};
Object.entries(headers as Record<string,string>)
  .forEach(([k, v]) => { normHeaders[k.toLowerCase()] = v; });
rawAuth = normHeaders['authorization'] || normHeaders['cookie'] || '';
```

**Blast radius:** Cross-user data leakage in any endpoint that uses `fetchWithRetry` with `cacheTtlMs > 0`. Full multi-tenant data isolation breach.

---

### P0-5 · `packages/config/__tests__/features.config.test.ts:249-255` · Test · Always-Failing Test Breaks CI
**Test title asserts protective controls are `true`; assertion body checks ALL flags are `false`**

```typescript
it('should have protective controls enabled by default', () => {
  const { featureFlags: flags } = require('../features');
  Object.entries(flags).forEach(([_name, enabled]) => {
    expect(enabled).toBe(false);   // ← WRONG: enableCircuitBreaker=true, enableRateLimiting=true
  });
});
```

`enableCircuitBreaker` and `enableRateLimiting` default to `true`. This test **cannot pass** in any clean environment. CI is permanently red (or this test is silently skip-listed, hiding future regressions).

Two additional always-failing tests in the same file:
- **Line 196-201:** `expect(consoleLogSpy).toHaveBeenCalledWith(...)` — `validateFeatureFlags` calls `logger.info()`, not `console.log`
- **Line 212-214:** `expect(consoleWarnSpy).toHaveBeenCalledWith(...)` — `validateFeatureFlags` calls `logger.warn()`, not `console.warn`

**Fix:**
```typescript
// Line 249-255 — correct assertion
it('should have protective controls enabled by default', () => {
  const PROTECTIVE = new Set(['enableCircuitBreaker', 'enableRateLimiting']);
  const { featureFlags: flags } = require('../features');
  Object.entries(flags).forEach(([name, enabled]) => {
    expect(enabled).toBe(PROTECTIVE.has(name));
  });
});
// Lines 196-214 — mock the structured logger instead of console
```

**Blast radius:** CI permanently broken or silently bypassed. Security-default regressions go undetected.

---

### P0-6 · `apps/api/src/adapters/facebook/FacebookAdapter.ts` (whole file) · Security · SSRF + Path Traversal
**The `apps/api` copy of FacebookAdapter has no SSRF protection and no numeric pageId validation; the `control-plane` copy has both**

`control-plane` (line 51-54, 143-145):
```typescript
const ssrfCheck = await validateUrlWithDns(targetUrl);
if (!ssrfCheck.allowed) throw new Error(`SSRF check failed: ${ssrfCheck.reason}`);
// ...
if (!/^\d+$/.test(pageId)) throw new Error('pageId must be numeric');
```

`apps/api` — **neither check exists**.

Without numeric validation, `pageId = "../me/accounts"` normalises to `/me/accounts/feed`, hitting a different Graph API endpoint. Without SSRF validation the constructed URL is never checked against internal networks.

**Fix:** Delete `apps/api/src/adapters/facebook/FacebookAdapter.ts` and import the control-plane adapter, or apply the same two guards. The duplication itself is the root cause.

**Blast radius:** SSRF to cloud metadata endpoints (AWS/GCP IMDS), arbitrary Graph API endpoint access via path traversal, potential access token misuse.

---

### P0-7 · `apps/api/src/jobs/feedbackIngestJob.ts:66` · Architecture · Dead Code Burns Retries + Future DB Corruption
**`fetchFeedbackMetrics` unconditionally throws `NotImplementedError`; probe uses zero-UUID which will pollute the DB once implemented**

```typescript
await fetchFeedbackMetrics('__probe__', 7, 'api', '00000000-0000-0000-0000-000000000000');
```

Today: every job invocation throws immediately, burns 3 retries, logs 3 errors per invocation. With 100 entities queued: 300 error log lines per run, queue saturation.

Future: once `fetchFeedbackMetrics` is implemented, the probe will **insert a real DB row** for `org_id = '00000000-...'` on every job run, creating phantom data for a nonexistent org.

**Fix:**
```typescript
// Gate registration behind feature flag
if (isFeatureEnabled('enableFeedbackIngest')) {
  registerFeedbackIngestJob(scheduler);
}
// When implementing fetchFeedbackMetrics, remove the probe entirely
```

**Blast radius:** Alert fatigue, queue saturation today; phantom org data and cross-org query pollution when implemented.

---

### P0-8 · `apps/api/src/routes/feedback.ts:26` / `apps/api/src/types/fastify.d.ts:18` · Security · Auth Bypass Risk
**`verifyAuth` passes `{}` to `getAuthContext` when Authorization header is absent; `req.auth` and `req.user.id` are both optional with no compiler enforcement**

```typescript
// fastify.d.ts
auth?: AuthContext;          // optional — routes must null-check manually
user?: { id?: string | undefined; ... };

// feedback.ts:26
const result = getAuthContext(
  req.headers.authorization != null
    ? { authorization: req.headers.authorization }
    : {}    // ← empty object when header absent
);
```

If `getAuthContext({})` returns a non-null partial object, `if (!result)` passes and downstream code uses `result.userId = undefined`. A DB query `WHERE user_id = NULL` may return unexpected rows depending on ORM behaviour.

**Fix:**
```typescript
function verifyAuth(req: FastifyRequest) {
  if (!req.headers.authorization) return null;   // fail fast before calling
  const result = getAuthContext({ authorization: req.headers.authorization });
  if (!result) { logAuthEvent(...); return null; }
  return { userId: result.userId, orgId: result.orgId };
}
```

**Blast radius:** Unauthenticated requests reach authenticated route logic. Potential cross-user or zero-auth data access.

---

## P1 — HIGH: Likely bugs under load / exploitable / data corruption

### P1-1 · `apps/api/src/email/provider/fallback.ts:161-173` · Async · Non-Atomic Half-Open Transition
**Two concurrent requests both pass the `isHalfOpen` check before either sets it; both become probes**

```typescript
if (this.circuit.isHalfOpen) { throw ... }  // Check
this.circuit.isHalfOpen = true;              // Write — NOT ATOMIC
```

Two concurrent `send()` calls racing here both pass the check and both set `isHalfOpen = true`. Both become probes. If both fail, the circuit re-opens and `failures` is double-incremented, making recovery harder.

**Fix:** Use a stored `probePromise: Promise<...> | null`:
```typescript
if (this.probePromise) return this.probePromise;
this.probePromise = this.runProbe().finally(() => { this.probePromise = null; });
return this.probePromise;
```

---

### P1-2 · `apps/api/src/adapters/facebook/FacebookAdapter.ts:344-381` · Async · Timer Leak in Pagination Loop
**One `AbortController` + `setTimeout` created per page; timers from completed pages are cleared, but if an exception is thrown mid-loop, in-flight timers orphan**

With `MAX_PAGINATION_PAGES = 100`, up to 100 timers can exist simultaneously. An OOM error mid-loop or outer `Promise.allSettled` cancellation leaves all prior timers live in the event loop, preventing process shutdown.

**Fix:** Single controller outside the loop; only one timer active at a time:
```typescript
const controller = new AbortController();
let timeoutId: NodeJS.Timeout;
try {
  while (url && pageCount < MAX_PAGINATION_PAGES) {
    timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    const res = await fetch(url, { ..., signal: controller.signal });
    clearTimeout(timeoutId);
    ...
  }
} finally {
  clearTimeout(timeoutId!);
}
```

---

### P1-3 · `apps/api/src/email/provider/fallback.ts:130-227` · Architecture · In-Memory Circuit Breaker Splits in Multi-Pod Deployment
**Each pod maintains its own `CircuitState`; Pod A trips its circuit but Pods B, C, D continue flooding the failing provider**

In a 4-pod cluster, 75% of traffic continues hitting the broken provider even after Pod A reaches its threshold.

**Fix:** Store circuit state in Redis with atomic Lua compare-and-swap. TTL on the Redis key auto-resets after `resetTimeoutMs`.

---

### P1-4 · `control-plane/services/flags.ts:36-41, 49-54` · SQL · No Query Timeout on Pool Queries
**A hung DB blocks the Node.js event loop indefinitely on every `isEnabled()` / `set()` call**

With PostgreSQL's default 30 s connection timeout, 100 concurrent requests on a degraded DB → 100 blocked event-loop ticks → application hangs.

**Fix:**
```typescript
const { rows } = await Promise.race([
  this.pool.query('SELECT value FROM system_flags WHERE key=$1', [validatedKey]),
  new Promise<never>((_, rej) =>
    setTimeout(() => rej(new Error('Flag query timeout')), 5000)),
]);
```
Or configure `statement_timeout` at the pool level.

---

### P1-5 · `apps/api/src/routes/feedback.ts:42-58` · SQL / Security · IDOR — `canAccessDomain` Relies on Implicit Join Condition
**`domain_registry.org_id` is only matched via the JOIN; an explicit `WHERE domain_registry.org_id = $expectedOrgId` is missing**

If the join condition is ever relaxed or the query is refactored, the explicit org boundary disappears silently.

**Fix:**
```typescript
.where('domain_registry.domain_id', domainId)
.where('domain_registry.org_id', orgId)    // ← add this explicit guard
.where('memberships.user_id', userId)
.where('memberships.org_id', orgId)
```

---

### P1-6 · `packages/utils/fetchWithRetry.ts:383-393` · TypeScript · `makeRetryable` Discards `fn` Entirely
**The wrapper ignores the wrapped function and calls `fetchWithRetry` directly; any custom logic in `fn` (auth injection, logging, tracing) is silently dropped**

```typescript
export function makeRetryable<T extends (url, options?) => Promise<Response>>(fn: T, defaultOptions?): T {
  return (async (url, options?) => {
    return fetchWithRetry(url, { ...options, ... });  // fn is never called
  }) as T;
}
```

**Fix:** Either call `fn(url, fetchOptions)` inside `withRetry`, or change the return type to make the wrapping explicit and stop the `as T` lie.

---

### P1-7 · `apps/api/src/jobs/feedbackIngestJob.ts:108-140` · Async · DB Pool Exhaustion Under Load
**`pLimit(10)` × 3 windows per entity × `withRetry(maxRetries:3)` can issue 90+ simultaneous DB operations against a default pool of 10 connections**

Peak: 10 concurrent entities, each with 3 windows in-flight = 30 simultaneous queries. Each failing and retrying 3× = up to 90 connection-seconds of pool pressure. Pool exhausted; new requests queue indefinitely; job times out at 300 s.

**Fix:** Lower concurrency limit: `pLimit(Math.max(1, Math.floor(poolSize / 3)))`. Process windows sequentially per entity.

---

### P1-8 · `apps/api/src/jobs/feedbackIngestJob.ts:320-332` · SQL · Transaction Commit Failure Has No Retry
**If `trx.commit()` fails with a serialisation error (`40001`) or a transient network blip, the job throws with no retry of the transaction**

```typescript
await trx.commit();
// If this throws, catch block tries rollback but never retries
```

**Fix:** Wrap in a retry loop that specifically handles `error.code === '40001'` (PostgreSQL serialisation failure) with exponential backoff.

---

### P1-9 · `apps/api/src/types/fastify.d.ts:13` · TypeScript · `roles: string[]` — No Compile-Time Role Validation
**Typos (`'owmner'`, `'Admin'`) compile without error and cause silent auth failures at runtime**

**Fix:** `type Role = 'owner' | 'admin' | 'editor' | 'viewer';` then `roles: Role[]`.

---

### P1-10 · `apps/api/src/adapters/facebook/FacebookAdapter.ts:366` · TypeScript · Unsafe `as T[]` Cast in `fetchAllPages`
**`isFacebookPaginatedResponse` only validates `Array.isArray(data)`. The cast `rawData.data as T[]` accepts `[1, 2, 3]` where `T = { id: string }`**

**Fix:** Accept an element type-guard parameter and validate each item, or document explicitly that callers validate downstream.

---

### P1-11 · `apps/api/src/routes/feedback.ts:109-122` · Security · Audit Events Fire-and-Forget with No Alerting
**Both the inner `catch` in `recordAuditEvent` and the outer `.catch()` silently swallow failures. Malicious actor can degrade the audit DB to erase their tracks.**

**Fix:** At minimum emit a Prometheus counter on audit failure:
```typescript
.catch((err) => {
  emitCounter('audit.write_failure', 1, { action: 'feedback_list_accessed' });
  logger.error('AUDIT_FAILURE', err);
});
```

---

### P1-12 · `control-plane/adapters/facebook/__tests__/FacebookAdapter.test.ts` · Test · `@security/ssrf` Not Mocked — Real DNS Lookups in CI
**`validateUrlWithDns` is called inside `publishPagePost` but `@security/ssrf` has no `vi.mock()`. Tests make live DNS queries to `graph.facebook.com`.**

Tests are network-dependent and flaky in air-gapped CI environments.

**Fix:**
```typescript
vi.mock('@security/ssrf', () => ({
  validateUrlWithDns: vi.fn().mockResolvedValue({ allowed: true }),
}));
```

---

## P2 — MEDIUM: Technical debt, correctness under edge cases, performance degradation

| # | File:Line | Category | Violation | Fix |
|---|-----------|----------|-----------|-----|
| M1 | `feedbackIngestJob.ts:284` | SQL | `SET LOCAL statement_timeout = ?` — PostgreSQL SET does not accept parameterised placeholders; Knex maps `?` to `$1`, query fails with syntax error | Use literal: `` await trx.raw(`SET LOCAL statement_timeout = 30000`) `` |
| M2 | `feedbackIngestJob.ts:289-295` | SQL | 7 UNNEST arrays with no length-equality check; mismatched arrays → runtime error on every invocation | Assert `new Set([...arrays].map(a=>a.length)).size === 1` before issuing query |
| M3 | `feedbackIngestJob.ts:298-301` | SQL | INSERT includes `created_at` but not `updated_at`; first-insert rows get `updated_at = NULL` | Add `updated_at` to column list via the LATERAL subquery: `LATERAL (SELECT NOW() AS created_at, NOW() AS updated_at) ts` |
| M4 | `fallback.ts:140-141` | Security | `sanitizeHeaderValue` strips `\r\n` but not `\x00` (null byte); header **keys** are never sanitised — CRLF injection via crafted key possible | Sanitise keys; add `replace(/[\r\n\x00]/g, '')` |
| M5 | `fetchWithRetry.ts:195-200` | Async | Jitter formula `cappedDelay * 0.25 * (Math.random() * 2 - 1)` can produce a negative final delay when `baseDelayMs` is very small | `return Math.max(0, Math.floor(cappedDelay + jitter))` |
| M6 | `feature-flags.tsx:59-61` | Async | `void fetchFlags()` in `useEffect` with no `AbortController` cleanup — `setState` called on unmounted component | Add `AbortController`, pass `signal`, abort on cleanup return |
| M7 | `feature-flags.tsx:63-84` | Async | Rapid double-toggle race: two in-flight PATCHes can arrive out of order; optimistic rollback may revert the wrong state | Version-stamp each toggle; only apply revert if request ID matches the latest |
| M8 | `fallback.ts:188-194` | Async | Single probe success immediately closes circuit; one "lucky" response hides persistent instability | Require N consecutive successes (e.g. 3) before transitioning to closed |
| M9 | `flags.ts:57-66` | SQL | `getAll()` full-table scan with no pagination, no LIMIT; large `system_flags` table will block | Add pagination params; ensure `ORDER BY key` has a supporting index |
| M10 | `flags.ts:17, 25` | TypeScript | `result["error"].message` via bracket notation on a Zod union — leaks Zod internal error structure to callers | `throw new ValidationError('Invalid flag key format')` (no internal details) |
| M11 | `fencing.ts:38` | TypeScript | `rowCount ?? 0` — if query silently fails, `rowCount` is `null`; returns `false` indistinguishably from "stale token" | `if (rowCount === null) throw new DatabaseError('fencing query returned null rowCount')` |
| M12 | `feedbackIngestJob.ts:80-82, 130, 171, 216` | TypeScript | Nested `instanceof Error` check inside outer `instanceof Error` block; `error["message"]` bracket access inside a narrowed block should be `error.message` | Remove redundant check; use dot notation |
| M13 | `packages/config/features.ts:12` | Architecture | `import { getLogger } from '../kernel/logger'` — relative path violates `@kernel/*` alias convention | Change to `import { getLogger } from '@kernel/logger'` |
| M14 | `feedbackIngestJob.ts:95, 186-189` | Observability | KPI recording failures silently swallowed with `catch { /* not initialized */ }` | `catch (e) { logger.warn('KPI not initialised', { error: e }) }` |
| M15 | `fallback.ts:205-208` | Observability | Circuit open/close events are logged but emit no Prometheus counter | `emitCounter('email.circuit_state_change', 1, { provider, state: 'open' })` |
| M16 | `fetchWithRetry.ts:357` | Security | Retry log includes raw URL — if URL contains `?api_key=secret`, key stored in logs | Redact known secret query-param names before logging |
| M17 | `fencing.ts` (migration) | SQL | No `CHECK (fence_token >= 0)`, no `CHECK (resource_type != '')` | Add constraints in migration; add `CHECK` and length guards |
| M18 | `feedback.ts:11-15` | SQL | `offset` max 10 000 with no cursor-based pagination; results unstable under concurrent deletes | Migrate to keyset/cursor pagination |
| M19 | `feature-flags.tsx:47` | Security | `fetchFlags()` uses `credentials: 'include'` but client-side has no admin role check; server-side must enforce | Document/enforce admin-only on the server route; add role check to `getServerSideProps` |
| M20 | `types/fernet.d.ts:5` | TypeScript | `decrypt(token): string` — no indication it can throw; callers omit `try/catch` → unhandled exception on bad token | Add `@throws`; audit all call sites |
| M21 | `features.config.test.ts:8` | Test | Top-level `import '../features'` runs side effects before `jest.resetModules()`, causing the module cache to serve a stale instance to all `require('../features')` calls inside tests | Remove top-level import; use only `require()` inside each test |
| M22 | `features.config.test.ts:145` | Test | `expect(enabled).toHaveLength(2)` — brittle; adding any new protective control breaks CI | `expect(enabled).toBeGreaterThanOrEqual(2); expect(enabled).toContain('enableCircuitBreaker')` |
| M23 | `features.config.test.ts:17-29` | Test | `beforeEach` clears `ENABLE_*` vars but not `NEXT_PUBLIC_ENABLE_BETA` or `NEXT_PUBLIC_ENABLE_CHAT`; if set in CI, tests fail non-deterministically | Add both `NEXT_PUBLIC_*` vars to the clear list |
| M24 | `apps/api/FacebookAdapter.ts:154` | Architecture | Hardcoded `'https://graph.facebook.com/v19.0'` not from `@config`; `control-plane` test mocks `v18.0` — two versions simultaneously active | `this.baseUrl = apiConfig.facebook.baseUrl` |
| M25 | `apps/api FacebookAdapter` (whole) | Architecture | No structured logger, no metrics collector, no distributed tracing spans | Mirror `control-plane`'s `StructuredLogger` + `MetricsCollector` pattern |
| M26 | `fallback.ts:352-381` | Reliability | `queueForRetry` calls Redis with no circuit breaker; Redis failure floods error logs with no backoff | Add circuit breaker or exponential backoff on Redis writes |
| M27 | `apps/api/tests/.../facebook.adapter.spec.ts:4` | Test | `global.fetch = jest.fn()` monkey-patch is never cleaned up; leaks into other test files in same process | `afterEach(() => { delete (global as any).fetch; })` or use `jest.mock('node-fetch', ...)` |

---

## P3 — LOW: Correctness nits, future-proofing

| # | File:Line | Issue | Fix |
|---|-----------|-------|-----|
| L1 | `fencing.ts` (migration) | No index on `updated_at` for stale-token cleanup; rows accumulate indefinitely | `CREATE INDEX idx_fence_tokens_updated_at ON fence_tokens(updated_at)` |
| L2 | `feedback.ts:42` | Missing explicit `Promise<boolean>` return type on `canAccessDomain` | Add return type annotation |
| L3 | `feature-flags.tsx:10-15` | `source: 'env' \| 'database'` not validated at runtime; API drift could inject invalid value | `z.enum(['env', 'database'])` in response schema |
| L4 | `fetchWithRetry.ts:179, 357` | `error["message"]` / `lastError["message"]` after `instanceof Error` guard — use dot notation | `error.message` / `lastError.message` |
| L5 | `plugins/.../facebook.adapter.test.ts` | 8 lines total; zero negative tests (empty title, XSS payload, long strings) | Expand to cover edge cases |
| L6 | `test/a11y/focus-trap.test.tsx` | No test for dynamic elements added after mount, nested traps, or focus restoration on unmount | Add 3 edge-case scenarios |
| L7 | `flags.ts:33-41` | `isEnabled()` reads outside a transaction with no isolation level; dirty reads possible during flag flip | Document isolation level; consider 5 s read-through cache |
| L8 | `fencing.ts:28` | `fencingToken: number` — JS `number` is 53-bit safe; PostgreSQL `BIGINT` is 64-bit → silent truncation above 2^53 | Change to `fencingToken: bigint` |

---

## Phase 2 — Adversarial Re-Examination

Issues found only on the second pass:

1. **`feedback.ts:69` — `ip_address: params["ip"]`**: IP inserted from user-controlled request context with no format validation (no IPv4/IPv6 regex, no length cap). A crafted zone ID or overlong string can corrupt the audit row. Use a branded `IpAddress` type with a format guard.

2. **`fallback.ts:350` — Silent queue truncation**: `MAX_FAILED_QUEUE_SIZE = 10 000` is a hard cap with no alert at 80% capacity. An attacker who can trigger email failures (invalid addresses, reputation blocks) can flush the queue, causing legitimate queued emails to be silently discarded with no log beyond the initial `lpush`.

3. **`feedbackIngestJob.ts:66` — Zero-UUID probe future hazard**: The probe passes `orgId = '00000000-0000-0000-0000-000000000000'`. Once `fetchFeedbackMetrics` is implemented, every job run will INSERT or UPSERT a real feedback_metrics row for this phantom org. Any `SELECT * FROM feedback_metrics` without `WHERE org_id != '00000000-...'` will include it. Queries or aggregate reports will silently include phantom data.

4. **`fernet.d.ts` — Incomplete ambient declaration**: `Token.parse` returns `{ secret: Buffer }` but the real fernet library may return `{ secret, timestamp, ttl }`. TypeScript suppresses access to the extra fields; callers cannot use `timestamp` for token expiry validation even though the library provides it, leading to missing expiry enforcement.

5. **`fastify.d.ts` — Two auth contexts on one request**: Both `req.auth: AuthContext` and `req.user: { id?, orgId? }` exist with different field names (`userId` vs `id`). Routes that accidentally read `req.user?.id` instead of `req.auth.userId` get `undefined` with no TypeScript error because both are optional. A codebase-wide grep for `req.user?.id` in route handlers is warranted.

---

## Production Incident Ranking

Issues that would cause a production incident if deployed today, ranked by blast radius:

| Rank | Finding | Incident Type | Blast Radius |
|------|---------|--------------|--------------|
| 1 | P0-2 `feedbackIngestJob ON CONFLICT` | Silent cross-org data overwrite | All orgs sharing entity_id namespace; permanent analytics corruption |
| 2 | P0-1 `fencing.ts TOCTOU` | Two concurrent lock holders proceed | Any distributed-lock-protected resource; silent double-write |
| 3 | P0-6 `apps/api FacebookAdapter SSRF` | SSRF to cloud metadata / internal network | Instance credential theft via IMDS; arbitrary Graph API path traversal |
| 4 | P0-4 `fetchWithRetry cache key collision` | User A receives User B's cached response | All cached GET endpoints in multi-tenant environment |
| 5 | P0-7 `feedbackIngestJob dead code` | Queue saturation, log flood, alert fatigue | All job consumers delayed; real errors invisible in noise |
| 6 | P0-8 `verifyAuth empty object` | Unauthenticated requests reach route logic | `/feedback` and any route using the same `verifyAuth` pattern |
| 7 | P0-3 `Redis PII storage` | Customer emails exposed on Redis breach | Full failed-email queue; GDPR breach notification required |
| 8 | P1-7 `pLimit + pool exhaustion` | DB pool exhausted under load | All DB operations blocked; site-wide degradation |
| 9 | P1-3 `In-memory circuit breaker` | Provider outage undetected on 3/4 pods | Email delivery failure continues on most pods |
| 10 | P0-5 `broken CI test` | CI permanently failing | All merges blocked; security-default regressions undetectable |

---

## Summary

| Severity | Count |
|----------|-------|
| P0 Critical | 8 |
| P1 High | 12 |
| P2 Medium | 27 |
| P3 Low | 8 |
| **Total** | **55** |

**Highest-risk files:**
1. `apps/api/src/jobs/feedbackIngestJob.ts` — 3× P0, 3× P1, 5× P2
2. `apps/api/src/adapters/facebook/FacebookAdapter.ts` — 2× P0, 3× P1, 3× P2
3. `packages/utils/fetchWithRetry.ts` — 1× P0, 2× P1, 3× P2
4. `apps/api/src/routes/feedback.ts` + `fastify.d.ts` — 2× P0, 2× P1
5. `packages/config/__tests__/features.config.test.ts` — 1× P0, 4× P2 (test file)
