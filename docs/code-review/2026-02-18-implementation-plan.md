# Code Review — Implementation Plan
**Date**: 2026-02-18
**Branch**: `claude/code-review-plan-SmEJJ`
**Scope**: Full codebase — control-plane, domains, packages, apps
**Based on**: 2026-02-17 review + extended 2026-02-18 review

---

## Overview

This document consolidates findings from both reviews and converts each issue into an actionable fix. Issues are grouped into four priority tiers. Each item lists the affected file(s), root cause, and the exact change required.

**Total issues**

| Tier | Count | Description |
|------|-------|-------------|
| P0 — Critical functional bugs | 10 | Routes broken for every request, silent data loss, non-atomic state machines |
| P1 — High severity | 14 | Security, idempotency, auth, missing error handling |
| P2 — Medium severity | 18 | Logic bugs, convention violations, performance waste |
| P3 — Low severity | 12 | Code quality, consistency, documentation |

---

## P0 — Critical Functional Bugs

These must be fixed before any new feature work. Each issue causes routes to fail for all users or silently corrupts data.

---

### P0-1: All publishing routes return 400 (`ctx.domainId` always undefined)

**Files**: `control-plane/api/routes/publishing.ts:33,45,63`
**Root cause**: `JwtClaimsSchema` has no `domainId` field. `AuthContext` carries only `userId`, `orgId`, `roles`, `sessionId`. Every handler checks `if (!ctx["domainId"])` and returns 400 immediately.

**Fix**:
1. Remove the `domainId` check from auth context in `publishing.ts:33,45,63`.
2. Accept `domainId` as a validated Zod query/body parameter:
   ```typescript
   const QuerySchema = z.object({ domainId: z.string().uuid() }).strict();
   const parsed = QuerySchema.safeParse(req.query);
   if (!parsed.success) return errors.badRequest(res, 'domainId required');
   const { domainId } = parsed.data;
   ```
3. Verify domain ownership via DB JOIN on `org_id = ctx["orgId"]` before use.

---

### P0-2: SQL syntax error in media ownership check

**File**: `control-plane/api/routes/media.ts:29`
**Root cause**: SQL string contains `m["id"] = $1` — JavaScript bracket notation inside a SQL string literal. PostgreSQL rejects this.

**Fix**: Change `m["id"] = $1` → `m.id = $1` in the SQL string.

---

### P0-3: Wrong table name in analytics ownership check

**File**: `control-plane/api/routes/analytics.ts:37`
**Root cause**: `FROM content c` — the table is named `content_items`, not `content`. Every `GET /analytics/content/:id` throws a PostgreSQL "relation does not exist" error.

**Fix**: Change `FROM content c` → `FROM content_items c`.

---

### P0-4: Search results never returned to client

**File**: `control-plane/api/routes/search.ts:49–58`
**Root cause**: `const _results = await svc.search(...)` — underscore prefix marks it unused. The response contains only `{ pagination: { totalPages } }`.

**Fix**:
1. Rename `_results` → `results`.
2. Include in the response: `return res.send({ results, pagination: { totalPages, total } })`.

---

### P0-5: `ContentItem.updateDraft()` silently ignores title and body

**File**: `domains/content/domain/entities/ContentItem.ts:129–145`
**Root cause**: Parameters are `_title` and `_body` (unused). Only `updatedAt` is written into the updates object. Every `PATCH /content/:id` call saves no content changes.

**Fix**:
```typescript
updateDraft(title: string, body: string): ContentItem {
  const updates: Partial<ContentItemProps> = {
    title,
    body,
    updatedAt: new Date(),
  };
  // ... rest unchanged
}
```

---

### P0-6: `PublishingService.publish()` — repository save outside transaction

**File**: `domains/publishing/application/PublishingService.ts:76–156`
**Root cause**: The service opens a transaction but calls `this.jobs.save(job)` after `COMMIT`, outside the transaction boundary. Two concurrent publishes for the same target can create duplicate jobs.

