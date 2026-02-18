# Security & Code Quality Audit — Files Starting with `o`

**Date:** 2026-02-18
**Branch:** claude/security-audit-typescript-postgres-rauRZ
**Methodology:** Hostile financial-grade review — Phase 1 systematic + Phase 2 adversarial re-review
**Agents used:** 5 parallel audit agents + 2 adversarial cross-verification agents

## Files Audited

| File | Lines |
|------|-------|
| `apps/api/src/adapters/images/OpenAIImageAdapter.ts` | 514 |
| `apps/web/components/OptinEmbedSnippet.tsx` | 41 |
| `apps/web/pages/intents/[id]/objections.tsx` | 12 |
| `control-plane/api/openapi.ts` | 9 |
| `control-plane/api/routes/onboarding.ts` | — |
| `control-plane/api/routes/orgs.ts` | 182 |
| `control-plane/services/onboarding.test.ts` | — |
| `control-plane/services/onboarding.ts` | 153 |
| `control-plane/services/org-service.ts` | 39 |
| `docs/openapi.json` | — |
| `packages/database/outbox.ts` | 71 |
| `packages/kernel/outbox/OutboxRelay.ts` | 202 |
| `test/factories/organization.ts` | 85 |

---

## P0 — CRITICAL: Production Outage / Data Loss / Security Breach Imminent

---

### P0-1 — `control-plane/services/onboarding.ts:5,11–14,67,84`
**Category: SQL**

**Violation:** The service hardcodes column names `'profile'`, `'billing'`, `'team'` inside `STEP_COLUMNS`, the `mark()` UPSERT, the `get()` SELECT list, and `OnboardingState`. The actual database migration (`20260210001800_cp_onboarding.up.sql`) defines columns named `step_create_domain`, `step_create_content`, `step_publish_content`. Every call to `mark()`, `get()`, `getProgress()`, and `isCompleted()` throws `column "profile" of relation "org_onboarding" does not exist` at runtime. Additionally `get()` SELECTs `created_at` which does not exist in the migration schema.

**Fix:**
```typescript
// Change:
const VALID_STEPS = ['profile', 'billing', 'team'] as const;
const STEP_COLUMNS: Record<OnboardingStep, string> = {
  profile: 'profile', billing: 'billing', team: 'team',
};
// To (matching migration columns):
const VALID_STEPS = ['step_create_domain', 'step_create_content', 'step_publish_content'] as const;
const STEP_COLUMNS: Record<OnboardingStep, string> = {
  step_create_domain: 'step_create_domain',
  step_create_content: 'step_create_content',
  step_publish_content: 'step_publish_content',
};
// And update the SELECT list in get() to match actual columns.
```

**Risk:** Entire onboarding subsystem is non-functional. Every new user signup crashes. **Blast radius: 100% of new user onboarding.**

---

### P0-2 — `packages/kernel/outbox/OutboxRelay.ts:137–153`
**Category: DataIntegrity / Async**

**Violation:** When `eventBus.publish(envelope)` succeeds (side effects are live: emails sent, webhooks delivered, billing incremented) and then `enqueueEvent(envelope)` throws (Redis transient), the entire event is caught and added to `failedUpdates`, incrementing `retry_count`. On the next poll cycle, `eventBus.publish` fires again for the same event — all in-process handlers execute a second time. There is no deduplication in `EventBus`.

```typescript
try {
  await this.eventBus.publish(envelope);  // SUCCEEDS — side effects are live
  if (this.publishToQueue) {
    await enqueueEvent(envelope);          // THROWS — Redis transient
  }
  publishedIds.push(row.id);              // Never reached
} catch (err) {
  failedUpdates.push({ id: row.id, ... }); // → retry → double delivery
}
```

**Fix:** Use two independent try/catch blocks. If `eventBus.publish` succeeds, add the row to `publishedIds` regardless of `enqueueEvent` outcome:

```typescript
let publishedInProcess = false;
try {
  await this.eventBus.publish(envelope);
  publishedInProcess = true;
} catch (err) {
  failedUpdates.push({ id: row.id, error: getErrorMessage(err) });
  continue;
}
if (this.publishToQueue) {
  try { await enqueueEvent(envelope); }
  catch (err) { logger.error('BullMQ enqueue failed', err); } // log but don't retry
}
if (publishedInProcess) publishedIds.push(row.id);
```

