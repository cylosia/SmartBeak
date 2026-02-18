# Hostile Security Audit: Files Starting with "m"

**Date**: 2026-02-18
**Scope**: All 21 TypeScript files where filename starts with "m"
**Methodology**: Line-by-line AST analysis, cross-reference verification, adversarial re-review
**Auditors**: Multi-agent parallel analysis + adversarial second pass

---

## Files Audited (21 files)

### Production Code (15 files)
1. `control-plane/api/routes/media.ts`
2. `control-plane/api/routes/media-lifecycle.ts`
3. `control-plane/services/metrics.ts`
4. `control-plane/services/media-lifecycle.ts`
5. `control-plane/services/membership-service.ts`
6. `apps/api/src/ops/metrics.ts`
7. `apps/api/src/utils/moduleCache.ts`
8. `apps/api/src/canaries/mediaCanaries.ts`
9. `apps/api/src/services/membership.ts`
10. `apps/web/middleware.ts`
11. `scripts/migrate.ts`
12. `scripts/migrate-console-logs.ts`
13. `packages/kernel/metrics.ts`
14. `packages/cache/multiTierCache.ts`
15. `packages/monitoring/metrics-collector.ts`

### Test Files (6 files)
16. `apps/api/tests/integration/multi-tenant.test.ts`
17. `apps/api/src/utils/__tests__/moduleCache.circuit-breaker.test.ts`
18. `domains/media/domain/media.test.ts`
19. `domains/media/domain/media.lifecycle.test.ts`
20. `packages/cache/__tests__/multiTierCache.memory.test.ts`
21. `packages/monitoring/__tests__/metrics-collector.memory.test.ts`

---

## ADDENDUM: Agent-Verified Findings (Cross-Checked)

The following additional P0/P1 findings were discovered by parallel audit agents and
independently verified against source code and dependency versions.

---

## CRITICAL (P0) - Production Outage / Data Loss / Security Breach Imminent

### P0-1: Membership Table Name Mismatch - Data Integrity Failure
- **File**: `apps/api/src/services/membership.ts:18`
- **Category**: SQL | Data Integrity
- **Violation**: The `verifyOrgMembership()` function queries table `org_memberships`, but the control-plane's `membership-service.ts` queries table `memberships` (created in migration `20260210000100_cp_orgs.up.sql:18`). These are **two different tables**. The `org_memberships` table is populated by Clerk webhooks (`apps/web/pages/api/webhooks/clerk.ts:450`), while `memberships` is populated by `MembershipService.addMember()`. A user could exist in one but not the other.
- **Fix**: Unify on a single table name. Either rename all `org_memberships` references to `memberships`, or create a migration to rename the table. Add a database view or synonym if both names must be supported during migration.
- **Risk**: **Billing authorization bypass**. If billing routes use `verifyOrgMembership()` (which queries `org_memberships`), but membership is only recorded in `memberships`, the check returns `false` and legitimate users are locked out. Conversely, if `org_memberships` has stale entries after a user is removed from `memberships`, removed users retain billing access. **Blast radius: All multi-tenant authorization decisions across the apps/api layer.**

### P0-2: Metrics Endpoint Exposed Without Authentication
- **File**: `control-plane/services/metrics.ts:15-20`
- **Category**: Security
- **Violation**: `metricsEndpoint()` returns a handler that serves Prometheus metrics with zero authentication. The function signature `(_req: unknown, res: ...)` discards all request context, making it impossible to add auth checks downstream. Any metrics registered with `prom-client` (including `http_requests_total`, `plugin_failures_total`) are exposed to unauthenticated requests.
- **Fix**: Wrap the handler in auth middleware, or at minimum restrict to internal IP ranges:
  ```typescript
  export function metricsEndpoint(requireAuth: (req: FastifyRequest) => void): ... {
    return async (req, res) => {
      requireAuth(req); // throws on failure
      res.header('Content-Type', client.register.contentType);
      return client.register.metrics();
    };
  }
  ```
- **Risk**: **Information disclosure**. Attacker learns request volumes, failure rates, active plugins, enabling targeted attacks. In financial-grade systems, traffic patterns reveal business intelligence. **Blast radius: Full system observability exposed to the internet.**