**Fix**:
1. Move `this.jobs.save(job)` to before `await client.query('COMMIT')`.
2. Pass `client` to `this.jobs.save(job, client)` so the repository uses the same connection.
3. Add optional `client?: PoolClient` to `PublishingJobRepository.save()` interface and implementation.

---

### P0-7: `PublishingService.publish()` — raw SQL bypasses repository abstraction

**File**: `domains/publishing/application/PublishingService.ts:98–106`
**Root cause**: Target lookup uses direct `client.query()` instead of `PublishTargetRepository`. The partial object mapping (`{ id, domainId }`) is missing `type`, `config`, and `enabled` fields.

**Fix**:
1. Add `client?: PoolClient` parameter to `PublishTargetRepository.getById()` interface.
2. Update `PostgresPublishTargetRepository.getById()` to accept and use the client.
3. Replace the inline query in `PublishingService.publish()` with `await this.targets.getById(targetId, client, { forUpdate: true })`.

---

### P0-8: `PublishingWorker.process()` — broken transaction state machine

**File**: `domains/publishing/application/PublishingWorker.ts:68–206`
**Root cause**: Opens first transaction, commits it, then opens a second transaction inside a catch block. The outer `ROLLBACK` fires against the already-committed first transaction, producing a "there is no transaction in progress" error and leaving state inconsistent.

**Fix**:
1. Redesign as a single transaction with explicit savepoints:
   ```sql
   BEGIN;
   SAVEPOINT before_external_publish;
   -- try external publish
   -- on failure: ROLLBACK TO SAVEPOINT before_external_publish;
   COMMIT;
   ```
2. Alternatively, split into two separate, independent operations — one to mark "in progress" (with immediate commit) and one to record the final result — making each idempotent.

---

### P0-9: `PublishingJobRepository.listByDomain()` references non-existent column

**File**: `domains/publishing/infra/persistence/PostgresPublishingJobRepository.ts:228`
**Root cause**: `ORDER BY created_at DESC` — `publishing_jobs` has no `created_at` column. The correct column name is in the migration file.

**Fix**:
1. Check migration: `migrations/*_dom_publishing_init.up.sql` for the actual timestamp column name.
2. Update the `ORDER BY` clause to use the correct column (likely `started_at` or `queued_at`).

---

### P0-10: `PublishingJob.retry()` resets `attemptCount` to 0

**File**: `domains/publishing/domain/entities/PublishingJob.ts:134–145`
**Root cause**:
```typescript
retry(): PublishingJob {
  return new PublishingJob({ ...this.state, status: 'pending', attemptCount: 0 });
}
```
After failure, `attemptCount` resets to 0. Max-retry enforcement is permanently broken.

**Fix**: Preserve the existing count:
```typescript
retry(): PublishingJob {
  return new PublishingJob({ ...this.state, status: 'pending' });
  // Do NOT override attemptCount
}
```

---

## P1 — High Severity

These are security issues, missing error handling, and design flaws that should be fixed in the next iteration.

---

### P1-1: `FacebookAdapter` makes outbound HTTP without SSRF validation

**File**: `control-plane/adapters/facebook/FacebookAdapter.ts:62–73`
**Root cause**: `fetch(`${this.baseUrl}/${pageId}/feed`, ...)` with no URL validation. If `baseUrl` is sourced from user config, this is a direct SSRF vector.

**Fix**: Before every outbound request:
```typescript
import { validateUrlWithDns } from '@security/ssrf';
const urlCheck = await validateUrlWithDns(targetUrl);
if (!urlCheck.allowed) throw new ForbiddenError('URL not permitted');
```
Apply the same pattern to LinkedIn, TikTok, Instagram, WordPress, Vimeo, and YouTube adapters.

---

### P1-2: Bare `req.auth as AuthContext` cast without type guard

**Files**: `control-plane/api/routes/seo.ts:43`, `search.ts:26`, `roi-risk.ts:22`
**Root cause**: TypeScript cast that passes if `req.auth` is undefined at runtime.

