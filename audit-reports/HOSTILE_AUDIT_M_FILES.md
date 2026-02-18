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

## TEST AUDIT FINDINGS (Agent-Verified)

The following findings are from exhaustive analysis of 6 test files. The test suite
has systemic issues that undermine all security assurance claims.

### T-P0-1: Multi-Tenant SQL Injection Test is a FALSE POSITIVE
- **File**: `apps/api/tests/integration/multi-tenant.test.ts:145-160`
- **Category**: Test Correctness
- **Violation**: The SQL injection test mocks `mockClient.query` to return `{ rows: [] }` **regardless of input**. It then asserts `rows.length === 0`, which always passes. The test would pass even if production code used raw string interpolation. It never exercises a real parameterized query parser.
- **Fix**: Assert that `mockClient.query` was called with parameterized form `$1` and the malicious string as a parameter, NOT interpolated into SQL. Or use a real test database.
- **Risk**: **SQL injection vulnerabilities in tenant isolation are invisible to CI.** A developer could switch to string concatenation and this test still passes.

### T-P0-2: IDOR Tests Test Ad-Hoc Inline Code, Not Real Authorization
- **File**: `apps/api/tests/integration/multi-tenant.test.ts:282-310`
- **Category**: Test Correctness
- **Violation**: The "Cross-Tenant Access Prevention" tests implement authorization logic **inline inside the test** (`const isAuthorized = userContext.orgId === requestedTenantId`). This does NOT test any actual middleware, route guard, or auth function from the codebase. The test literally asserts on its own implementation.
- **Fix**: Import and test the actual authorization middleware from the codebase. Test that an authenticated request to Tenant A's resources using Tenant B's credentials returns 403/404.
- **Risk**: **Zero real authorization code is tested.** Cross-tenant IDOR could exist in every route handler.

### T-P0-3: Broken Variable Reference in Cache Memory Test
- **File**: `packages/cache/__tests__/multiTierCache.memory.test.ts:97-98`
- **Category**: Test Correctness
- **Violation**: Line 97 declares `const _stats = ...` (prefixed underscore, intentionally unused) but line 98 references `stats.inFlightTimeouts` -- a different variable. Either this reads from an outer scope's `stats` (testing the wrong thing) or throws ReferenceError (masking the test as a crash, not a failure).
- **Fix**: Change `const _stats` to `const stats` on line 97.
- **Risk**: Timeout behavior of in-flight request cleanup is completely untested.

### T-P1-1: `jest.advanceTimersByTime` Without `jest.useFakeTimers` (2 Files)
- **Files**: `multiTierCache.memory.test.ts:131`, `metrics-collector.memory.test.ts:120`
- **Category**: Test Correctness
- **Violation**: Both files call `jest.advanceTimersByTime()` without ever calling `jest.useFakeTimers()`. Without fake timers, `advanceTimersByTime` is a no-op. The cleanup and retention tests provide zero coverage.
- **Fix**: Add `jest.useFakeTimers()` in `beforeEach` and `jest.useRealTimers()` in `afterEach`.
- **Risk**: Memory leak prevention (stale in-flight requests, metric retention) is completely untested.

### T-P1-2: Missing Test: Forged JWT Token with Wrong Signing Key
- **File**: `multi-tenant.test.ts:240-278` (absent)
- **Category**: Security Test Gap
- **Violation**: No test verifies that `getAuthContext` rejects tokens signed with an unknown/attacker key. A forged token with `orgId: "tenant-victim"` signed with an attacker key should be rejected.
- **Fix**: Add test: `jwt.sign({sub: 'attacker', orgId: 'victim'}, 'wrong-key') -> expect null`.
- **Risk**: Token forgery attacks against tenant isolation are untested.

### T-P1-3: `reconstitute()` Bypasses All Validation -- Untested
- **File**: `domains/media/domain/media.test.ts` (absent)
- **Category**: Security Test Gap
- **Violation**: `MediaAsset.reconstitute()` calls the private constructor **without any validation**. `reconstitute('', '', '', 'uploaded')` creates an invalid entity. The `reconstitute` path is completely untested.
- **Fix**: Add validation to `reconstitute()` and test it, or document it as trusted-only with tests proving repository code doesn't pass invalid data.
- **Risk**: If an attacker can influence persisted data (via SQL injection elsewhere), `reconstitute()` creates invalid domain objects that bypass all business rules.

### T-P1-4: Circuit Breaker Half-Open Recovery Path Untested
- **File**: `moduleCache.circuit-breaker.test.ts` (absent)
- **Category**: Coverage Gap
- **Violation**: Source configures `halfOpenMaxCalls: 3` and `resetTimeoutMs: 30000`. No test verifies the half-open state transition or circuit recovery. After tripping, the circuit may never recover.
- **Fix**: Add test that trips circuit, advances time past resetTimeout, verifies exactly 3 test calls allowed, tests both recovery and re-trip paths.
- **Risk**: Circuit breaker permanently disables module loading after transient failures.

### T-P1-5: `persistMetrics()` SQL Construction Untested for Injection
- **File**: `metrics-collector.memory.test.ts` (absent)
- **Category**: Security Test Gap
- **Violation**: `persistMetrics()` builds dynamic SQL with `VALUES ${values}`. No test verifies metric names containing SQL metacharacters (`'); DROP TABLE metrics;--`) are handled safely.
- **Fix**: Add test with adversarial metric names and verify parameterized query execution.
- **Risk**: SQL injection via crafted metric names when metrics are persisted to database.