### P0-3: `requireRole` Error Swallowed as 500 Instead of 403
- **File**: `control-plane/api/routes/media.ts:72,90-94` and `media-lifecycle.ts:50,86-90`
- **Category**: Security | Error Handling
- **Violation**: `requireRole(ctx, ['admin', 'editor'])` throws `RoleAccessError` (confirmed: `auth.ts:201` throws with HTTP 403). The generic `catch` block on line 90 catches this and returns `errors.internal(res, 'Failed to create upload intent')` -- a **500 error**. The client never receives the proper 403 Forbidden. This masks authorization failures as server errors, breaking API contracts and hiding security events from monitoring.
- **Fix**: Catch `RoleAccessError` specifically before the generic catch:
  ```typescript
  } catch (error) {
    if (error instanceof RoleAccessError) {
      return errors.forbidden(res, error.message);
    }
    logger.error('[media/upload-intent] Error:', error instanceof Error ? error : new Error(String(error)));
    return errors.internal(res, 'Failed to create upload intent');
  }
  ```
- **Risk**: **Security monitoring blind spot**. 403s are invisible in alerting. Legitimate users receive confusing 500 errors. Pen testers and attackers can't distinguish auth failures from real bugs, but neither can your security team. **Blast radius: All media routes (upload-intent, complete, lifecycle).**