**Fix**: Replace with the canonical helper already defined in `control-plane/api/types.ts`:
```typescript
const ctx = getAuthContext(req); // throws AuthError if missing
```

---

### P1-3: Route params used without Zod validation

**File**: `control-plane/api/routes/roi-risk.ts:29`
**Root cause**: `const { assetId } = req.params as { assetId: string }` — unsafe cast that can pass undefined into ownership queries.

**Fix**:
```typescript
const AssetParams = z.object({ assetId: z.string().uuid() }).strict();
const p = AssetParams.safeParse(req.params);
if (!p.success) return errors.badRequest(res, 'Invalid asset ID');
const { assetId } = p.data;
```

---

### P1-4: Rate limiting uses global shared keys (per-endpoint, not per-user)

**Files**: `publishing.ts`, `search.ts`, `seo.ts`, `roi-risk.ts`, `diligence.ts`
**Root cause**: `rateLimit('publishing', N)` builds key `ratelimit:global:publishing`. One user can exhaust the limit for everyone.

**Fix**: Scope by user or IP. For authenticated routes:
```typescript
await rateLimit(ctx["userId"] ?? getClientIp(req), limit, req, res);
```
For unauthenticated routes: use `getClientIp(req)` from `@kernel/ip-utils`.

---

### P1-5: Publishing routes missing try/catch

**File**: `control-plane/api/routes/publishing.ts:27–68`
**Root cause**: `GET /publishing/targets`, `POST /publishing/targets`, and `GET /publishing/jobs` have no error handling. Any exception leaks a stack trace.

**Fix**: Wrap each handler:
```typescript
try {
  // handler body
} catch (error) {
  logger.error('[publishing] Handler error', error instanceof Error ? error : new Error(String(error)));
  return errors.internal(res);
}
```

---

### P1-6: Analytics route missing try/catch

**File**: `control-plane/api/routes/analytics.ts:21–45`
**Root cause**: Same as P1-5. Any DB error propagates uncaught.

**Fix**: Wrap the handler body in try/catch with `errors.internal(res)` fallback.

---

### P1-7: `ContentRepository` port/implementation type mismatch

**File**: `domains/content/application/ports/ContentRepository.ts:49–56`
**Root cause**: Interface declares `listByStatus(...): Promise<(ContentItem | null)[]>` but implementation returns `ContentItem[]`. False contract.

**Fix**: Update the interface:
```typescript
listByStatus(status: ContentStatus, domainId: string, limit: number, offset: number): Promise<ContentItem[]>;
```

---

### P1-8: `PublishTargetRepository` port lacks transaction support

**File**: `domains/publishing/application/ports/PublishTargetRepository.ts:12–51`
**Root cause**: All four methods lack `client?: PoolClient` parameter, preventing atomic multi-repository operations.

**Fix**: Add `client?: PoolClient` to all four method signatures and update `PostgresPublishTargetRepository` to accept and use the client on each query.

---

### P1-9: `refreshToken()` silently ignores `expiresIn` parameter

**File**: `control-plane/services/jwt.ts:568`
**Root cause**: Parameter named `_expiresIn` (unused). Callers who pass a custom expiry are silently ignored, all tokens get the hardcoded default.

**Fix**: Remove the underscore prefix and thread the value through to `signToken()`:
```typescript
export function refreshToken(token: string, expiresIn?: string): string {
  // ...
  return signToken({ sub, role, orgId, expiresIn, ... });
}
```

---

### P1-10: `NotificationDLQRepository.record()` missing `orgId`

**File**: `domains/notifications/infra/persistence/PostgresNotificationDLQRepository.ts:22–47`
**Root cause**: `record()` stores only `notification_id`, relying on a JOIN to filter by org. If the notification is deleted, the DLQ entry becomes orphaned and inaccessible. Cross-org leakage is structurally possible.