**Risk:** Any Redis transient causes double billing, double webhook, double analytics for every event in the batch. **Blast radius: all events during Redis blips.**

---

### P0-3 — `packages/kernel/outbox/OutboxRelay.ts:85–92`
**Category: Async / Resource**

**Violation:** `stop()` sets `this.running = false` and cancels the pending timer, then returns immediately. An in-flight `poll()` continues executing — holding a pool connection through `eventBus.publish` (which may have a multi-second handler timeout). On Kubernetes SIGTERM, the process believes shutdown is complete and destroys the pool. The in-flight `poll()` then calls `client.release()` against a destroyed pool.

**Fix:**
```typescript
private pollPromise: Promise<void> | undefined;

private async poll(): Promise<void> {
  this.pollPromise = this._doPoll();
  await this.pollPromise;
}

async stop(): Promise<void> {
  this.running = false;
  if (this.pollTimer) { clearTimeout(this.pollTimer); this.pollTimer = undefined; }
  if (this.pollPromise) await this.pollPromise; // drain in-flight cycle
  logger.info('Outbox relay stopped');
}
```

**Risk:** Every Kubernetes rolling deployment leaves dangling DB connections and potentially uncommitted transactions. **Blast radius: all rolling deployments.**

---

### P0-4 — `control-plane/api/routes/orgs.ts:97,127,163`
**Category: Security / IDOR**

**Violation:** Authorization for `GET /orgs/:id/members`, `POST /orgs/:id/invite`, and `POST /orgs/:id/members` is a JWT string comparison only:

```typescript
if (ctx["orgId"] !== id) { return errors.notFound(res, 'Organization'); }
```

No database membership query is ever performed. Consequences: (1) removed members retain access until token expiry; (2) if a JWT signing bug sets the wrong `orgId` claim, no DB check catches it; (3) users with multiple org memberships can probe other orgs by modifying the `:id` parameter if their JWT `orgId` happens to match.

**Fix:** Replace the string comparison with a DB membership query:
```typescript
const { rows } = await pool.query(
  `SELECT role FROM memberships
   WHERE user_id = $1 AND org_id = $2 AND status = 'active'`,
  [ctx.userId, id]
);
if (rows.length === 0) return errors.notFound(res, 'Organization');
```

**Risk:** Revoked members retain full org admin access until token expiry. **Blast radius: any org with member churn.**

---

### P0-5 — `control-plane/api/routes/orgs.ts:173` + `services/membership-service.ts`
**Category: Security / Privilege Escalation**

**Violation:** `POST /orgs/:id/members` accepts `userId` from the request body validated only as a UUID format string. There is no check that the target user exists in the `users` table. An authenticated org admin can add any known or guessed UUID as an org member.

**Fix:** Before calling `members.addMember()`, verify the target user exists and is not already a member:
```typescript
const { rows: userRows } = await pool.query(
  'SELECT id FROM users WHERE id = $1', [userId]
);
if (userRows.length === 0) return errors.badRequest(res, 'User not found');
```

**Risk:** Cross-org user injection. **Blast radius: all org membership data.**

---

### P0-6 — `apps/web/components/OptinEmbedSnippet.tsx:32`
**Category: Security / XSS**

**Violation:** The generated iframe embed code uses `sandbox='allow-scripts allow-same-origin allow-forms'`. Combining `allow-scripts` and `allow-same-origin` nullifies sandboxing: a script inside the iframe can call `frameElement.removeAttribute('sandbox')` and gain full access to the parent page DOM, cookies, and localStorage. This is documented in the HTML Living Standard. This snippet is given to customers to paste into their own sites — any CDN compromise becomes a parent-page takeover on every customer site.

**Fix:**
```tsx
// Remove allow-same-origin:
sandbox='allow-scripts allow-forms'
```

**Risk:** CDN or DNS compromise allows full XSS on every customer site using the embed. **Blast radius: all customers with embedded opt-in forms.**

---

### P0-7 — `apps/api/src/adapters/images/OpenAIImageAdapter.ts:179–181,296,390`
**Category: Security / Async**