### P0-4: `persistMetrics` Unbounded Batch Can Exceed PostgreSQL Parameter Limit
- **File**: `packages/monitoring/metrics-collector.ts:840-856`
- **Category**: SQL | Resilience
- **Violation**: The `persistMetrics()` method builds a single INSERT with `$1` through `$N` parameters where N = `batch.length * 5`. PostgreSQL has a hard limit of 65,535 parameters per query. With `maxKeys = 10,000` and one metric per key, this generates 50,000 parameters -- near the limit. Under high cardinality (which this collector explicitly supports), it **will** exceed the limit, crashing the persist operation silently (caught by line 860's try-catch).
- **Fix**: Batch the INSERT in chunks of 1,000:
  ```typescript
  const PERSIST_BATCH_SIZE = 1000;
  for (let i = 0; i < batch.length; i += PERSIST_BATCH_SIZE) {
    const chunk = batch.slice(i, i + PERSIST_BATCH_SIZE);
    const values = chunk.map((m, j) =>
      `($${j * 5 + 1}, $${j * 5 + 2}, $${j * 5 + 3}, $${j * 5 + 4}, $${j * 5 + 5})`
    ).join(',');
    const params = chunk.flatMap(m => [m.name, m.type, String(m.value), JSON.stringify(m.labels || {}), new Date(m.timestamp)]);
    await this.db.query(`INSERT INTO metrics (name, type, value, labels, timestamp) VALUES ${values}`, params);
  }
  ```
- **Risk**: **Silent metric data loss under load**. When the system is busiest and metrics matter most, persistence fails. No alerting on the failure path. **Blast radius: Complete loss of metrics persistence during high-cardinality events.**

### P0-5: Clerk `getAuth()` Called Without `clerkMiddleware` -- All Auth Potentially Broken
- **File**: `apps/web/middleware.ts:55`
- **Category**: Security | Authentication
- **Violation**: The project uses `@clerk/nextjs: ^6.0.0` (confirmed in `apps/web/package.json:12`). In Clerk v5+/v6, `getAuth(req)` requires the request to have been processed by `clerkMiddleware()` first. **There is no `clerkMiddleware` call anywhere in the codebase** (verified via codebase-wide grep). Without it, `getAuth()` either: (a) throws an error on every call, causing the catch block to redirect all users to `/login`, or (b) returns `{ userId: null }`, causing line 73 to invalidate all sessions.
- **Fix**: Replace the manual middleware with Clerk's official pattern:
  ```typescript
  import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
  const isProtectedRoute = createRouteMatcher(['/dashboard(.*)']);
  export default clerkMiddleware(async (auth, req) => {
    if (isProtectedRoute(req)) { await auth.protect(); }
    // Add security headers...
  });
  ```
- **Risk**: **Complete authentication failure**. Either all users are constantly logged out (redirect loop to `/login`), or all session validation is bypassed. **Blast radius: Every authenticated page in the web application.**

---

## HIGH (P1) - Likely Bugs Under Load / Security Vulnerabilities / Data Corruption

### P1-1: Upload Intent Allows Client-Controlled ID Without Existence Check
- **File**: `control-plane/api/routes/media.ts:81,86`
- **Category**: Security | Data Integrity
- **Violation**: The client provides the `id` field in `UploadIntentBodySchema`. `handler.execute(id, storageKey, mimeType)` passes this directly to `PostgresMediaRepository.save()`, which uses `ON CONFLICT (id) DO UPDATE SET status = $4`. An attacker can overwrite any existing media asset's status by submitting its UUID.
- **Fix**: Either (a) generate the UUID server-side: `const id = crypto.randomUUID()`, or (b) use `INSERT ... ON CONFLICT DO NOTHING` and check affected rows, returning 409 Conflict if the ID already exists.
- **Risk**: Media asset status corruption. Attacker can reset a "completed" upload to "pending", breaking content that references it.

### P1-2: `verifyOrgMembership` Does Not Check Role
- **File**: `apps/api/src/services/membership.ts:16-22`
- **Category**: Security | AuthZ
- **Violation**: `verifyOrgMembership()` only checks if a membership row exists (`!!membership`). It does not filter by role. A `viewer` role passes the same check as an `owner`. If this function guards billing routes (as documented in the file's comment referencing `billingStripe.ts`, `billingPaddle.ts`, etc.), any org member can access billing operations.
- **Fix**: Accept allowed roles as parameter:
  ```typescript
  export async function verifyOrgMembership(
    userId: string, orgId: string, requiredRoles?: Role[]
  ): Promise<boolean> {
    const db = await getDb();
    let query = db('org_memberships').where({ user_id: userId, org_id: orgId });
    if (requiredRoles?.length) query = query.whereIn('role', requiredRoles);
    return !!(await query.first());
  }
  ```
- **Risk**: Privilege escalation. Viewers access billing, invoices, payment methods.

### P1-3: Ownership Verification Uses Different Pool Than Media Operations
- **File**: `control-plane/api/routes/media.ts:24-33` vs `84`
- **Category**: SQL | Architecture
- **Violation**: `verifyMediaOwnership(ctx.userId, id, pool)` uses the route-level `pool` parameter. Line 84 creates `new PostgresMediaRepository(getPool(resolveDomainDb('media')))` which resolves a different pool via domain registry. These may point to **different databases** in a sharded/multi-tenant setup. The ownership check succeeds against DB-A, but the actual operation runs against DB-B, where the user may not have access.
- **Fix**: Use the same pool for both operations:
  ```typescript
  const mediaPool = getPool(resolveDomainDb('media'));
  const isAuthorized = await verifyMediaOwnership(ctx.userId, id, mediaPool);
  const repo = new PostgresMediaRepository(mediaPool);
  ```
- **Risk**: Authorization bypass in multi-tenant/sharded deployments.

### P1-4: Membership Race Condition in `removeMember` - Stale Role Read
- **File**: `control-plane/services/membership-service.ts:159-178`
- **Category**: SQL | Concurrency
- **Violation**: The first SELECT on line 159 reads the user's role **without** `FOR UPDATE`. Between this read and the `FOR UPDATE` count on line 171, a concurrent `updateRole` could change the user's role. Specifically: if User A is a non-owner, and a concurrent transaction promotes User A to `owner` (via `updateRole`), then `removeMember` skips the last-owner check (because line 168 sees the stale non-owner role), and deletes the member -- who is now the only owner.
- **Fix**: Add `FOR UPDATE` to the first SELECT:
  ```sql
  SELECT role FROM memberships WHERE user_id = $1 AND org_id = $2 FOR UPDATE
  ```
- **Risk**: Organization left without any owner, permanently locked out of admin functions.

### P1-5: AbortSignal Event Listener Memory Leak
- **File**: `packages/cache/multiTierCache.ts:493`
- **Category**: Memory | Performance
- **Violation**: In `computeAndCache()`, line 493 adds an `abort` event listener to `options.signal` but never removes it. If the factory resolves before the signal is aborted (the common case), the listener remains attached to the potentially long-lived `AbortController`. Over many requests, this accumulates leaked listeners.
- **Fix**: Track and remove the listener in the `finally` block:
  ```typescript
  let abortHandler: (() => void) | undefined;
  if (options?.signal) {
    abortHandler = () => reject(new Error('Cache computation aborted'));
    options.signal.addEventListener('abort', abortHandler, { once: true });
  }
  // ... in finally:
  if (abortHandler && options?.signal) {
    options.signal.removeEventListener('abort', abortHandler);
  }
  ```
- **Risk**: Memory leak proportional to request volume. Under sustained load, heap grows until OOM.

### P1-6: `quickSelect` Creates O(n) Arrays Per Recursive Call
- **File**: `packages/monitoring/metrics-collector.ts:716-731`
- **Category**: Performance
- **Violation**: The `quickSelect` implementation uses `arr.filter()` three times per recursive call, creating 3 new arrays on each level. For the intended use case (>10,000 elements), this generates significant GC pressure. Worst case (already sorted data), recursion depth is O(n) with O(n) allocations per level = O(n^2) memory.
- **Fix**: Use in-place partition (Lomuto or Hoare scheme):
  ```typescript
  private quickSelect(arr: number[], left: number, right: number, k: number): number {
    if (left === right) return arr[left]!;
    const pivotIndex = this.partition(arr, left, right);
    if (k === pivotIndex) return arr[k]!;
    else if (k < pivotIndex) return this.quickSelect(arr, left, pivotIndex - 1, k);
    else return this.quickSelect(arr, pivotIndex + 1, right, k);
  }
  ```
- **Risk**: GC pauses spike during aggregation intervals. Under high metric cardinality, this blocks the event loop.

### P1-7: `metrics.shift()` in Retention Loop is O(n^2)
- **File**: `packages/monitoring/metrics-collector.ts:411-413`
- **Category**: Performance
- **Violation**: `Array.shift()` is O(n) because it re-indexes all remaining elements. Inside a `while` loop, this becomes O(n^2) for cleaning up old metrics. With `retentionMs = 3600000` and high-frequency metrics, arrays can have thousands of entries.
- **Fix**: Use binary search to find the cutoff index, then `splice` once:
  ```typescript
  const cutoff = Date.now() - this.config.retentionMs;
  let i = 0;
  while (i < metrics.length && metrics[i]!.timestamp < cutoff) i++;
  if (i > 0) metrics.splice(0, i);
  ```
- **Risk**: Event loop blocking during metric aggregation. Latency spikes in API responses.

### P1-8: Migration `baseline` Command Not Wrapped in Transaction
- **File**: `scripts/migrate.ts:158-168`
- **Category**: SQL | Data Integrity
- **Violation**: The `runBaseline` function inserts migration records one-by-one in a loop without a transaction. If the process crashes mid-loop (OOM, SIGKILL, network partition), some migrations are marked as applied and others aren't. The next `migrate up` would skip the already-marked ones and try to apply the unmarked ones, which may have dependencies on the skipped ones.
- **Fix**: Wrap in a transaction:
  ```typescript
  const trx = await db.transaction();
  try {
    for (const migration of migrations) {
      if (!existingNames.has(migration)) {
        await trx('schema_migrations').insert({ name: migration, batch: 0, migration_time: new Date() });
        count++;
      }
    }
    await trx.commit();
  } catch (e) {
    await trx.rollback();
    throw e;
  }
  ```
- **Risk**: Corrupted migration state requiring manual database intervention.

### P1-9: `error as Error` Unsafe Cast in Catch Blocks
- **File**: `packages/monitoring/metrics-collector.ts:860`, `mediaCanaries.ts:30`
- **Category**: Type Safety
- **Violation**: `logger.error('Failed to persist metrics', error as Error)` casts caught `unknown` to `Error` without validation. If a non-Error is thrown (string, number, null), the logger may crash or produce corrupted output. The codebase convention (per CLAUDE.md) is: "Catch parameters must be `unknown`. Use `getErrorMessage(error)` from `@errors`."
- **Fix**: `logger.error('Failed to persist metrics', error instanceof Error ? error : new Error(String(error)));`
- **Risk**: Logger crash in error path = silent failure + lost error information.

### P1-10: `ThreadSafeModuleCache` Busy-Wait Loop Burns CPU
- **File**: `apps/api/src/utils/moduleCache.ts:92-101`
- **Category**: Performance | Concurrency
- **Violation**: When a lock is held, the code enters a `for` loop with `setTimeout` exponential backoff (10ms, 20ms, 40ms, ..., 5120ms). This is a busy-wait pattern that burns CPU and delays responses. After 10 retries (~10 seconds total), it proceeds to create a duplicate load, defeating the cache.
- **Fix**: Replace with Promise-based waiting (the existing pattern in `ModuleCache` above):
  ```typescript
  const cached = this.cache.get(key);
  if (cached) return cached;
  // No busy wait - just proceed to load
  ```
  The LRU cache already handles the deduplication via `cache.get(key)`.
- **Risk**: CPU waste under contention. 10-second delays for cache hits.

### P1-11: Open Redirect via Host Header Injection
- **File**: `apps/web/middleware.ts:59,74,96`
- **Category**: Security
- **Violation**: `new URL('/login', req.url)` uses `req.url` as the base URL in three redirect locations. If an attacker injects a crafted `Host` header (e.g., `Host: evil.com`) via reverse proxy misconfiguration, the redirect sends users to `https://evil.com/login` -- a phishing page.
- **Fix**: Hardcode the application origin: `const origin = process.env['NEXT_PUBLIC_APP_URL'] || 'https://app.smartbeak.com';` and use `new URL('/login', origin)`.
- **Risk**: Credential theft via phishing redirect after session expiry.

### P1-12: `ThreadSafeModuleCache` Lock Provides Zero Mutual Exclusion
- **File**: `apps/api/src/utils/moduleCache.ts:104,117,121`
- **Category**: Concurrency
- **Violation**: The lock is set on line 104 and deleted in the `finally` block on line 121 -- but `return promise` on line 118 returns the promise *before it resolves*. The `finally` runs in the same microtask as the lock set, so the lock is held for zero time. Concurrent callers bypass it completely.
- **Fix**: Remove the lock mechanism entirely. The LRU cache already provides memoization via `cache.set(key, promise)` on line 117.
- **Risk**: False sense of concurrency protection. Duplicate expensive loader invocations under contention.

---

## MEDIUM (P2) - Technical Debt / Maintainability / Performance Degradation

### P2-1: Zod Schemas Missing `.strict()`
- **File**: `control-plane/api/routes/media.ts:44,51`, `media-lifecycle.ts:22-26`
- **Category**: Security | Validation
- **Violation**: `UploadIntentBodySchema`, `CompleteUploadParamsSchema`, and `QuerySchema` are `z.object({...})` without `.strict()`. Per CLAUDE.md: "Use `.strict()` on Zod object schemas to reject extra properties." Extra properties pass through unvalidated.
- **Fix**: Add `.strict()` to all three schemas.
- **Risk**: Extra properties in request bodies could be passed to downstream handlers, potentially causing unexpected behavior.

### P2-2: Branded Types Missing Across All Services
- **Files**: `media.ts:24` (`userId: string, mediaId: string`), `media-lifecycle.ts:6-12` (`id: string, org_id: string`), `membership-service.ts:62,73,109,144` (`orgId: string, userId: string`), `membership.ts:16`
- **Category**: Type Safety
- **Violation**: All ID parameters are plain `string` instead of branded types (`UserId`, `OrgId`, `MediaId`). This allows accidentally swapping `userId` and `orgId` at call sites. The codebase has branded types defined in `@kernel/branded`.
- **Fix**: Replace `string` with branded types at all service interfaces. For example:
  ```typescript
  async addMember(orgId: OrgId, userId: UserId, role: Role): Promise<void>
  ```
- **Risk**: Argument transposition bugs that type checking would catch.

### P2-3: Pagination Parameters Validated But Not Used
- **File**: `control-plane/api/routes/media-lifecycle.ts:58,66-67,79-84`
- **Category**: API Contract
- **Violation**: The `QuerySchema` validates `page` and `limit` parameters, and they're returned in the response's `pagination` object, but they're never passed to `svc.getHotCount()` or `svc.countColdCandidates(days)`. The API promises pagination but delivers unpaginated aggregate counts.
- **Fix**: Either remove pagination from the schema/response (these are aggregate counts, not lists), or add pagination to the underlying service calls if the endpoint is meant to return asset lists.
- **Risk**: Client developers build pagination UI for an endpoint that ignores their pagination parameters.

### P2-4: `markAccessed` and `markCold` Silently Succeed on Missing IDs
- **File**: `control-plane/services/media-lifecycle.ts:25-28,87-90`
- **Category**: Data Integrity
- **Violation**: `UPDATE ... WHERE id = $1` returns no error if the ID doesn't exist. The caller has no way to know if the operation had any effect.
- **Fix**: Check `result.rowCount` and throw `NotFoundError` if 0:
  ```typescript
  const result = await this.pool.query(`UPDATE media_assets SET last_accessed_at = NOW() WHERE id = $1`, [mediaId]);
  if (result.rowCount === 0) throw new NotFoundError('Media asset not found');
  ```
- **Risk**: Silent data inconsistency. Operations appear to succeed but have no effect.

### P2-5: `findColdCandidates` and `findOrphaned` Missing ORDER BY
- **File**: `control-plane/services/media-lifecycle.ts:72-79,104-115`
- **Category**: SQL
- **Violation**: Both queries use `LIMIT` without `ORDER BY`. PostgreSQL returns rows in arbitrary order, meaning repeated calls return different subsets. This makes lifecycle operations non-deterministic and non-idempotent.
- **Fix**: Add `ORDER BY created_at ASC` (or another deterministic column) before `LIMIT`.
- **Risk**: Same assets processed repeatedly while others are never processed.

### P2-6: `getStorageUsed` Uses `parseInt` on Large Numbers
- **File**: `control-plane/services/media-lifecycle.ts:167`
- **Category**: Type Safety | Data Integrity
- **Violation**: `parseInt(rows[0]?.total ?? '0', 10)` may lose precision for storage totals exceeding `Number.MAX_SAFE_INTEGER` (9 PB). While unlikely, financial-grade code should not have a silent precision loss path.
- **Fix**: Use `Number()` which handles the same range but avoids the string parsing footguns, or use `BigInt` for truly large values:
  ```typescript
  return Number(rows[0]?.total ?? 0);
  ```
- **Risk**: Incorrect storage billing for very large accounts.

### P2-7: `getGlobalCache` Ignores Options on Subsequent Calls
- **File**: `packages/cache/multiTierCache.ts:740-744`
- **Category**: Architecture
- **Violation**: `getGlobalCache(options)` creates the cache on first call with `options`, but subsequent calls with different options return the already-created cache. There's no warning that options are being ignored.
- **Fix**: Either throw if called with different options than the existing instance, or add a log warning:
  ```typescript
  if (globalCache && options) {
    logger.warn('getGlobalCache called with options but cache already initialized; options ignored');
  }
  ```
- **Risk**: Configuration drift. Different modules expect different TTLs but share the same cache.

### P2-8: Module-Level Mutable State in Metrics
- **File**: `apps/api/src/ops/metrics.ts:19-24`
- **Category**: Architecture
- **Violation**: `metricBuffer`, `metricsInWindow`, and `windowStart` are module-level mutable variables. In a multi-worker setup (cluster mode), each worker has its own copy, leading to fragmented metrics. Additionally, there's no synchronization for race conditions in a single-threaded but async context (the rate limit window check at line 95 is not atomic with the increment at line 102).
- **Fix**: For multi-worker, use shared state (Redis counters). For single-worker, the current approach is acceptable but should be documented.
- **Risk**: Under-counting metrics in clustered deployments.

### P2-9: `Cacheable` Decorator Uses Deprecated Signature
- **File**: `packages/cache/multiTierCache.ts:758-798`
- **Category**: Type Safety
- **Violation**: The decorator uses the legacy `(target, propertyKey, descriptor)` signature, which is deprecated in TypeScript 5.0+ in favor of the Stage 3 decorator proposal. Also, `JSON.stringify(args)` as a cache key is fragile -- objects with different key order produce different keys, and circular references throw.
- **Fix**: For now, document the limitation. For cache key generation, use a stable serializer or accept a custom key function.
- **Risk**: Decorator breaks on TypeScript upgrade. Cache misses for semantically identical arguments.

### P2-10: `clearL2` and `clearAll` Contain Duplicate SCAN Logic
- **File**: `packages/cache/multiTierCache.ts:548-587` vs `593-637`
- **Category**: Architecture | DRY
- **Violation**: The SCAN + batch delete logic is copy-pasted between `clearL2()` and `clearAll()`. Any bug fix in one must be replicated in the other.
- **Fix**: Extract to a private method `scanAndDelete()` called by both.
- **Risk**: Divergent behavior between the two methods after future edits.

### P2-11: Edge Runtime Logger Lacks PII Redaction
- **File**: `apps/web/middleware.ts:12-17`
- **Category**: Security | Observability
- **Violation**: The edge-compatible logger uses raw `console.debug/info/warn/error` with `JSON.stringify`. Unlike `@kernel/logger`, it has no auto-redaction of sensitive fields. If `error` objects or `args` contain tokens, passwords, or API keys, they're logged in plaintext to Vercel's log ingestion.
- **Fix**: Add a minimal sanitization step before logging:
  ```typescript
  const REDACT_KEYS = ['token', 'password', 'secret', 'apiKey', 'authorization'];
  function sanitize(obj: unknown): unknown { /* redact matching keys */ }
  ```
- **Risk**: PII/secret leakage in production logs.

### P2-12: `flushMetrics` is a No-Op in Production
- **File**: `apps/api/src/ops/metrics.ts:146-160`
- **Category**: Architecture
- **Violation**: `flushMetrics()` clears the buffer but does nothing with the metrics (comment: "In production, this would send to metrics backend"). The buffer accumulates, triggers flush at 100 entries or 5 seconds, and the metrics are discarded.
- **Fix**: Implement actual metric shipping (e.g., to Prometheus pushgateway, StatsD, or OTLP endpoint), or remove the buffer entirely and rely on the structured logger handler.
- **Risk**: All operational metrics from the API worker are silently discarded.

### P2-13: `auditLog` is a No-Op Called Outside Transaction
- **File**: `control-plane/services/membership-service.ts:199-207`
- **Category**: Architecture | Compliance
- **Violation**: `auditLog()` only calls `logger.info()` with a comment "In production, this would write to an audit log table." For financial-grade software, audit logging must be durable (written to DB in the same transaction as the mutation). Currently, if the log destination fails, there's no record of the membership change.
- **Fix**: Write audit records to a database table within the same transaction as the membership mutation.
- **Risk**: Compliance failure. No durable audit trail for membership changes.

### P2-14: CSP Nonce Not Propagated to Server Components
- **File**: `apps/web/middleware.ts:120-128`
- **Category**: Security
- **Violation**: The nonce is generated per-request and embedded in the CSP header, but NOT propagated via request headers to Next.js server components. The comment says "Server Components should read it from the CSP header" -- but this requires fragile CSP header parsing. Standard Next.js pattern is to set `x-nonce` on request headers.
- **Fix**: Set nonce on request headers: `requestHeaders.set('x-nonce', nonce); NextResponse.next({ request: { headers: requestHeaders } });`
- **Risk**: Inline scripts/styles blocked by CSP, or developers disable CSP to "fix" the issue.

### P2-15: Missing `Vary` Header for CDN-Cached CSP Nonces
- **File**: `apps/web/middleware.ts:115-128`
- **Category**: Security
- **Violation**: CSP header contains a per-request nonce but no `Vary` header prevents CDN caching of the response. A CDN caching the CSP header turns the per-request nonce into a static nonce, defeating XSS protection.
- **Fix**: Add `response.headers.set('Vary', 'Cookie');`
- **Risk**: CDN caching makes CSP nonces predictable, nullifying XSS protection.

### P2-16: No CSRF Protection in Middleware
- **File**: `apps/web/middleware.ts:41-108`
- **Category**: Security
- **Violation**: No `Origin`/`Referer` header validation for state-changing requests. CSP `form-action 'self'` doesn't protect against JavaScript-initiated cross-origin POSTs.
- **Fix**: Add origin validation for non-GET/HEAD requests.
- **Risk**: Cross-site request forgery against cookie-authenticated endpoints.

### P2-17: Hardcoded Clerk Session Cookie Name
- **File**: `apps/web/middleware.ts:42`
- **Category**: Security
- **Violation**: `req.cookies.get('__session')` hardcodes the cookie name. Clerk's cookie name varies by version and config (`__clerk_db_jwt` in dev, custom names possible). If mismatched, all auth validation is silently skipped.
- **Fix**: Use Clerk's official middleware which handles cookie names internally.
- **Risk**: Auth validation bypassed if Clerk uses a different cookie name.

### P2-18: No Canary Timeout -- Hung Adapter Blocks Indefinitely
- **File**: `apps/api/src/canaries/mediaCanaries.ts:27`
- **Category**: Resilience
- **Violation**: `await fn()` has no timeout. A hung external adapter (DNS/TCP/TLS hang) blocks the canary runner forever.
- **Fix**: Wrap with `AbortSignal.timeout(30000)` or use the project's `CircuitBreaker`.
- **Risk**: Single hung adapter stalls all canary monitoring, masking failures in other adapters.

### P2-19: `ModuleCache` Dead Branch at Line 33
- **File**: `apps/api/src/utils/moduleCache.ts:33-35`
- **Category**: Architecture
- **Violation**: `if (this.isLoading && this.promise)` is unreachable dead code. Line 26 already returns when `this.promise` is truthy. When we reach line 33, `this.promise` is always null.
- **Fix**: Remove the dead branch and the `isLoading` flag entirely. The promise-based memoization pattern needs only the `this.promise` check.
- **Risk**: Dead code creates confusion about the intended concurrency model.

---

## LOW (P3) - Style / Nitpicks / Perfectionist Ideals

### P3-1: `metricsEndpoint` Return Type is Overly Complex
- **File**: `control-plane/services/metrics.ts:15`
- **Category**: Type Safety
- **Violation**: Return type `(_req: unknown, res: { header: ...; send?: ... }) => Promise<string>` is a hand-rolled interface instead of using Fastify's route handler type.
- **Fix**: Use `FastifyRouteHandler` or at least extract a named type.

### P3-2: `migrate-console-logs.ts` Uses `pattern.replacement as any`
- **File**: `scripts/migrate-console-logs.ts:246`
- **Category**: Type Safety
- **Violation**: `as any` cast on regex replacement function. The replacement function types don't match `string.replace()` overloads exactly.
- **Fix**: Type the replacement callbacks to match `(...args: string[]) => string`.

### P3-3: Kernel `metrics.ts` Handler Array Manipulation
- **File**: `packages/kernel/metrics.ts:87`
- **Category**: Architecture
- **Violation**: `getMutableHandlers().length = 0` clears the array in-place. Any code holding a reference from `getHandlers()` sees the mutation despite the "readonly" intent.
- **Fix**: Replace the array reference instead: `handlersStore.handlers = [];`

### P3-4: `mediaCanaries.ts` Log Level for Failures
- **File**: `apps/api/src/canaries/mediaCanaries.ts:30`
- **Category**: Observability
- **Violation**: Canary failures logged at `error` level, but the error is also re-thrown. The caller likely logs it again, causing duplicate error entries.
- **Fix**: Log at `warn` level since the caller handles the error, or don't re-throw.

### P3-5: Missing `updated_at` in `memberships` Table
- **File**: Migration `20260210000100_cp_orgs.up.sql:18-24`
- **Category**: Data Integrity
- **Violation**: The `memberships` table has `created_at` but no `updated_at` column or trigger. When `updateRole` modifies a membership, there's no record of when the change occurred.
- **Fix**: Add `updated_at TIMESTAMPTZ DEFAULT now()` column and an update trigger.

---

## Immediate Production Incident Risk Ranking

| Rank | ID | Issue | Blast Radius | Trigger Condition |
|------|----|-------|-------------|------------------|
| **1** | **P0-5** | **Clerk getAuth() without clerkMiddleware** | **ALL authenticated users** | **Every page load with session** |
| 2 | P0-1 | Membership table mismatch | All multi-tenant auth in apps/api | Any billing/membership API call |
| 3 | P0-3 | requireRole errors masked as 500 | All media routes | Any role-denied request |
| 4 | P1-2 | verifyOrgMembership ignores role | Billing privilege escalation | Viewer accesses billing routes |
| 5 | P0-2 | Metrics endpoint unauthenticated | System observability data leak | Any HTTP request to /metrics |
| 6 | P1-1 | Client-controlled media ID | Media asset integrity | Malicious client submits existing UUID |
| 7 | P1-11 | Open redirect via Host header | Credential theft via phishing | Misconfigured reverse proxy |
| 8 | P1-4 | removeMember stale role read | Org permanently ownerless | Concurrent role update + removal |
| 9 | P0-4 | persistMetrics exceeds param limit | Metrics persistence silently fails | >13,000 unique metric keys |
| 10 | P1-3 | Pool mismatch in media routes | AuthZ bypass in sharded setup | Multi-database deployment |
| 11 | P1-8 | baseline without transaction | Corrupted migration state | Process crash during baseline |
| 12 | P1-5 | AbortSignal listener leak | OOM under sustained load | High-traffic cache usage |

---

## Cross-Cutting Observations

### Pattern: Audit Logging is Universally a No-Op
Both `membership-service.ts:199` and `flushMetrics` in `ops/metrics.ts:146` have "In production, this would..." comments. For financial-grade software, this is unacceptable. Every state mutation must have durable audit records.

### Pattern: Two Membership Systems
The codebase has TWO parallel membership systems:
1. `memberships` table (control-plane, managed by `MembershipService`)
2. `org_memberships` table (apps/api + apps/web, managed by Clerk webhooks)

These can drift. There's no sync mechanism, no foreign key relationship, and no reconciliation job.

### Pattern: Unsafe Type Casts in Route Handlers
All media route handlers use `req as AuthenticatedRequest` (lines 68, 103 in `media.ts`, line 46 in `media-lifecycle.ts`). This bypasses type safety. The Fastify `fastify-type-provider-zod` pattern should be used instead to get type-safe request objects.

### Pattern: No `statement_timeout` on Direct Pool Queries
`media-lifecycle.ts` uses `this.pool.query(...)` directly without setting `statement_timeout`. The `membership-service.ts` correctly sets `SET LOCAL statement_timeout = $1` inside transactions, but `media-lifecycle.ts` has no timeout protection. A slow query could hold a connection indefinitely.

### Pattern: Clerk v6 Migration Incomplete
The codebase upgraded to `@clerk/nextjs ^6.0.0` but never migrated the middleware from the v4/v5 `getAuth()` pattern to v6's `clerkMiddleware()`. This is the single most dangerous finding -- it likely breaks authentication for every user.

---

## Final Totals

| Severity | Count | Key Issues |
|----------|-------|-----------|
| **P0 Critical** | 5 | Clerk auth broken, membership table split, metrics exposed, role errors masked, batch overflow |
| **P1 High** | 12 | Client-controlled UUID, role-less auth check, pool mismatch, race conditions, open redirect, memory leaks, lock ineffective |
| **P2 Medium** | 19 | Zod .strict() missing, branded types, CSP nonce propagation, CSRF gap, dead code, no-op metrics flush, pagination fiction |
| **P3 Low** | 5 | Type complexity, any cast, handler mutation, log duplication, missing updated_at |
| **Total** | **41** | |