**Fix**:
1. Add migration to add `org_id` column to `notification_dlq` table.
2. Update `record()` signature: `record(orgId: string, notificationId: string, channel: string, reason: string)`.
3. Store `org_id` directly in the insert.
4. Update `list()` to filter on `d.org_id = $1` without the JOIN.

---

### P1-11: `PostgresNotificationRepository` — payload type assertion without validation

**File**: `domains/notifications/infra/persistence/PostgresNotificationRepository.ts:82–84`
**Root cause**: Database rows cast to `NotificationPayload` with no runtime validation. Malformed DB data can pass through silently.

**Fix**: Apply `validateNotificationPayload()` (already imported but unused during retrieval) to all payloads read from DB:
```typescript
const payload = validateNotificationPayload(r.payload);
```

---

### P1-12: `container.ts` uses `require()` in ESM codebase

**File**: `control-plane/services/container.ts:234–235`
**Root cause**: `require()` used with `eslint-disable` comment in an ESM-only codebase.

**Fix**: Use dynamic `import()`:
```typescript
const { PostgresIndexingJobRepository } = await import(
  '../../domains/search/infra/persistence/PostgresIndexingJobRepository.js'
);
```
Note: dynamic import is async — the container getter must be `async`.

---

### P1-13: Fire-and-forget container disposal

**File**: `control-plane/services/container.ts:379`
**Root cause**: `void globalContainer.dispose()` — if `dispose()` rejects, the error is swallowed. Violates `no-floating-promises`.

**Fix**:
```typescript
await globalContainer.dispose().catch((err: unknown) => {
  logger.warn('Error disposing previous container', err instanceof Error ? err : new Error(String(err)));
});
```

---

### P1-14: `billing.ts` — idempotency record set after transaction commit

**File**: `control-plane/services/billing.ts:209–210`
**Root cause**: `COMMIT` at line 209 succeeds, then `setIdempotencyStatus()` (Redis) at line 210 can fail. Future retries re-execute the billing operation.

**Fix**: Move idempotency status to a DB table written inside the transaction, before `COMMIT`. Redis can be used as a read-through cache but must not be the source of truth for idempotency.

---

## P2 — Medium Severity

Convention violations and logic issues that degrade maintainability and correctness.

---

### P2-1: `POST /content` — auth checked before rate limit

**File**: `control-plane/api/routes/content.ts:196–199`
**Root cause**: Write operations (`POST`, `PATCH`, `DELETE`, `POST /:id/publish`) run `getAuthContext()` before `rateLimit()`. The fix applied to `GET /content` (comment "P1-11 FIX") was not extended to write handlers.

**Fix**: Move `await rateLimit(...)` to before `getAuthContext(req)` for all write operations in `content.ts`.

---

### P2-2: `content.ts` — Zod `.parse()` + unsafe cast instead of `.safeParse()`

**File**: `control-plane/api/routes/content.ts:214–221, 261–268, 305–325, 370–377`
**Root cause**: `catch (validationError) { const zodError = validationError as { issues?: Array<...> } }` — unsafe cast on thrown Zod error.

**Fix**: Replace every `.parse()` + catch with `.safeParse()` + `if (!result.success)` pattern, already used in adjacent handlers.

---

### P2-3: Pagination responses missing `total` count

**Files**: `control-plane/api/routes/content.ts:184–187`, `notifications.ts:112–114`
**Root cause**: Responses return `totalPages` but not `total`. Clients cannot determine item count.

**Fix**: Add `total` to all pagination responses:
```typescript
return res.send({ items, pagination: { total, totalPages: Math.ceil(total / limit), page, limit } });
```

---

### P2-4: `roi-risk.ts` returns hardcoded fabricated data

**File**: `control-plane/api/routes/roi-risk.ts:100–108`
**Root cause**: When risk factors are empty, response contains three fake hardcoded entries masquerading as real analytics.

**Fix**: Return empty arrays. Let the frontend handle the empty state with appropriate messaging.

---

### P2-5: `PATCH /content/:id` — double DB fetch for same record