**Violation:** `retryAfter` from the OpenAI `Retry-After` header is captured in `ApiError.retryAfter` but `withRetry` is called with only `{ maxRetries: 3 }`. The `withRetry` implementation uses hardcoded exponential backoff (1s, 2s, 4s), ignoring the server-specified delay. When OpenAI returns `Retry-After: 60`, the adapter retries after 1 second, violating the directive and risking API key suspension.

**Fix:**
```typescript
if (response.status === 429) {
  const retryAfterHeader = response.headers.get('retry-after');
  const delayMs = retryAfterHeader
    ? (parseInt(retryAfterHeader, 10) * 1000 || 60_000)
    : 60_000;
  throw new ApiError('Rate limited', 429, String(delayMs));
}
// In withRetry options, honor delayMs from ApiError.retryAfter.
```

**Risk:** Repeated retry violations → API key ban → all DALL-E usage offline. **Blast radius: all image generation.**

---

## P1 — HIGH: Likely Bugs Under Load, Security Vulnerabilities, Data Corruption

---

### P1-1 — `control-plane/services/onboarding.ts:81–110`
**Category: SQL / Async**

**Violation:** `get()` runs three sequential queries on separate pool connections with no wrapping transaction: `ensure()` (INSERT ON CONFLICT), SELECT, and conditionally UPDATE SET completed=true. Two concurrent `get()` calls can both read `completed=false`, compute completion, and both issue the final UPDATE. More critically, `get()` is a read method that performs a write — `isCompleted()` and `getProgress()` are secretly write operations.

**Fix:** Wrap all three operations in a single `withTransaction(REPEATABLE READ)` from `@database/transactions`. Move `completed=true` promotion into `mark()` via atomic UPSERT.

**Risk:** Race conditions produce inconsistent onboarding state; feature gates make wrong decisions under concurrent load.

---

### P1-2 — `control-plane/api/routes/onboarding.ts:53–55` (and orgs.ts equivalents)
**Category: Security**

**Violation:** Rate limiting is called after `requireRole()`. A valid-JWT caller with wrong role probes indefinitely — the rate limit counter is never incremented for role-rejected requests.

**Fix:** Swap order — rate limit before `requireRole`:
```typescript
await rateLimit(`onboarding:${ctx.userId}`, 50);
requireRole(ctx, ['owner', 'admin', 'editor']);
```

**Risk:** Unlimited probing of role-check behavior by any valid JWT holder.

---

### P1-3 — `control-plane/api/routes/onboarding.ts` and `orgs.ts` (all catch blocks)
**Category: Error Handling**

**Violation:** `rateLimit()` throws `new Error('Rate limit exceeded')` and `requireRole()` throws a role error. Both are caught by the generic `catch` block returning HTTP 500. Rate-limited clients receive 500 with no `Retry-After` header. Role failures return 500 instead of 403.

**Fix:**
```typescript
} catch (error) {
  if (isRateLimitError(error)) return errors.rateLimited(res, 60);
  if (isRoleError(error))      return errors.forbidden(res, 'Insufficient permissions');
  logger.error('[route] Error', error instanceof Error ? error : new Error(String(error)));
  return errors.internal(res, '...');
}
```

**Risk:** False 500 alert storms during normal rate-limiting events; clients retry immediately without backoff.

---

### P1-4 — `packages/kernel/outbox/OutboxRelay.ts:108–116`
**Category: SQL / Performance**

**Violation:** The query filters `WHERE published_at IS NULL AND retry_count < max_retries` but the partial index covers only `WHERE published_at IS NULL`. PostgreSQL applies `retry_count < max_retries` as a post-index filter. As permanently-failed events accumulate (where `retry_count >= max_retries`), every poll cycle scans them all.

**Fix:** Add a covering partial index to the migration:
```sql
CREATE INDEX idx_event_outbox_pending ON event_outbox (id ASC)
WHERE published_at IS NULL AND retry_count < max_retries;
```
Add a periodic cleanup job deleting rows where `published_at < NOW() - INTERVAL '7 days'`.

**Risk:** Silent performance cliff as dead events accumulate; relay degrades to full-table scan at 1-second intervals.

---

### P1-5 — `packages/database/outbox.ts:19–34`
**Category: DataIntegrity**