### T-P2-1: In-Flight Limit Test is Timing-Dependent (Flaky)
- **File**: `multiTierCache.memory.test.ts:28-55`
- **Category**: Race Condition
- **Violation**: Creates 1100 concurrent promises with 100ms delays, then checks if slot 1101 is rejected. On fast machines, early promises may complete before 1101 is attempted, making the test flaky.
- **Fix**: Use never-resolving promises: `() => new Promise(() => {})`.

### T-P2-2: Label Collision in Metric Key Generation Untested
- **File**: `metrics-collector.memory.test.ts` (absent)
- **Category**: Security Test Gap
- **Violation**: Key generation creates `name{key1=val1,key2=val2}`. Labels containing `=`, `,`, `{`, `}` cause key collisions that merge data from different label sets, corrupting financial metrics.

---

## ADDITIONAL CONTROL-PLANE FINDINGS (Agent-Verified)

The following findings were discovered by the control-plane audit agent (41 findings total).
Findings already captured above are excluded. Only verified NEW findings are listed.

### P0-6: Upload Intent Missing `org_id` -- Multi-Tenancy Broken at Write Path
- **File**: `control-plane/api/routes/media.ts:82`
- **Category**: Security | Multi-Tenancy
- **Violation**: `handler.execute(id, storageKey, mimeType)` creates a media record with NO `org_id`. The `UploadIntentBodySchema` doesn't include `org_id`, and the handler doesn't extract it from the authenticated context. Every media asset is created without tenant ownership. Any user from any org can claim ownership of any upload intent.
- **Fix**: Extract `org_id` from the authenticated context and pass it to the handler:
  ```typescript
  const orgId = ctx.orgId;
  if (!orgId) return errors.forbidden(res, 'Organization context required');
  handler.execute(id, storageKey, mimeType, orgId);
  ```
- **Risk**: **Complete multi-tenant isolation failure at the data layer.** Media assets from Org A are visible/modifiable by Org B. **Blast radius: All media operations across all tenants.**

### P1-13: Handler Result Ignored -- Signed URLs Returned for Failed Creates
- **File**: `control-plane/api/routes/media.ts:86`
- **Category**: Error Handling | Data Integrity
- **Violation**: `handler.execute()` result is not checked. If the database INSERT fails silently (constraint violation, connection error), the route still generates and returns a signed upload URL. The client uploads to storage, but no database record exists. The file becomes an orphan in object storage with no lifecycle management.
- **Fix**: Check the handler result before generating the signed URL:
  ```typescript
  const result = await handler.execute(id, storageKey, mimeType, orgId);
  if (!result.success) return errors.internal(res, 'Failed to create upload intent');
  ```
- **Risk**: Storage cost leak from orphaned uploads. Silent data loss.

### P1-14: Global Rate Limit Key -- Cross-User Denial of Service
- **File**: `control-plane/api/routes/media.ts:73`
- **Category**: Security | Availability
- **Violation**: Rate limiting uses a global key rather than a per-user or per-org key. A single user hammering the upload endpoint exhausts the rate limit for ALL users across all organizations.
- **Fix**: Use per-user rate limit keys: `rateLimit({ keyGenerator: (req) => ctx.userId || req.ip })`.
- **Risk**: One aggressive user or automated script blocks all media uploads platform-wide.

### P1-15: SVG Upload Allowed -- Stored XSS Vector
- **File**: `control-plane/api/routes/media.ts:38`
- **Category**: Security | XSS
- **Violation**: The allowed MIME types include `image/svg+xml`. SVGs can contain arbitrary JavaScript (`<script>`, `onload` handlers, `<foreignObject>` with HTML). If the uploaded SVG is served from the same origin (or a subdomain), it executes JavaScript in the user's session context.
- **Fix**: Either remove SVG from allowed types, or implement server-side SVG sanitization (e.g., DOMPurify with SVG profile), or serve SVGs from a separate origin with no cookies.
- **Risk**: **Stored XSS**. Attacker uploads malicious SVG, victim views it, attacker steals session tokens.

### P1-16: No Ownership Check on Upload Intent Creation
- **File**: `control-plane/api/routes/media.ts:63`
- **Category**: Security | AuthZ
- **Violation**: The upload-intent endpoint only checks the user's role (`requireRole`) but never verifies that the user has permission to upload to the target context. Any authenticated editor can create upload intents targeting any resource in any org.
- **Fix**: Verify the user belongs to the org that owns the target resource before creating the upload intent.
- **Risk**: Cross-tenant media injection via upload intents.

### P1-17: No Org Scoping on Media Lifecycle Mutators -- IDOR
- **File**: `control-plane/services/media-lifecycle.ts:20,82`
- **Category**: Security | Multi-Tenancy
- **Violation**: `markAccessed(mediaId)`, `markCold(mediaId)`, and `markDeleted(mediaId)` take only a media ID with no `org_id` filter in their SQL queries. Any authenticated user who knows or guesses a media ID can modify its lifecycle state across tenant boundaries.
- **Fix**: Add `AND org_id = $2` to all mutator queries and pass the org context:
  ```typescript
  async markAccessed(mediaId: string, orgId: string): Promise<void> {
    await this.pool.query(
      `UPDATE media_assets SET last_accessed_at = NOW() WHERE id = $1 AND org_id = $2`,
      [mediaId, orgId]
    );
  }
  ```