**File**: `control-plane/api/routes/content.ts:330–343`
**Root cause**: Route fetches the item for ownership check, then `UpdateDraft.execute()` fetches it again.

**Fix**: Thread the already-fetched `item` into the handler to avoid the second round-trip:
```typescript
const result = await handler.execute({ ...validated, existingItem: item });
```

---

### P2-6: `seo.ts` rate limit uses wrong namespace

**File**: `control-plane/api/routes/seo.ts:48`
**Root cause**: `rateLimit('content', 50)` — SEO requests count against the content bucket.

**Fix**: `rateLimit('seo', 50, req, res)`.

---

### P2-7: `PublishingWorker` — no distributed lock on job processing

**File**: `domains/publishing/application/PublishingWorker.ts:68`
**Root cause**: Two workers can process the same job simultaneously. DB lock prevents duplicate writes but two external API calls can still be made.

**Fix**: Acquire a Redis distributed lock before processing:
```typescript
import { acquireLock } from '@kernel/redlock';
const lock = await acquireLock(`job-lock:${jobId}`, 30_000);
try { /* process */ } finally { await lock.release(); }
```

---

### P2-8: Hardcoded empty `correlationId` in domain events

**Files**: `domains/content/domain/events/ContentScheduled.ts`, `domains/publishing/domain/events/PublishingStarted.ts`
**Root cause**: `correlationId: ''` always. Distributed traces cannot be correlated.

**Fix**: Thread the request-scoped correlation ID through command handlers:
```typescript
// In handler
const correlationId = requestContext.get('correlationId') ?? randomUUID();
// In event factory
meta: { correlationId, domainId: 'content', source: 'domain' }
```

---

### P2-9: `PublishingWorker` transactions missing `statement_timeout`

**File**: `domains/publishing/application/PublishingWorker.ts:96`
**Root cause**: Opens `BEGIN` without `SET LOCAL statement_timeout`. Long queries block connection pool slots.

**Fix**: After every `BEGIN`:
```typescript
await client.query('SET LOCAL statement_timeout = $1', [30_000]);
```
Or use the `withTransaction` helper from `@database` which sets this automatically.

---

### P2-10: Duplicate validation block in `PublishingWorker.validateInputs()`

**File**: `domains/publishing/application/PublishingWorker.ts:211–220`
**Root cause**: The `jobId` null/type check is written twice. The second copy is dead code.

**Fix**: Delete the duplicate block.

---

### P2-11: Unused `_logger` declarations in domain handlers

**Files**: `domains/content/application/handlers/PublishContent.ts:7`, `ScheduleContent.ts:7`, `UpdateDraft.ts:6`
**Root cause**: `const _logger = getLogger('...')` — declared but never used.

**Fix**: Either remove the declaration or use it to log operation start/end/failure.

---

### P2-12: `NotificationService` — channel not normalized before storage

**File**: `domains/notifications/application/NotificationService.ts:163–164,103`
**Root cause**: Validation lowercases `channel` for the whitelist check, but the original (un-normalized) value is passed to `Notification.create()`. DB queries expecting lowercase will miss entries stored as "EMAIL".

**Fix**:
```typescript
const normalizedChannel = channel.toLowerCase();
if (!NotificationService.ALLOWED_CHANNELS.includes(normalizedChannel)) { ... }
// use normalizedChannel everywhere below
```

---

### P2-13: `NotificationService` — missing structured logger

**File**: `domains/notifications/application/NotificationService.ts`
**Root cause**: No logger import or usage. Errors are swallowed without logging. Per CLAUDE.md: never use `console.log`.

**Fix**: Add at top of file:
```typescript
import { getLogger } from '@kernel/logger';
const logger = getLogger('notification:service');
```
Then log all errors and significant operations.

---

### P2-14: `ContentRevision.ts` — no input validation in factory methods

**File**: `domains/content/domain/entities/ContentRevision.ts:22–42`
**Root cause**: `create()` and `reconstitute()` accept parameters without any validation, unlike `PublishingJob` which validates all inputs.