**Violation:** `writeToOutbox()` accepts a `PoolClient` with no check that a transaction is active. If called on an auto-commit connection, the INSERT commits immediately — before the caller's business transaction completes. A subsequent business rollback leaves a phantom event in the outbox that will be delivered (billing/webhook) with no corresponding committed state.

**Fix:**
```typescript
const { rows } = await client.query(
  `SELECT (pg_current_xact_id_if_assigned() IS NOT NULL) AS in_txn`
);
if (!rows[0]?.in_txn) {
  throw new Error('writeToOutbox must be called within an active transaction');
}
```

**Risk:** Phantom billing and webhook events for rolled-back orders. **Blast radius: any outbox write that accidentally runs outside a transaction.**

---

### P1-6 — `control-plane/services/membership-service.ts:9` + `org-service.ts:19`
**Category: Security / Architecture**

**Violation:** `VALID_ROLES` in `membership-service.ts` includes `'owner'`. The only guard against assigning `'owner'` via `addMember()` is the Zod schema in the route. Any future code path (admin job, script, test) calling `addMember()` directly can grant owner membership.

**Fix:** Add an explicit guard inside `addMember()`:
```typescript
if (role === 'owner') {
  throw new ForbiddenError('Owner role cannot be assigned via addMember', ErrorCodes.FORBIDDEN);
}
```

**Risk:** One future code path calling `addMember` without Zod validation elevates arbitrary users to org owner.

---

### P1-7 — `control-plane/services/org-service.ts:24–26`
**Category: Error Handling**

**Violation:** The catch block awaits `ROLLBACK` before re-throwing. If ROLLBACK itself throws (connection dropped), the original exception is replaced by the ROLLBACK error. The root cause of the transaction failure is permanently lost.

**Fix:**
```typescript
} catch (error) {
  try { await client.query('ROLLBACK'); }
  catch (rbErr) {
    logger.error('ROLLBACK failed', rbErr instanceof Error ? rbErr : new Error(String(rbErr)));
  }
  throw error; // always re-throw original
} finally {
  client.release();
}
```

**Risk:** Transaction failures misdiagnosed as connection errors; root cause invisible in logs.

---

### P1-8 — `apps/api/src/adapters/images/OpenAIImageAdapter.ts:184–185,300,394`
**Category: Security / Observability**

**Violation:** Raw OpenAI error body (`errorText`) is embedded in thrown exception messages, which flow into `this.logger.error()`. `StructuredLogger` writes `error.message` into log entries without invoking field-pattern redaction. If OpenAI echoes back any part of the request, the `OPENAI_API_KEY` or user prompt content could appear in structured logs.

**Fix:**
```typescript
const truncated = errorText.slice(0, 200);
this.logger.debug('OpenAI error body', context, { status: response.status, truncatedBody: truncated });
throw new ServiceUnavailableError(`OpenAI API error: ${response.status}`, ErrorCodes.EXTERNAL_SERVICE_ERROR);
```

**Risk:** API key in production log pipeline; prompt PII leakage; GDPR/CCPA liability.

---

### P1-9 — `packages/kernel/outbox/OutboxRelay.ts:165–173`
**Category: Performance / SQL**

**Violation:** N sequential `UPDATE event_outbox SET retry_count = retry_count + 1` queries inside the transaction — one per failed event — while `FOR UPDATE SKIP LOCKED` row locks are held. With 50 events all failing (Redis down), this is 50 round-trips × ~10ms each = 500ms of lock hold time per cycle, blocking all other relay instances.

**Fix:**
```sql
UPDATE event_outbox
SET retry_count = retry_count + 1, last_error = updates.err
FROM unnest($1::bigint[], $2::text[]) AS updates(id, err)
WHERE event_outbox.id = updates.id
```

**Risk:** Sustained downstream failure causes relay lock starvation across all instances.

---

### P1-10 — `apps/api/src/adapters/images/OpenAIImageAdapter.ts:124`
**Category: Security / Observability**

**Violation:** User-generated image prompts are stored in `GeneratedImage.metadata.prompt`. The `@kernel/redaction` engine does not list `'prompt'` in `SENSITIVE_FIELD_PATTERNS`. Any logging of returned `GeneratedImage` objects exposes prompts in plaintext logs.