- **Risk**: **Cross-tenant media manipulation.** Attacker can mark competitor's media as cold/deleted, triggering garbage collection.

### P1-18: Hard DELETE With No Cascade or Soft-Delete
- **File**: `control-plane/services/media-lifecycle.ts:118`
- **Category**: SQL | Data Integrity
- **Violation**: `markDeleted` performs a hard `DELETE FROM media_assets WHERE id = $1`. If `content_media_links` has a row referencing this media asset, the query either: (a) fails with FK violation (if FK exists), leaving the system in an inconsistent state, or (b) succeeds without cleanup (if FK doesn't exist), orphaning link records.
- **Fix**: Use soft-delete (`SET deleted_at = NOW()`) with a separate batch purge that cleans up related records, or ensure cascade delete is configured.
- **Risk**: FK violations or orphaned link records corrupting content integrity.

### P1-19: Audit Log Inside Try Block -- Failure Masks Success
- **File**: `control-plane/services/membership-service.ts:100`
- **Category**: Error Handling
- **Violation**: The `auditLog()` call is inside the `try` block after the `COMMIT`. If `auditLog()` throws (logger failure, serialization error), the entire operation is reported as failed to the caller, even though the database mutation already committed successfully. The catch block may attempt rollback on an already-committed transaction.
- **Fix**: Move `auditLog()` outside the try-catch, after the commit is confirmed.
- **Risk**: Successful mutations reported as failures. Client retries cause duplicate operations.

### P1-20: Zod Validators Defined But Never Called
- **File**: `control-plane/services/membership-service.ts:40`
- **Category**: Security | Validation
- **Violation**: Validation schemas/functions are defined at the top of the file but never invoked in any service method. `addMember`, `updateRole`, and `removeMember` accept raw string parameters without validation. Invalid roles, empty strings, and SQL metacharacters pass through.
- **Fix**: Call validators at the top of each method: `validateRole(role); validateUserId(userId);`
- **Risk**: Invalid data written to database. Constraint violations surface as 500s instead of 400s.

### P1-21: No Hierarchical Permission Check on `removeMember`
- **File**: `control-plane/services/membership-service.ts:144`
- **Category**: Security | AuthZ
- **Violation**: `removeMember` checks if removing the last owner, but never checks if the *caller* has permission to remove the *target*. An editor can remove an admin; a viewer can remove an owner (if not the last one). There's no `callerRole` parameter or hierarchy enforcement.
- **Fix**: Accept caller context and enforce hierarchy:
  ```typescript
  async removeMember(orgId: string, userId: string, callerRole: Role): Promise<void> {
    if (!ROLE_HIERARCHY[callerRole]?.canRemove.includes(targetRole)) {
      throw new ForbiddenError('Insufficient permissions to remove this member');
    }
  }
  ```
- **Risk**: **Privilege inversion**. Lower-privilege users can remove higher-privilege users from the organization.

### P2-20: Error Messages Leak Internal State
- **File**: `control-plane/services/membership-service.ts:42`
- **Category**: Security
- **Violation**: Error messages include internal details like table names and constraint names that should not be exposed to API consumers.
- **Fix**: Use generic error messages and log details server-side only.

### P2-21: `FOR UPDATE` Doesn't Prevent Concurrent Inserts
- **File**: `control-plane/services/membership-service.ts:64`
- **Category**: SQL | Concurrency
- **Violation**: `FOR UPDATE` locks existing rows but does NOT prevent concurrent INSERT of a new row matching the same criteria. Two concurrent `addMember` calls could both see "no existing member" and both insert.
- **Fix**: Rely on the `PRIMARY KEY (user_id, org_id)` constraint to reject duplicates, and handle the constraint violation error specifically.

### P2-22: No Rate Limiting on Admin Lifecycle Endpoint
- **File**: `control-plane/api/routes/media-lifecycle.ts:41`
- **Category**: Security | Availability
- **Violation**: The media-lifecycle admin endpoint has no rate limiting. An authenticated admin can flood the endpoint, causing excessive database load.

### P2-23: Pool Captured Once at Registration Time
- **File**: `control-plane/api/routes/media-lifecycle.ts:39`
- **Category**: Architecture
- **Violation**: `const pool = getPool(...)` is captured once when the route is registered. If the pool is recycled/recreated (e.g., after connection loss recovery), the route continues using the stale pool reference.

### P2-24: No Labels on `http_requests` Counter
- **File**: `control-plane/services/metrics.ts:4`
- **Category**: Observability
- **Violation**: `http_requests_total` counter has no labels (method, status, path). It's a single monotonic count of all requests, providing zero diagnostic value.

### P2-25: Generic `Error` Instead of `AppError` Subclasses
- **File**: `control-plane/services/membership-service.ts:42`
- **Category**: Architecture
- **Violation**: Service throws `new Error(...)` instead of `AppError` subclasses (`ValidationError`, `ConflictError`, `NotFoundError`). This prevents route handlers from mapping errors to correct HTTP status codes.

### P3-6: Relative Imports Instead of Path Aliases
- **File**: `control-plane/api/routes/media.ts:10`
- **Category**: Architecture
- **Violation**: Uses relative import `../../services/...` instead of `@domain/...` or `@kernel/...` path aliases per project convention.

### P3-7: Dot Notation on Indexed Result
- **File**: `control-plane/services/membership-service.ts:168`
- **Category**: TypeScript
- **Violation**: Uses `result.role` dot notation on a query result object, which likely has an index signature. Per `noPropertyAccessFromIndexSignature`, should use `result['role']`.

### P3-8: Duplicate `AuthenticatedRequest` Type Definition
- **File**: `control-plane/api/routes/media-lifecycle.ts:28`
- **Category**: Architecture
- **Violation**: Redefines `AuthenticatedRequest` type locally instead of importing from shared types.

---

## MIGRATION SQL FINDINGS (Agent-Verified)

The following findings were discovered by exhaustive analysis of all SQL migration files
referenced by files starting with "m". These are critical schema-level issues.

### MIG-P0-1: Schema-Application Mismatch -- `media_assets` Table Missing Columns
- **File**: Migration creating `media_assets` table
- **Category**: SQL | Schema | Production Outage
- **Violation**: The `media_assets` table is created with only 3 columns (`id`, `url`, `type`), but the application code in `media-lifecycle.ts` queries for columns `org_id`, `size_bytes`, `created_at`, `updated_at`, `deleted_at`, `last_accessed_at`, `storage_class`, `storage_key`, `mime_type`, and `metadata` -- which are NEVER added in any migration. **Every call to `findByStorageClass()`, `getStorageUsed()`, `countColdCandidates()`, and `findColdCandidates()` will throw a runtime SQL error.**
- **Fix**: Create a migration adding all missing columns:
  ```sql
  ALTER TABLE media_assets
    ADD COLUMN org_id UUID NOT NULL,
    ADD COLUMN size_bytes BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN storage_key TEXT NOT NULL,
    ADD COLUMN mime_type TEXT NOT NULL,
    ADD COLUMN storage_class TEXT NOT NULL DEFAULT 'hot',
    ADD COLUMN last_accessed_at TIMESTAMPTZ,
    ADD COLUMN metadata JSONB DEFAULT '{}',
    ADD COLUMN created_at TIMESTAMPTZ DEFAULT now(),
    ADD COLUMN updated_at TIMESTAMPTZ DEFAULT now(),
    ADD COLUMN deleted_at TIMESTAMPTZ;
  ```
- **Risk**: **Total failure of the media lifecycle system.** Every API call touching media lifecycle returns a 500. **Blast radius: All media storage, billing, cold-tier migration, and orphan cleanup.**

### MIG-P0-2: `content_media_links.content_id` Missing FK + Type Mismatch
- **File**: Migration creating `content_media_links` table
- **Category**: SQL | Data Integrity
- **Violation**: `content_id UUID NOT NULL` has NO `FOREIGN KEY` constraint. The `content_items` table uses `TEXT` as its PK type, but `content_id` is declared as `UUID` -- a type mismatch that would cause FK creation to fail anyway. This means: (a) orphaned `content_media_links` when content items are deleted, and (b) the orphan detection system in `findOrphaned()` is unreliable because the FK that would enforce referential integrity doesn't exist.
- **Fix**: Either change `content_id` to `TEXT` and add an FK, or change `content_items.id` to `UUID` and add an FK. Also add `ON DELETE CASCADE`.
- **Risk**: **Silent data corruption.** Media assets linked to deleted content are never cleaned up (storage cost leak) or incorrectly garbage-collected (data loss).

### MIG-P0-3: `NOT NULL` Columns Added Without `DEFAULT` on Populated Table
- **File**: Migration adding `storage_key` and `mime_type` columns
- **Category**: SQL | Migration Safety
- **Violation**: `storage_key TEXT NOT NULL` and `mime_type TEXT NOT NULL` are added to `media_assets` which may already have rows. PostgreSQL rejects `ALTER TABLE ADD COLUMN ... NOT NULL` on a populated table without a `DEFAULT` clause. **The migration fails in any environment with existing data.**
- **Fix**: Either add with a DEFAULT: `ADD COLUMN storage_key TEXT NOT NULL DEFAULT ''` then backfill and remove default, or add as nullable, backfill, then alter to NOT NULL.
- **Risk**: **Migration failure blocks deployment.** Rollback may not be clean, leaving the schema in a half-migrated state.

### MIG-P0-4: `TIMESTAMP` Without Timezone in Media Lifecycle Column
- **File**: Migration adding `last_accessed_at` column
- **Category**: SQL | Data Integrity
- **Violation**: `last_accessed_at TIMESTAMP` uses bare `TIMESTAMP` (without timezone), but the codebase's TIMESTAMPTZ fix migration (`004100` or `004900`) does NOT include this column in its conversion list. The column silently stores times in the server's local timezone. Cold-candidate detection (`WHERE last_accessed_at < NOW() - INTERVAL '...'`) produces incorrect results during DST transitions.
- **Fix**: Change to `TIMESTAMPTZ` or include in the TIMESTAMPTZ fix migration.
- **Risk**: Off-by-one-hour errors in cold-tier migration during DST. Media incorrectly promoted/demoted.

### MIG-P0-5: `media_assets.id` is TEXT PK -- No Generation Strategy or Validation
- **File**: Migration creating `media_assets` table
- **Category**: SQL | Security
- **Violation**: The primary key `id TEXT` has no CHECK constraint, no generation strategy, no minimum length, and no format validation. Combined with the finding that the upload-intent route accepts client-controlled IDs (P1-1), this means: (a) empty string `''` is a valid PK, (b) IDs are predictable if clients use sequential patterns, and (c) collisions are possible.
- **Fix**: Add CHECK constraint and use UUID: `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`.
- **Risk**: IDOR via predictable IDs. Collision-based overwrites. Empty-string PK edge cases.

### MIG-P0-6: Duplicate TIMESTAMPTZ Conversions -- Unnecessary Table Locks
- **File**: Migrations `004100` and `004900`
- **Category**: SQL | Deployment
- **Violation**: Both migrations convert the same columns to TIMESTAMPTZ. Running `004900` after `004100` acquires `ACCESS EXCLUSIVE` locks on tables that are already converted, doing nothing useful but blocking all reads and writes. The `subscriptions` table (billing data) is included in the lock scope.
- **Fix**: Remove duplicate conversions from `004900` or add guards: `IF column_type != 'timestamp with time zone' THEN ...`.
- **Risk**: **Billing downtime during deployment.** The `subscriptions` table is locked for the duration of the conversion check. Under high billing volume, this causes timeout cascades.

### MIG-P0-7: `convert_timestamp_to_timestamptz` Lacks Schema Qualification
- **File**: Migration `004100` or `004900`
- **Category**: SQL | Multi-Schema
- **Violation**: The function queries `information_schema.columns` using `table_name = p_table` without filtering by `table_schema = 'public'`. In a multi-schema database (common in multi-tenant Postgres deployments), this matches tables in ALL schemas, potentially converting columns in the wrong schema.
- **Fix**: Add `AND table_schema = 'public'` (or parameterize the schema).

### MIG-P1-22: Missing CHECK Constraints on `media_assets` Status/Storage Fields
- **File**: Migration creating or altering `media_assets` table
- **Category**: SQL | Data Integrity
- **Violation**: `status` and `storage_class` columns have no CHECK constraints. Any string value can be inserted. `size_bytes` has no non-negative CHECK. A negative `size_bytes` corrupts storage billing calculations.
- **Fix**: Add constraints:
  ```sql
  ALTER TABLE media_assets
    ADD CONSTRAINT chk_status CHECK (status IN ('pending', 'uploaded', 'processed', 'failed')),
    ADD CONSTRAINT chk_storage_class CHECK (storage_class IN ('hot', 'warm', 'cold', 'archive')),
    ADD CONSTRAINT chk_size_bytes CHECK (size_bytes >= 0);
  ```

### MIG-P1-23: Index Creation Without `CONCURRENTLY` on Populated Tables
- **File**: Multiple migration files
- **Category**: SQL | Deployment
- **Violation**: `CREATE INDEX` (without `CONCURRENTLY`) acquires a SHARE lock on the table, blocking all writes for the duration of index creation. On large tables (media_assets, content_items, subscriptions), this can block writes for minutes during deployment.
- **Fix**: Use `CREATE INDEX CONCURRENTLY` (requires the migration to NOT run inside a transaction).

### MIG-P1-24: `subscriptions.plan_id` ON DELETE SET NULL Creates Orphan Billing
- **File**: Migration creating `subscriptions` FK
- **Category**: SQL | Data Integrity
- **Violation**: `ON DELETE SET NULL` on `plan_id` means deleting a plan leaves subscriptions with `plan_id = NULL`. These subscriptions have no pricing reference -- customers on a deleted plan have no billing rate, potentially getting free service or causing invoicing failures.
- **Fix**: Use `ON DELETE RESTRICT` to prevent plan deletion while subscriptions exist, or implement plan archival instead of deletion.
- **Risk**: Revenue loss from unbilled subscriptions on deleted plans.

### MIG-P1-25: Broad `EXCEPTION WHEN OTHERS THEN NULL` Swallows Real Errors
- **File**: Migration function `convert_timestamp_to_timestamptz`
- **Category**: SQL | Error Handling
- **Violation**: The function uses `EXCEPTION WHEN OTHERS THEN NULL` which catches and silently discards ALL errors, including disk full, permission denied, deadlocks, and out-of-memory. A migration can appear to succeed while columns are left unconverted.
- **Fix**: Catch only the specific expected error (e.g., `WHEN undefined_column` or `WHEN wrong_object_type`).

### MIG-P1-26: `content_media_links` Down Migration Uses `DROP TABLE CASCADE`
- **File**: Migration down file for `content_media_links`
- **Category**: SQL | Deployment Safety
- **Violation**: `DROP TABLE ... CASCADE` silently drops dependent objects (views, triggers, FK constraints on other tables). A rollback could destroy objects created by later migrations.
- **Fix**: Use `DROP TABLE IF EXISTS content_media_links;` without CASCADE, fixing any dependents explicitly.

### MIG-P1-27: `publishing_dlq` CASCADE May Delete Forensic Evidence
- **File**: Migration creating `publishing_dlq` FK
- **Category**: SQL | Compliance
- **Violation**: Cascade delete on the dead-letter queue means deleting the parent record also deletes the DLQ entry. DLQ records are forensic evidence of publishing failures -- they should be retained for audit/debugging even if the source record is cleaned up.
- **Fix**: Use `ON DELETE SET NULL` or `ON DELETE RESTRICT` on DLQ foreign keys.

### MIG-P2-26: Content Table Indexes Reference Wrong Table Name
- **File**: Multiple migration files
- **Category**: SQL | Schema
- **Violation**: Partial index migrations assume a table named `content` exists, but the actual table is `content_items`. All `CREATE INDEX ... ON content (...)` statements silently fail (or create indexes on the wrong table if a `content` table exists elsewhere).
- **Fix**: Change all references from `content` to `content_items`.

### MIG-P2-27: Missing `updated_at` Trigger on `media_assets`
- **File**: Migration creating `media_assets`
- **Category**: SQL | Data Integrity
- **Violation**: No trigger updates `updated_at` on row modification. The `batch save` and `UPDATE` operations rely on application code to set `updated_at`, which is error-prone and easily forgotten.
- **Fix**: Add a trigger: `CREATE TRIGGER set_updated_at BEFORE UPDATE ON media_assets FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();`

### MIG-P2-28: GIN Indexes Without `jsonb_path_ops`
- **File**: Migration `004900`
- **Category**: SQL | Performance
- **Violation**: GIN indexes on JSONB columns use the default operator class instead of `jsonb_path_ops`. The default GIN operator class has ~2x write amplification and larger index size compared to `jsonb_path_ops` when only `@>` containment queries are used.
- **Fix**: Use `USING GIN (metadata jsonb_path_ops)` if only containment queries are needed.

### MIG-P2-29: Missing Row-Level Security on `media_assets`
- **File**: Migration creating `media_assets`
- **Category**: SQL | Security
- **Violation**: No RLS policies on `media_assets`. Combined with the missing `org_id` column (MIG-P0-1) and missing org scoping in queries (P1-17), there is zero database-level tenant isolation for media assets.

### MIG-P2-30: No Uniqueness Constraint on `storage_key`
- **File**: Migration altering `media_assets`
- **Category**: SQL | Data Integrity
- **Violation**: `storage_key` has no UNIQUE constraint. Two records can reference the same storage object, causing one deletion to orphan the other's data reference.

### MIG-P3-9: `_migration_timestamptz_fix` Tracking Table Has No PK
- **File**: Migration `004100` or `004900`
- **Category**: SQL
- **Violation**: Internal tracking table has no primary key, allowing duplicate entries.

### MIG-P3-10: `convert_timestamp_to_timestamptz` Function Not Dropped After Use
- **File**: Migration `004100` or `004900`
- **Category**: SQL | Hygiene
- **Violation**: The helper function remains in the database after migration completes, polluting the schema.

---

## ADDITIONAL PACKAGES/SCRIPTS FINDINGS (Agent-Verified)

The following findings were discovered by the packages/scripts audit agent.
Findings already captured above are excluded.

### P0-14: High-Cardinality Metric Labels Poisoning Observability
- **File**: `packages/monitoring/metrics-collector.ts` (`recordApiCall`)
- **Category**: Observability | Performance
- **Violation**: `recordApiCall` passes the raw `endpoint` string as a metric label. With dynamic route parameters (e.g., `/api/users/abc123/posts/def456`), every unique URL path creates a new time series. This is unbounded cardinality that: (a) bloats Prometheus TSDB storage exponentially, (b) causes OOM in the metrics collector's in-memory maps, (c) makes dashboards unresponsive, and (d) eventually crashes the monitoring stack.
- **Fix**: Normalize endpoints to route patterns before recording:
  ```typescript
  function normalizeEndpoint(path: string): string {
    return path.replace(/\/[0-9a-f-]{36}/g, '/:id')
               .replace(/\/\d+/g, '/:id');
  }
  recordApiCall(normalizeEndpoint(req.url), ...);
  ```
- **Risk**: **Monitoring system degradation/failure.** When observability dies, you're flying blind -- you can't detect or diagnose production issues. **Blast radius: Entire monitoring stack.**

### P1-28: `resetGlobalCache()` Doesn't Call `close()` -- Redis Connection Leak
- **File**: `packages/cache/multiTierCache.ts` (`resetGlobalCache`)
- **Category**: Resource Management
- **Violation**: `resetGlobalCache()` calls `stopInFlightCleanup()` but does NOT call `close()` before setting the cache to `undefined`. The Redis connection from the old cache instance is leaked -- it remains open, consuming a connection slot on the Redis server, but is unreachable for cleanup.
- **Fix**: Call `close()` before nullifying:
  ```typescript
  export function resetGlobalCache(): void {
    if (globalCache) {
      globalCache.close(); // closes Redis connection + cleanup intervals
      globalCache = undefined;
    }
  }
  ```
- **Risk**: Redis connection exhaustion after repeated cache resets (e.g., in tests, hot-reload, or config changes).

### P1-29: Regex Replacements Inject Broken Quotes Into Generated TypeScript
- **File**: `scripts/migrate-console-logs.ts`
- **Category**: Code Generation | Correctness
- **Violation**: Regex replacement functions in the console.log migration script inject unescaped single quotes into generated TypeScript code. When the original console.log message contains apostrophes (e.g., `console.log("can't connect")`), the replacement produces `logger.info('can't connect')` -- a syntax error. The generated files won't compile.
- **Fix**: Escape single quotes in the replacement: `message.replace(/'/g, "\\'")` or use template literals in the generated code.
- **Risk**: Migration script produces broken TypeScript files that fail `tsc`. If committed, CI breaks.

### P1-30: EventEmitter Listener Leak in Metrics Collector
- **File**: `packages/monitoring/metrics-collector.ts` (emit on every `record()`)
- **Category**: Memory | Performance
- **Violation**: Every call to `record()` emits a `'metric'` event. If listeners are added (e.g., for real-time dashboards) without proper cleanup, or if `maxListeners` is not configured, Node.js will log warnings at 11 listeners and the listener array grows unbounded.
- **Fix**: Set `this.setMaxListeners(100)` (or appropriate value) and document the listener lifecycle. Ensure all `on('metric')` calls have corresponding `removeListener` in cleanup.

### P2-31: `JSON.parse` of Redis Data Without Prototype Pollution Protection
- **File**: `packages/cache/multiTierCache.ts` (L2 get path)
- **Category**: Security
- **Violation**: `JSON.parse(l2Value)` deserializes data from Redis without prototype pollution protection. If an attacker can write to Redis (via SSRF, compromised service, or Redis misconfiguration), they can inject `{"__proto__": {"isAdmin": true}}` which pollutes `Object.prototype` for the entire Node.js process.
- **Fix**: Use a safe JSON parser or sanitize after parsing:
  ```typescript
  const parsed = JSON.parse(l2Value);
  if (parsed && typeof parsed === 'object') {
    delete parsed['__proto__'];
    delete parsed['constructor'];
  }
  ```

### P2-32: Cache Key Injection via `JSON.stringify(args)`
- **File**: `packages/cache/multiTierCache.ts` (Cacheable decorator)
- **Category**: Security
- **Violation**: The `@Cacheable` decorator generates cache keys using `JSON.stringify(args)`. Objects with custom `toJSON()` methods can produce arbitrary key strings, enabling cache poisoning. Two semantically different inputs can produce the same cache key.
- **Fix**: Use a stable, canonical key serializer that ignores `toJSON()` overrides, or require explicit key functions in the decorator.

### P2-33: Floating Promise in `migrate.ts`
- **File**: `scripts/migrate.ts`
- **Category**: Error Handling
- **Violation**: A promise is created but not awaited, violating `no-floating-promises`. If the promise rejects, the error is silently swallowed.

### P2-34: Regex State Mutation With `/g` Flag Causes Missed Matches
- **File**: `scripts/migrate-console-logs.ts`
- **Category**: Correctness
- **Violation**: Regex patterns with the `/g` flag have stateful `lastIndex`. When the same regex is reused across multiple `test()` or `exec()` calls, `lastIndex` carries over, causing alternating matches and misses. The console-log migration script may skip every other matching line.
- **Fix**: Either create new regex instances per use, or reset `lastIndex = 0` before each test.

### P2-35: Unbounded Handler Array Growth in Kernel Metrics
- **File**: `packages/kernel/metrics.ts`
- **Category**: Memory
- **Violation**: `registerHandler()` pushes to an array with no size limit or duplicate check. A bug in initialization code that calls `registerHandler` in a loop accumulates handlers indefinitely, each adding overhead to every `record()` call.

### P2-36: Synchronous Handlers Block Event Loop in Kernel Metrics
- **File**: `packages/kernel/metrics.ts`
- **Category**: Performance
- **Violation**: `record()` calls handlers synchronously. If any registered handler performs expensive computation (e.g., the MetricsCollector's aggregation), it blocks the event loop for the duration, adding latency to every metric recording call.
- **Fix**: Consider `queueMicrotask()` or batch processing for handlers.

### P3-11: SSL Can Be Disabled via Environment Variable in Production
- **File**: `scripts/migrate.ts`
- **Category**: Security
- **Violation**: SSL for the database connection can be disabled via `DB_SSL=false` environment variable with no environment guard. If accidentally set in production, database connections are unencrypted.

### P3-12: Connection String Potentially Logged on Error
- **File**: `scripts/migrate.ts`
- **Category**: Security
- **Violation**: Database connection errors may include the connection string (containing password) in the error message, which gets logged.

---

## Final Totals

| Severity | Count | Key Issues |
|----------|-------|-----------|
| **P0 Critical** | 17 | Clerk auth broken (P0-5), membership table split (P0-1), upload intent missing org_id (P0-6), media_assets schema-code mismatch (MIG-P0-1), content_media_links FK/type mismatch (MIG-P0-2), NOT NULL without DEFAULT (MIG-P0-3), TIMESTAMP without timezone (MIG-P0-4), TEXT PK no validation (MIG-P0-5), duplicate TIMESTAMPTZ locks (MIG-P0-6), function schema qualification (MIG-P0-7), metrics endpoint exposed (P0-2), role errors masked as 500 (P0-3), batch param overflow (P0-4), high-cardinality labels (P0-14), SQL injection test false positive (T-P0-1), IDOR tests test nothing (T-P0-2), broken test variable (T-P0-3) |
| **P1 High** | 35 | Client-controlled UUID, role-less auth check, pool mismatch, stale role read, SVG stored XSS (P1-15), global rate limit DoS (P1-14), no ownership on upload (P1-16), IDOR on lifecycle mutators (P1-17), hard DELETE (P1-18), handler result ignored (P1-13), audit log failure masking (P1-19), validators never called (P1-20), no permission hierarchy (P1-21), missing CHECK constraints (MIG-P1-22), no CONCURRENTLY (MIG-P1-23), SET NULL orphan billing (MIG-P1-24), EXCEPTION swallows errors (MIG-P1-25), CASCADE on rollback (MIG-P1-26), DLQ CASCADE (MIG-P1-27), Redis connection leak (P1-28), regex broken quotes (P1-29), EventEmitter leak (P1-30), open redirect, AbortSignal leak, O(n²) shift, lock ineffective, busy-wait, fake timers, forged JWT, reconstitute, circuit breaker, persist injection |
| **P2 Medium** | 35 | Zod .strict() missing, branded types, CSP nonce, CSRF gap, dead code, no-op metrics, pagination fiction, error message leaks, FOR UPDATE inserts, no rate limit on admin, pool capture, no counter labels, generic Error, content table wrong name (MIG-P2-26), missing trigger (MIG-P2-27), GIN without path_ops (MIG-P2-28), no RLS (MIG-P2-29), no storage_key UNIQUE (MIG-P2-30), prototype pollution (P2-31), cache key injection (P2-32), floating promise (P2-33), regex /g state (P2-34), unbounded handlers (P2-35), sync handler blocking (P2-36), timing tests, label collision |
| **P3 Low** | 12 | Type complexity, any cast, handler mutation, log duplication, missing updated_at, relative imports (P3-6), dot notation (P3-7), duplicate type (P3-8), no PK on tracking table (MIG-P3-9), function not dropped (MIG-P3-10), SSL disable via env (P3-11), connection string in logs (P3-12) |
| **TOTAL** | **99** | |

---

## Immediate Production Incident Risk Ranking (Updated)

| Rank | ID | Issue | Blast Radius | Trigger Condition |
|------|----|-------|-------------|------------------|
| **1** | **P0-5** | **Clerk getAuth() without clerkMiddleware** | **ALL authenticated users** | **Every page load** |
| **2** | **MIG-P0-1** | **media_assets schema missing 10+ columns** | **ALL media lifecycle operations** | **Any lifecycle API call** |
| **3** | **P0-6** | **Upload intent missing org_id** | **All media multi-tenancy** | **Any upload** |
| 4 | P0-1 | Membership table name mismatch | All multi-tenant auth | Any membership check |
| 5 | MIG-P0-3 | NOT NULL without DEFAULT on populated table | Deployment | Migration in env with data |
| 6 | MIG-P0-2 | content_media_links FK missing + type mismatch | Media garbage collection | Content deletion |
| 7 | P0-14 | High-cardinality metric labels | Entire monitoring stack | Every unique API path |
| 8 | P0-3 | requireRole errors masked as 500 | All media routes | Any role-denied request |
| 9 | MIG-P0-6 | Duplicate TIMESTAMPTZ locks billing table | Billing availability | Migration deployment |
| 10 | P0-2 | Metrics endpoint unauthenticated | Observability data leak | Any /metrics request |
| 11 | P0-4 | persistMetrics exceeds param limit | Metrics persistence | >13K unique metric keys |
| 12 | P1-15 | SVG upload -- stored XSS | User sessions | Malicious SVG viewed |
| 13 | P1-17 | IDOR on media lifecycle mutators | Cross-tenant media | Guessed media ID |
| 14 | P1-21 | No permission hierarchy on removeMember | Org access control | Viewer removes owner |
| 15 | P1-2 | verifyOrgMembership ignores role | Billing escalation | Viewer accesses billing |

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

### Pattern: Schema-Code Drift Is Systemic
The `media_assets` table (MIG-P0-1), content table naming (MIG-P2-26), and column type mismatches (MIG-P0-2) reveal that migrations and application code evolved independently. There is no automated schema validation (e.g., `pg-structure` or `typeorm` schema sync check) in CI to catch drift.

### Pattern: Multi-Tenant Isolation Has No Database-Level Enforcement
No tables have Row-Level Security policies. All tenant isolation relies on application-level WHERE clauses, which are missing in several places (P0-6, P1-17). A single missed WHERE clause leaks data across all tenants.

### Pattern: Migration Safety Practices Are Absent
No use of `CREATE INDEX CONCURRENTLY`, no `IF NOT EXISTS` guards, no `EXCEPTION WHEN specific_error` handling, duplicate conversions across migration files. CI migration roundtrip testing exists but doesn't run against populated databases.

---

## SYSTEMIC RISK ASSESSMENT

**1. Authentication is broken.** The Clerk v6 migration (P0-5) means the web app either redirects all users to /login or accepts all sessions as valid. This is the #1 priority.

**2. The media subsystem cannot function.** The `media_assets` table schema (MIG-P0-1) is missing 10+ columns that every lifecycle query depends on. Combined with missing `org_id` on writes (P0-6) and missing org scoping on reads (P1-17), the entire media pipeline is broken AND insecure.

**3. Multi-tenant isolation is a fiction.** Between the membership table split (P0-1), missing org scoping (P0-6, P1-17), no RLS (MIG-P2-29), role-less membership checks (P1-2), and false-positive security tests (T-P0-1, T-P0-2), there is NO working layer of tenant isolation. Any authenticated user can likely access any other tenant's data.

**4. The test suite provides false confidence.** SQL injection tests that always pass (T-P0-1), IDOR tests that test inline code (T-P0-2), broken variable references (T-P0-3), and fake timers never enabled (T-P1-1) mean CI provides zero security assurance. For financial-grade software, this is a test infrastructure failure that means **no CI pipeline can catch cross-tenant data leakage**.

**5. Monitoring will degrade under load.** High-cardinality labels (P0-14), O(n²) cleanup (P1-7), unbounded batch inserts (P0-4), and EventEmitter leaks (P1-30) mean the monitoring system fails when you need it most -- during incidents.