**Fix**: Add validation consistent with other entities:
```typescript
if (!id || id.length < 3) throw new Error('Revision ID must be at least 3 characters');
if (!contentId) throw new Error('contentId required');
if (!(createdAt instanceof Date) || isNaN(createdAt.getTime())) throw new Error('Invalid date');
```

---

### P2-15: `PostgresNotificationRepository` — missing query timeouts

**File**: `domains/notifications/infra/persistence/PostgresNotificationRepository.ts:61–273`
**Root cause**: Direct queries (not going through `withTransaction`) have no timeout. Long queries can block connection pool slots indefinitely.

**Fix**: Use the `withTransaction` helper for all write operations, or add `SET LOCAL statement_timeout` at the start of each method that acquires its own client.

---

### P2-16: `audit.ts` — bracket notation on logger methods

**Files**: `packages/security/audit.ts:195,334,350,560`
**Root cause**: `this.logger["error"](...)` bypasses TypeScript type checking on the method signature.

**Fix**: Replace with dot notation throughout: `this.logger.error(...)`.

---

### P2-17: `errors/index.ts` — HTTP 402 for quota exceeded

**File**: `packages/errors/index.ts:540`
**Root cause**: `QUOTA_EXCEEDED` maps to HTTP 402 (Payment Required). Semantically incorrect — 429 (Too Many Requests) or 403 (Forbidden) is more appropriate for quota limits.

**Fix**: Change the status code mapping to 429 and update error documentation.

---

### P2-18: `billing.ts` — pool client not null-checked before release

**File**: `control-plane/services/billing.ts:170–227`
**Root cause**: If `await this.pool.connect()` throws, `client` is undefined, but `finally { client.release() }` throws a secondary error, masking the original.

**Fix**:
```typescript
let client: PoolClient | undefined;
try {
  client = await this.pool.connect();
  // ...
} finally {
  client?.release();
}
```

---

## P3 — Low Severity / Code Quality

---

### P3-1: Missing `.strict()` on Zod request schemas

**Files**: `content.ts:26,38`, `publishing.ts:15`, `billing.ts:22`, `analytics.ts:17`, `affiliates.ts:16`
**Fix**: Add `.strict()` to each Zod object schema to reject undeclared extra properties per CLAUDE.md.

---

### P3-2: `cache.ts` middleware uses `Promise<any>`

**File**: `control-plane/api/middleware/cache.ts:78–79`
**Fix**: Change `Promise<any>` → `Promise<unknown>`.

---

### P3-3: `console.log` / `console.error` in production source files

**Files**: `domains/search/application/SearchIndexingService.ts`, `control-plane/api/routes/queues.ts`, `control-plane/api/routes/queue-metrics.ts`, `apps/api/src/db.ts`, `apps/api/src/middleware/csrf.ts`, `packages/kernel/redlock.ts`, `packages/security/keyRotation.ts`
**Fix**: Replace all `console.*` calls with `getLogger('...').info/warn/error()`.

---

### P3-4: `PublishingJob.ts` — inconsistent bracket notation for `state` access

**File**: `domains/publishing/domain/entities/PublishingJob.ts:80–88`
**Root cause**: Getters mix dot notation and bracket notation for `this.state` properties.
**Fix**: Consistently use bracket notation: `this.state["domainId"]`, `this.state["contentId"]`, etc.

---

### P3-5: `ContentItem.ts` — inconsistent bracket notation for `props` access

**File**: `domains/content/domain/entities/ContentItem.ts:45–53`
**Root cause**: `this._domainId = props.domainId` (dot) vs. `this._title = props["title"]` (bracket) on adjacent lines.
**Fix**: Use bracket notation for all `props` accesses in the constructor.

---

### P3-6: `rate-limit.ts` — missing guard on empty `identifier`

**File**: `control-plane/services/rate-limit.ts:67–71`
**Root cause**: An empty string identifier creates key `ratelimit:global:`, which could collide across namespaces.
**Fix**:
```typescript
if (!identifier?.trim()) throw new Error('Rate limit identifier cannot be empty');
```