**Fix:** Remove `prompt` from `metadata`, or add `'prompt'` to `SENSITIVE_FIELD_PATTERNS` in the redaction engine. Alternatively, store only a truncated SHA-256 fingerprint.

**Risk:** User PII in production logs; GDPR/CCPA data retention liability; prompts cannot be retroactively redacted from log pipelines.

---

## P2 — MEDIUM: Technical Debt, Maintainability, Performance Degradation

| # | File:Line | Category | Violation | Fix |
|---|-----------|----------|-----------|-----|
| P2-1 | `onboarding.ts:40,53,76` | Type | `orgId: string` throughout; `OrgId` branded type unused; runtime `typeof` checks are dead (TS already enforces) | Replace with `OrgId` from `@kernel/branded`; remove runtime `typeof` guards |
| P2-2 | `onboarding.ts:137` | Security | `reset()` is public with no auth context parameter — any caller can reset any org's onboarding | Add `(callerCtx: AuthContext, orgId: OrgId)` + `requireRole(callerCtx, ['owner'])` |
| P2-3 | `onboarding.ts:89,106` | DataIntegrity | `row.completed = true` mutates the raw `pg` result object in-memory; if the UPDATE fails silently, returned state is wrong | Use `RETURNING completed` from the UPDATE or re-read the row |
| P2-4 | `routes/orgs.ts:22,31,39,47` | Type | Zod schemas missing `.strict()` — extra properties pass through to downstream code | Add `.strict()` to all four schema definitions per CLAUDE.md convention |
| P2-5 | `org-service.ts:32` | SQL/Performance | `listMembers()` has no LIMIT/OFFSET — returns entire membership table for large orgs | Add mandatory `limit`/`cursor` params; return `{ data, nextCursor }` |
| P2-6 | `OutboxRelay.ts:35` | Type/DataIntegrity | `OutboxRow.meta` typed as hardcoded shape; runtime JSONB comes in as `unknown`; absent `correlationId` causes jobId `"<domainId>:undefined"` in BullMQ, deduplicating unrelated events | Validate `meta` with Zod after SELECT; move invalid-meta rows to `failedUpdates` |
| P2-7 | `OutboxRelay.ts:187` | Async/Performance | Outer `catch` logs and immediately calls `scheduleNext()` — DB outage → 1 connection attempt + 1 log line per second per relay instance | Add exponential backoff (capped at 60s) on consecutive outer poll errors |
| P2-8 | `onboarding.ts:3` / `routes/onboarding.ts:4` | Architecture | `Pool` imported directly from `'pg'`, bypassing `@database`'s backpressure semaphore and metrics | Use `withTransaction()` from `@database/transactions` |
| P2-9 | `OptinEmbedSnippet.tsx:16–17` | Security | `CDN_BASE_URL`/`FORMS_BASE_URL` can be `undefined` (both are `OPTIONAL_ENV_VARS`); template literal produces literal string `"undefined"` as hostname | Gate component on non-undefined `https://`-prefixed URLs; promote to required env vars |
| P2-10 | `OpenAIImageAdapter.ts:9` | Type | `import { AbortController } from 'abort-controller'` is a Node <16 polyfill; conflicts with native `AbortController` type in Node 18+ | Remove import; use `globalThis.AbortController` |
| P2-11 | `objections.tsx:7,9` | UI/Architecture | Submit button has no handler, textarea has no state, no form element, `[id]` route param never read — silent data loss for any user who submits | Implement state, handler, and API call; read `router.query.id`; add `<label>` |
| P2-12 | `organization.ts:42` | Testing | `max_users`/`max_domains` computed from `options.plan` before `'free'` default applied; coincidentally correct today but fragile | `const plan = options.plan ?? 'free'` before computing limits |
| P2-13 | `OpenAIImageAdapter.ts:415` | DataIntegrity | `createVariation()` stores `prompt: ''` in metadata — looks like empty-prompt policy violation in audit logs | Change `metadata.prompt` to `string \| undefined`; set `undefined` in `createVariation` |

---

## P3 — LOW: Code Quality, Nitpicks, Future Risk