---

### P3-7: Catch parameters lack `unknown` type annotation

**Files**: `billing.ts:144`, `container.ts:358`, and multiple service files
**Root cause**: Catch clauses typed without `: unknown`, violating CLAUDE.md convention.
**Fix**: Add `: unknown` to all catch parameters; use `getErrorMessage(err)` for message extraction.

---

### P3-8: `containsBigInt()` has no circular reference protection

**File**: `control-plane/api/http.ts:356`
**Root cause**: No visited-objects tracking; a circular reference object would recurse until stack overflow.
**Fix**:
```typescript
function containsBigInt(obj: unknown, depth = 0, visited = new WeakSet()): boolean {
  if (depth > 20 || typeof obj !== 'object' || obj === null) return typeof obj === 'bigint';
  if (visited.has(obj as object)) return false;
  visited.add(obj as object);
  return Object.values(obj as object).some(v => containsBigInt(v, depth + 1, visited));
}
```

---

### P3-9: `retry.ts` — `retryHistory` map has concurrent write/cleanup race

**File**: `packages/kernel/retry.ts:140–165`
**Root cause**: `trackRetryAttempt()` and `cleanupOldHistoryEntries()` can execute concurrently, causing entries to be lost or double-counted.
**Fix**: Serialise access to `retryHistory` with a simple async mutex or use a single-threaded cleanup cycle.

---

### P3-10: `jwt.ts` — module-level mutable `currentKeys` not thread-safe

**File**: `packages/security/jwt.ts:242`
**Root cause**: `currentKeys` array is reassigned by `reloadKeys()` without synchronisation. A reader iterating the array while a writer replaces it can see a mix of old and new keys.
**Fix**: Reassign the reference atomically (JS is single-threaded in V8, so a simple reference swap is safe) but add a comment clarifying the assumption. Ensure `reloadKeys()` constructs the full new array before assigning.

---

### P3-11: `PostgresNotificationAttemptRepository` — error cast without type guard

**File**: `domains/notifications/infra/persistence/PostgresNotificationAttemptRepository.ts:46,87,112`
**Root cause**: `logger.error('msg', err as Error)` — cast without guard.
**Fix**:
```typescript
const safeErr = err instanceof Error ? err : new Error(String(err));
logger.error('msg', safeErr);
```

---

### P3-12: `batchSave()` has asymmetric error handling (with vs. without client)

**File**: `domains/notifications/infra/persistence/PostgresNotificationPreferenceRepository.ts:196–243`
**Root cause**: When caller provides `client`, errors are not caught by the repo. When repo owns the client, errors trigger ROLLBACK. This asymmetry is undocumented.
**Fix**: Add JSDoc to `batchSave()` explicitly documenting that callers are responsible for transaction management when providing a `client` parameter.

---

## Execution Order

The following order minimises merge conflicts and ensures each tier builds on stable code from the previous tier.

### Phase 1 — P0 fixes (domain correctness, broken routes)
1. Fix `ContentItem.updateDraft()` parameter shadowing (**P0-5**)
2. Fix `PublishingJob.retry()` attemptCount reset (**P0-10**)
3. Add `client` parameter to `PublishTargetRepository` and `PostgresPublishTargetRepository` (**P0-7, P1-8**)
4. Migrate `PublishingService.publish()` to use repository + move save inside transaction (**P0-6, P0-7**)
5. Fix `PublishingWorker.process()` transaction state machine (**P0-8**)
6. Fix `listByDomain()` ORDER BY column (**P0-9**)
7. Fix `publishing.ts` domainId source — move to Zod query param (**P0-1**)
8. Fix SQL syntax error in `media.ts` (**P0-2**)
9. Fix table name in `analytics.ts` (**P0-3**)
10. Fix search results variable (**P0-4**)

### Phase 2 — P1 security and high-severity fixes
11. Add SSRF validation to all outbound adapters (**P1-1**)
12. Replace bare `req.auth` casts with `getAuthContext()` (**P1-2**)
13. Add Zod validation to `roi-risk.ts` params (**P1-3**)
14. Scope rate limits by user/IP (**P1-4**)
15. Add try/catch to publishing and analytics routes (**P1-5, P1-6**)
16. Fix `ContentRepository` interface type (**P1-7**)
17. Fix `refreshToken` parameter shadowing (**P1-9**)
18. Add `org_id` column to notification DLQ + migration (**P1-10**)
19. Apply `validateNotificationPayload()` on DB reads (**P1-11**)
20. Replace `require()` with dynamic `import()` in container (**P1-12**)
21. Await container disposal (**P1-13**)
22. Move billing idempotency record into transaction (**P1-14**)

### Phase 3 — P2 improvements
23. Move rate limit before auth on `POST /content` (**P2-1**)
24. Replace `.parse()` + cast with `.safeParse()` in `content.ts` (**P2-2**)
25. Add `total` to pagination responses (**P2-3**)
26. Remove hardcoded fake data from `roi-risk.ts` (**P2-4**)
27. Thread `item` into `UpdateDraft` handler (**P2-5**)
28. Fix SEO rate limit namespace (**P2-6**)
29. Add distributed lock to `PublishingWorker` (**P2-7**)
30. Thread `correlationId` into domain events (**P2-8**)
31. Add `statement_timeout` to publishing worker transactions (**P2-9**)
32. Remove duplicate validation block (**P2-10**)
33. Remove or use `_logger` declarations (**P2-11**)
34. Normalise channel before `Notification.create()` (**P2-12**)
35. Add logger to `NotificationService` (**P2-13**)
36. Add input validation to `ContentRevision` factory (**P2-14**)
37. Add query timeouts to notification repository methods (**P2-15**)
38. Fix bracket notation on logger calls in `audit.ts` (**P2-16**)
39. Fix QUOTA_EXCEEDED status code (**P2-17**)
40. Null-check pool client before release in `billing.ts` (**P2-18**)

### Phase 4 — P3 cleanup
41. Add `.strict()` to Zod schemas (**P3-1**)
42. Fix `Promise<any>` in `cache.ts` (**P3-2**)
43. Replace all `console.*` with structured logger (**P3-3**)
44. Standardise bracket notation across entity files (**P3-4, P3-5**)
45. Add empty identifier guard to `rate-limit.ts` (**P3-6**)
46. Add `: unknown` to all catch parameters (**P3-7**)
47. Add circular reference protection to `containsBigInt` (**P3-8**)
48. Serialise `retryHistory` access (**P3-9**)
49. Document `currentKeys` thread-safety assumption (**P3-10**)
50. Fix error cast in notification attempt repository (**P3-11**)
51. Document `batchSave()` client ownership semantics (**P3-12**)

---

## Migration Required

The following database migration must accompany Phase 2 fixes:

```sql
-- Add org_id to notification_dlq to eliminate cross-org join
ALTER TABLE notification_dlq ADD COLUMN org_id TEXT NOT NULL DEFAULT '';
UPDATE notification_dlq d SET org_id = n.org_id FROM notifications n WHERE d.notification_id = n.id;
ALTER TABLE notification_dlq ALTER COLUMN org_id SET NOT NULL;
CREATE INDEX idx_notification_dlq_org_id ON notification_dlq(org_id);
```

A corresponding `.down.sql` must also be created:
```sql
DROP INDEX IF EXISTS idx_notification_dlq_org_id;
ALTER TABLE notification_dlq DROP COLUMN org_id;
```

---

## Metrics to Verify After Each Phase

| Check | Command |
|-------|---------|
| TypeScript compiles clean | `npm run type-check` |
| ESLint passes | `npm run lint` |
| Security lint passes | `npm run lint:security` |
| Unit tests pass | `npm run test:unit` |
| Integration tests pass | `npm run test:integration` |
| Migration applies + rolls back | `npm run migrate && npm run migrate:rollback` |