| # | File:Line | Category | Issue |
|---|-----------|----------|-------|
| P3-1 | `onboarding.ts:53–62` | Architecture | `validateStep()` is redundant — step is already `OnboardingStep` from TypeScript; the SQL injection guard is the column map, not this check |
| P3-2 | `onboarding.ts:19` | Type | `OnboardingState.org_id: string` should be `OrgId`; breaks branded-type flow in callers |
| P3-3 | `routes/onboarding.ts:57,110` | Type | `ctx["orgId"]` uses bracket notation on an explicit interface property — should be `ctx.orgId` |
| P3-4 | `routes/orgs.ts:17` / `routes/onboarding.ts:20` | Architecture | `AuthenticatedRequest` type duplicated in both files; extract to `@types/auth` |
| P3-5 | `org-service.ts:8,32` | Type | `createOrg()` has no explicit return type; `listMembers()` returns `any[]` — violates `no-any` rule |
| P3-6 | `OutboxRelay.ts:64` | Architecture | `batchSize` and `pollIntervalMs` not validated in constructor; `batchSize: 0` causes a no-op spin loop |
| P3-7 | `outbox.ts:54–55` | Architecture | Five `paramIdx++` in one template literal — correct but fragile; no test coverage for `writeMultipleToOutbox` |
| P3-8 | `OutboxRelay.ts` (all) | Testing | Zero test coverage for the most critical data-integrity component in the codebase |
| P3-9 | `OpenAIImageAdapter.ts:73` | Type | `user` field in `ImageGenerationOptions` is never forwarded to OpenAI — silently opts out of per-user abuse detection |
| P3-10 | `OpenAIImageAdapter.ts:477` | Architecture | `calculateCost()` belongs in a `BillingCalculator` domain service, not inside an HTTP adapter (SRP violation) |
| P3-11 | `OptinEmbedSnippet.tsx:11–14` | Architecture | `sanitizeFormId()` is dead code after `isValidFormId()` passes — creates false impression of defense-in-depth |
| P3-12 | `organization.ts:22,69–70` | Testing | Three dead variables (`_timestamp` ×2, `_randomSuffix`) including unnecessary `crypto.randomBytes` calls in every `createMembership()` |
| P3-13 | `organization.ts:39–40` | Testing | `created_at` and `updated_at` can be identical timestamps (same tick) — causes flaky ordering-dependent tests |
| P3-14 | `OutboxRelay.ts:112` | SQL | `ORDER BY id ASC` on BIGSERIAL is not wall-clock FIFO — sequence gaps are non-transactional |

---

## Ranked Production Incident Risk

Issues that would cause an incident if deployed today, ranked by blast radius × probability:

| Rank | ID | Issue | Blast Radius |
|------|----|-------|-------------|
| **1** | P0-1 | Schema mismatch: `profile`/`billing`/`team` columns don't exist in DB | 100% of new user onboarding: constant 500 errors |
| **2** | P0-2 | Outbox: partial publish bug → double in-process delivery on Redis transients | All events during any Redis blip: billing/webhook duplicates |
| **3** | P0-3 | Outbox: `stop()` doesn't await `poll()` → pool leak on every k8s redeploy | Every rolling deployment: dangling connections, uncommitted txns |
| **4** | P0-6 | `allow-scripts`+`allow-same-origin` sandbox escape in embed snippet | All customers with embedded opt-in forms: XSS on CDN compromise |
| **5** | P0-7 | OpenAI Retry-After ignored → rate limit violations → key suspension | All DALL-E image generation offline |
| **6** | P0-4 | JWT-only IDOR: revoked members retain access until token expiry | All orgs with member churn |
| **7** | P1-3 | Rate limit / role errors return HTTP 500 → false alert storms | Alert fatigue; on-call paged for every rate-limited user |
| **8** | P1-4 | Outbox partial index missing `retry_count` → full scan over dead events | Long-running instances: relay poll degrades silently to full-table scan |
| **9** | P1-8 | Raw OpenAI error body logged → potential API key / prompt PII in logs | API key rotation required; GDPR liability |
| **10** | P0-5 | `addMember` accepts any UUID with no DB user existence check | Any org admin can inject arbitrary user IDs as members |

---

*Report generated by multi-agent hostile code review — 2026-02-18*
