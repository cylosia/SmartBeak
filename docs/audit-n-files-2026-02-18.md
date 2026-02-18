# Security & Quality Audit — SmartBeak `n*` Files
**Date:** 2026-02-18
**Auditor:** Claude (claude-sonnet-4-6), hostile-review mode
**Scope:** All 23 files whose filename begins with `n`:

```
control-plane/services/notification-admin.ts
control-plane/services/notifications-hook.ts
control-plane/api/routes/notifications.ts
control-plane/api/routes/notifications-admin.ts
domains/notifications/domain/notification.lifecycle.test.ts
domains/notifications/domain/notification.adapters.test.ts
domains/notifications/domain/events/NotificationSent.ts
domains/notifications/domain/events/NotificationFailed.ts
domains/notifications/domain/entities/NotificationAttempt.ts
domains/notifications/domain/entities/Notification.ts
domains/notifications/domain/entities/NotificationPreference.ts
domains/notifications/application/NotificationService.ts
domains/notifications/application/NotificationWorker.ts
domains/notifications/application/NotificationPreferenceService.ts
domains/notifications/application/ports/NotificationPreferenceRepository.ts
domains/notifications/application/ports/NotificationRepository.ts
packages/types/notifications.ts
apps/api/src/advisor/nextActions.ts
apps/web/pages/notifications.tsx
apps/web/pages/domains/[id]/content/new.tsx
apps/web/pages/domains/new.tsx
apps/web/pages/settings/notifications.tsx
apps/web/components/NextActionsAdvisor.tsx
```

Plus associated migration SQL and infra repositories cross-referenced for completeness.

---

## CRITICAL (P0) — Production Outage Imminent

### P0-1 · `PostgresNotificationRepository.ts:129,352` — `updated_at` column does not exist
**Category: SQL / Architecture**

`save()` and `executeBatchSave()` both reference `updated_at = now()` in their `ON CONFLICT DO UPDATE` clauses. The column is **absent from the migration**:

```sql
-- 20260210000700_dom_notifications_init.up.sql
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL, user_id TEXT NOT NULL,
  channel TEXT NOT NULL, template TEXT NOT NULL, payload JSONB NOT NULL,
  status TEXT NOT NULL, created_at TIMESTAMP DEFAULT now()
  -- NO updated_at
);
```

Every call to `save()` throws:
```
PostgreSQL: column "updated_at" of relation "notifications" does not exist
```

**Blast radius:** The entire notification delivery pipeline is dead. `NotificationWorker.process()` calls `save()` on every state transition (pending→sending, sending→delivered/failed). No notification can ever be persisted past initial creation.

**Fix:**
```sql
-- new migration
ALTER TABLE notifications ADD COLUMN updated_at TIMESTAMPTZ DEFAULT now();
```

---

### P0-2 · `NotificationWorker.ts:121-137,170-172` — `delivery_token` / `delivery_committed_at` columns do not exist
**Category: SQL / Architecture**

`process()` queries and updates two columns that are not in the migration:

```typescript
// line 121 — throws at runtime
const existingToken = await client.query(
  `SELECT delivery_token, delivery_committed_at FROM notifications WHERE id = $1`,
  [notification["id"]]
);
// line 134 — throws at runtime
await client.query(
  `UPDATE notifications SET delivery_token = $1 WHERE id = $2`,
  [deliveryToken, notification["id"]]
);
// line 170 — throws at runtime
await client.query(
  `UPDATE notifications SET delivery_committed_at = NOW() WHERE id = $1`,
  [notification["id"]]
);
```

The first `SELECT` at line 121 fires before any delivery attempt. This is the error path every notification hits.

**Blast radius:** Even after fixing P0-1, no notification can be processed. Combined with P0-1 this makes the notification system entirely non-functional.

**Fix:**
```sql
-- same new migration as P0-1
ALTER TABLE notifications
  ADD COLUMN delivery_token TEXT,
  ADD COLUMN delivery_committed_at TIMESTAMPTZ;
```

---

### P0-3 · `notifications.ts:140-141` — Preferences GET returns wrapper object; client expects array
**Category: Architecture / Type**

`NotificationPreferenceService.list()` returns a `PreferenceResult` object:
```typescript
// PreferenceResult = { success: boolean; preferences?: NotificationPreference[]; error?: string }
const preferences = await prefs.list(ctx.userId);
return res.send(preferences);   // sends { success: true, preferences: [...] }
```

The frontend (`settings/notifications.tsx:37-43`) guards with `Array.isArray(prefs)`:
```typescript
.then((prefs: Preference[]) => {
  if (Array.isArray(prefs)) {  // always false — receives an object
    prefs.forEach(p => { map[p.channel] = p.enabled; });
  }
  setPreferences(map);   // map stays {}
})
```

**Blast radius:** The notification preferences UI always shows all channels as unchecked, regardless of saved state. Users cannot see or effectively manage their preferences. A user who sees "all unchecked" and saves will silently disable all channels.

**Fix:**
```typescript
const result = await prefs.list(ctx.userId);
if (!result.success) {
  return errors.internal(res, 'Failed to fetch preferences');
}
return res.send(result.preferences ?? []);
```

---

## HIGH (P1) — Likely Bugs Under Load / Security / Data Corruption

### P1-1 · `NotificationWorker.ts:48` — `MAX_RETRIES` defined but never checked
**Category: Architecture / Performance**

```typescript
private static readonly MAX_RETRIES = 3;  // defined here, never read anywhere
```

`listPending()` queries `WHERE status IN ('pending', 'failed')`. A failed notification is always re-queued on the next poll. There is no retry cap. A notification that fails continuously will be retried forever.

**Fix:** Add before the delivery attempt in `process()`:
```typescript
if (attemptCount >= NotificationWorker.MAX_RETRIES) {
  await this.dlq.record(notification["id"], notification.channel, 'Max retries exceeded', client);
  // leave status as 'failed' — do not re-queue
  await client.query('COMMIT');
  return { success: false, error: 'Max retries exceeded' };
}
```
Also requires `dlq.record()` to accept a `client` parameter (see P1-4).

---

### P1-2 · `notification-admin.ts:174-178` + `Notification.ts:12,23` — `'cancelled'` status bypasses domain state machine
**Category: Type / SQL**

`NotificationAdminService.cancel()` writes `status='cancelled'` directly to the database:
```typescript
`UPDATE notifications SET status='cancelled'
 WHERE id=$1 AND org_id=$2 AND status='pending'`
```

`'cancelled'` is not in `NotificationStatus = 'pending' | 'sending' | 'delivered' | 'failed'` and not in `VALID_TRANSITIONS`. When this row is later fetched and reconstituted, any state-transition call crashes:

```typescript
private validateTransition(to: NotificationStatus): void {
  const validTransitions = Notification.VALID_TRANSITIONS[this["status"]];
  // TypeError: Cannot read properties of undefined (reading 'includes')
  // because VALID_TRANSITIONS['cancelled'] === undefined
  if (!validTransitions.includes(to)) {
```

**Fix — Option A (preferred):** Add `'cancelled'` as a terminal status to the domain:
```typescript
export type NotificationStatus = 'pending' | 'sending' | 'delivered' | 'failed' | 'cancelled';
const VALID_TRANSITIONS: Record<NotificationStatus, NotificationStatus[]> = {
  // ...existing,
  cancelled: [],  // terminal
};
```
Add a DB check constraint:
```sql
ALTER TABLE notifications
  ADD CONSTRAINT chk_notifications_status
  CHECK (status IN ('pending','sending','delivered','failed','cancelled'));
```

---

### P1-3 · `notifications-admin.ts:38,60,95,118,141` — `ForbiddenError` returns HTTP 500
**Category: Security / Architecture**

`requireRole()` throws `ForbiddenError` for callers lacking the required role. All five admin route handlers catch this in a generic `catch` block and return `errors.internal(res, ...)` — **HTTP 500** — instead of 403. The retry and cancel endpoints explicitly handle `NotFoundError` and `ValidationError` but omit `ForbiddenError`.

This means:
- Unauthorized access is indistinguishable from server errors in logs and monitoring.
- Alerts on 5xx rates will fire for every authorization failure — obscuring real outages.
- Security audit trails cannot differentiate "unauthorized attempt" from "server bug".

**Fix:** In every catch block:
```typescript
} catch (error) {
  if (error instanceof ForbiddenError) return errors.forbidden(res);
  if (error instanceof NotFoundError)  return errors.notFound(res, 'Notification');
  if (error instanceof ValidationError) return errors.badRequest(res, error.message);
  logger.error('...', error instanceof Error ? error : new Error(String(error)));
  return errors.internal(res, '...');
}
```

---

### P1-4 · `NotificationWorker.ts:211` + `PostgresNotificationDLQRepository.ts:35` — DLQ write is outside the failure transaction
**Category: SQL — Data Inconsistency**

In the failure path of `process()`, the DLQ write fires **outside** the transaction that records the attempt and updates notification status:

```typescript
await client.query('BEGIN');
await this.attempts.record(..., client);            // in transaction ✓
await this.notifications.save(failedNotification, client); // in transaction ✓
await this.dlq.record(notification["id"], channel, errorMessage); // pool, NOT client ✗
await writeToOutbox(client, ...);                   // in transaction ✓
await client.query('COMMIT');
```

`PostgresNotificationDLQRepository.record()` accepts no `client` parameter and always uses `this.pool`. If the subsequent `COMMIT` fails, the DLQ entry persists as an orphan with no corresponding status update or outbox event.

**Fix — Step 1:** Add `client?: PoolClient` to `DLQRepository.record()` signature and implementation.
**Fix — Step 2:** Pass `client` at line 211:
```typescript
await this.dlq.record(notification["id"], notification.channel, errorMessage, client);
```

---

### P1-5 · `20260210000700_dom_notifications_init.up.sql:22-29` + `PostgresNotificationPreferenceRepository.ts:123-128` — No UNIQUE constraint on `(user_id, channel)`
**Category: SQL — Data Corruption**

The `notification_preferences` table has no unique constraint on `(user_id, channel)`. The upsert conflicts on `id` (primary key). Under concurrent requests, if `getByUserAndChannel()` returns `null` for both (before any row exists), both requests insert with different UUIDs. The user ends up with two rows for the same channel.

`FOR UPDATE` on `getByUserAndChannel()` cannot lock a non-existent row, so the gap lock race condition is real.

**Fix:**
```sql
-- new migration
ALTER TABLE notification_preferences
  ADD CONSTRAINT uq_notification_pref_user_channel UNIQUE (user_id, channel);
```
Change the repository upsert:
```sql
ON CONFLICT (user_id, channel) DO UPDATE SET
  enabled = EXCLUDED.enabled,
  frequency = EXCLUDED.frequency,
  updated_at = now()
```

---

### P1-6 · `NotificationWorker.ts:100` — Preferences read outside the active transaction
**Category: SQL — Race Condition**

```typescript
const preferences = await this.prefs.getForUser(notification.userId);
// ↑ no client passed — acquires a new pool connection, outside the BEGIN at line 84
```

A concurrent `disableAll()` call — which uses `FOR UPDATE` locking — can commit between the notification read and the preference read. The worker processes a delivery it should have skipped.

**Fix:**
```typescript
const preferences = await this.prefs.getForUser(notification.userId, client);
```

---

### P1-7 · `nextActions.ts:12,46-48` — `'create'` action is declared in the union but unreachable
**Category: Type / Architecture**

```typescript
export type AdvisorRecommendation = {
  action: 'refresh' | 'expand' | 'create' | 'prune';  // 'create' declared
};
// ...
let action: AdvisorRecommendation['action'] = 'refresh';
if (s.traffic > 1000 && s.roi_12mo > 50) action = 'expand';
if (s.traffic < 50  && s.roi_12mo < 0)  action = 'prune';
// 'create' is never assigned
```

The return type contract is a lie. Downstream UI components and API consumers that handle `'create'` as a distinct case never execute that branch. This is a silently missing product feature.

**Fix:** Either implement the decision logic (e.g., `s.traffic === 0 → 'create'`) or remove `'create'` from the union and update the OpenAPI spec and `NextActionsAdvisor.tsx`.

---

### P1-8 · `notification.lifecycle.test.ts` + `notification.adapters.test.ts` — ~2% domain coverage
**Category: Testability / Quality**

The entire notifications domain has two test files containing four assertions total. **Completely untested:**
- `NotificationWorker.process()` — most complex function in the domain
- `NotificationService.create()` with invalid payloads
- `NotificationPreferenceService.set()` concurrent race conditions
- `NotificationAdminService` all methods
- All repository implementations
- Invalid state machine transitions
- `recommendNextActions()` scoring correctness and edge cases
- Retry cap enforcement (which doesn't exist — see P1-1)

CLAUDE.md mandates 80% line coverage globally. The notifications domain is at approximately 2%.

---

## MEDIUM (P2) — Technical Debt / Correctness Under Load

### P2-1 · All notification migrations — Zero indexes
**Category: SQL / Performance**

No indexes beyond primary keys. Every query is a full table scan:

| Query location | Column(s) needing index |
|---|---|
| `listPending()` — `WHERE status IN (...)` | `(status, created_at ASC)` |
| `listByUser()` — `WHERE user_id = $1` | `(user_id, created_at DESC)` |
| `listNotifications()` — `WHERE org_id = $1` | `(org_id, created_at DESC)` |
| `GET /notifications` — `WHERE user_id = $1 ORDER BY created_at DESC` | `(user_id, created_at DESC)` |
| `countByNotification()` — `WHERE notification_id = $1` | `notification_attempts(notification_id)` |
| `listByNotification()` | `notification_attempts(notification_id)` |
| `getForUser()` — `WHERE user_id = $1` | `notification_preferences(user_id, channel)` |
| `DLQ list()` — JOIN `ON notification_id` | `notification_dlq(notification_id)` |

**Fix:** Add a new migration with the indexes above.

---

### P2-2 · All notification migrations — Missing foreign key constraints
**Category: SQL / Data Integrity**

```sql
-- notification_attempts: no FK
notification_id TEXT NOT NULL   -- should REFERENCES notifications(id) ON DELETE CASCADE

-- notification_dlq: no FK
notification_id TEXT NOT NULL   -- should REFERENCES notifications(id) ON DELETE CASCADE
```

`deleteOld()` deletes notifications without cascading. Orphaned attempt and DLQ rows accumulate indefinitely.

---

### P2-3 · All notification migrations — `TIMESTAMP` without timezone
**Category: SQL / Data Integrity**

All `created_at` columns use `TIMESTAMP DEFAULT now()`. CLAUDE.md audit checklist explicitly flags this. After a DB server timezone change or cross-region migration, historical timestamps are misinterpreted silently.

**Fix:** Change all to `TIMESTAMPTZ DEFAULT now()` in a new migration.

---

### P2-4 · `notifications.ts:26` — `channel` Zod schema accepts any string
**Category: Security / Validation**

```typescript
const PreferenceBodySchema = z.object({
  channel: z.string().min(1),   // should be z.enum([...])
  enabled: z.boolean(),
  frequency: z.enum(['immediate', 'daily', 'weekly']).optional(),
}).strict();                    // .strict() is also missing
```

A caller can POST `{ channel: "attacker-controlled" }`. `NotificationPreferenceService.validateInputs()` catches it downstream, but Zod is the declared first line of defense (CLAUDE.md: *"Zod schemas for all request validation"*).

**Fix:**
```typescript
const PreferenceBodySchema = z.object({
  channel: z.enum(['email', 'sms', 'push', 'webhook']),
  enabled: z.boolean(),
  frequency: z.enum(['immediate', 'daily', 'weekly']).optional(),
}).strict();
```

---

### P2-5 · `notifications.ts:25` — Missing `.strict()` on all Zod schemas
**Category: Security / Validation**

CLAUDE.md: *"Use `.strict()` on Zod object schemas to reject extra properties."* `PreferenceBodySchema` silently strips unknown fields instead of rejecting them.

---

### P2-6 · `notifications-hook.ts:113-114,145-146` — `process.stderr.write` bypasses structured logger
**Category: Observability**

```typescript
process.stderr.write(`[${timestamp}] [ERROR] [notifications-hook] ...`);
```

The structured logger is already imported. Raw stderr writes bypass PII redaction, correlation ID injection, and log aggregation. CLAUDE.md explicitly prohibits `console.log` and by extension unstructured stderr writes.

**Fix:** Replace both occurrences with `logger.error('...', { details })`.

---

### P2-7 · `notifications-hook.ts:51-67` — Module-level singleton adapters never cleaned up
**Category: Architecture / Deployment**

```typescript
let emailAdapter: EmailAdapter | null = null;   // module-level mutable state
let webhookAdapter: WebhookAdapter | null = null;
```

These adapters are never registered with the graceful shutdown handler. On SIGTERM, any open SMTP sessions or HTTP keep-alive connections in the adapters are abandoned rather than drained.

**Fix:** Inject adapters as parameters to `registerNotificationsDomain()` and manage their lifecycle at the application root where shutdown hooks are registered.

---

### P2-8 · `NotificationWorker.ts:159` — Pool connection held across external I/O
**Category: Performance / Resilience**

The pool connection is checked out at line 80 and released only in `finally` at line 241. The external `adapter.send(message)` call at line 159 happens between two separate `BEGIN`/`COMMIT` pairs — **outside any transaction** — but the connection remains checked out. If the adapter hangs (unreachable SMTP host, webhook timeout), the pool connection is held indefinitely, starving other operations.

**Fix:** Release the client before `adapter.send()` and re-acquire it for the post-delivery transaction, or enforce a hard timeout on `adapter.send()` via `AbortController`.

---

### P2-9 · `ALLOWED_CHANNELS` defined in three separate places
**Category: Architecture — DRY Violation**

`['email', 'sms', 'push', 'webhook']` appears independently in:
- `NotificationService.ts:41`
- `NotificationPreferenceService.ts:45`
- `settings/notifications.tsx:17-22` (as `CHANNELS`)

Adding a new channel requires three simultaneous edits. One will always be missed.

**Fix:** Export from `@kernel/constants` or `@types/notifications` as `export const ALLOWED_CHANNELS = ['email', 'sms', 'push', 'webhook'] as const;` and import everywhere.

---

### P2-10 · `NotificationService.ts:176` — Payload size check uses JS string length, not byte count
**Category: Performance / Security**

```typescript
const payloadSize = JSON.stringify(payload).length;
```

`String.length` is UTF-16 code units. A payload of 100KB in UTF-8 Chinese text reports ~33K JS length units, well under the 100 × 1024 limit — but the actual bytes transmitted and stored are 3× larger.

**Fix:**
```typescript
const payloadSize = Buffer.byteLength(JSON.stringify(payload), 'utf8');
```

---

### P2-11 · `NotificationService.ts:251-253` — Arrays silently converted to strings in `sanitizeObject`
**Category: Architecture — Silent Data Loss**

```typescript
} else {
  // Arrays and other types - convert to string
  sanitized[sanitizedKey] = String(value);
}
```

`payload.data = { recipients: ['a@b.com', 'c@d.com'] }` becomes `{ recipients: "a@b.com,c@d.com" }`. No warning, no error. Template rendering that expects an array silently receives a comma-separated string.

**Fix:** Either preserve arrays with element sanitization (with length limit), or explicitly reject payloads containing arrays with a validation error rather than silently transforming them.

---

### P2-12 · `packages/types/notifications.ts:112` vs `NotificationAttempt.ts:9` — Status type drift
**Category: Type / Data Integrity**

Shared types package declares:
```typescript
status: 'pending' | 'sent' | 'failed' | 'delivered';
```
Domain entity and DB store:
```typescript
status: 'success' | 'failure';
```

Any code consuming the shared types package expects different values than what is in the database. Undetected schema drift.

**Fix:** Align both to `'success' | 'failure'` (matching what is persisted) and update the shared types package. Add a DB check constraint: `CHECK (status IN ('success', 'failure'))` on `notification_attempts`.

---

### P2-13 · `settings/notifications.tsx:60` — Save failure is silent; no user feedback
**Category: UX / Bug**

```typescript
} catch {
  setPreferences(prev => ({ ...prev, [channel]: !enabled })); // reverts
  // no setLoadError / setSaveError called
}
```

The toggle silently reverts. Users with intermittent networks experience toggles that appear to succeed then snap back with no explanation.

**Fix:** Add a `saveError` state, set it in the catch block, and display it in the UI.

---

### P2-14 · `settings/notifications.tsx:32,44` — Load error leaves checkboxes in wrong default state
**Category: UX / Bug**

When `GET /notifications/preferences` fails, `loadError` is set but all checkboxes remain unchecked (`preferences[ch.id] ?? false`). A user who sees the error banner but interacts with the unchecked toggles will POST `enabled: false` for channels that were enabled server-side, silently disabling them.

**Fix:** Set all checkboxes to `disabled` while `loadError` is set, or show a warning that the displayed state is stale.

---

### P2-15 · `notifications-admin.ts` — Route params cast with `as`, not validated by Zod
**Category: Security / Type**

```typescript
const { id } = req.params as { id: string };
```

This is an unsafe TypeScript cast. `isValidUUID(id)` validates the format afterward, but the parameter is not validated by a Zod schema as required by project convention. The `as` cast suppresses the type error without providing runtime guarantees.

**Fix:** Validate params with a Zod schema: `z.object({ id: z.string().uuid() }).parse(req.params)`.

---

### P2-16 · `NextActionsAdvisor.tsx:33` — React list key is text content
**Category: Bug / React**

```tsx
<li key={explanationItem}>{explanationItem}</li>
```

Duplicate explanation strings (e.g., two signals both emit "Traffic is declining") produce duplicate keys. React emits a warning and may reconcile incorrectly.

**Fix:** `key={`${recommendation.content_id}-explanation-${index}`}`

---

### P2-17 · `notifications.tsx` (page) — Live-routed stub with hardcoded fake data
**Category: Architecture / UX**

```tsx
<li>Affiliate offer terminated</li>
<li>Monetization decay detected</li>
<li>Pending intent awaiting approval</li>
```

This page is publicly routed at `/notifications`, makes zero API calls, and shows fabricated notification items regardless of user state. The actual `GET /notifications` API is fully implemented.

**Fix:** Implement data fetching against `GET /notifications`, or gate behind a feature flag with a "coming soon" placeholder.

---

## LOW (P3) — Maintainability / Style

| # | File:Line | Issue |
|---|-----------|-------|
| P3-1 | `NotificationPreference.ts:105` | `setFrequency()` has no runtime validation (unlike `create()`/`reconstitute()` which call `validateFrequency()`) |
| P3-2 | `NotificationWorker.ts:312` | Audit log writes to `logger.info` only — not a durable, append-only store |
| P3-3 | `notifications-hook.ts:141` | String concatenation in logger call bypasses PII redaction on error field |
| P3-4 | `nextActions.ts` (entire file) | No Zod validation schema — violates project convention; `NaN`/`Infinity` inputs silently produce wrong scores |
| P3-5 | `nextActions.ts:2,11` | `content_id` is plain `string`, not branded `ContentId` from `@kernel/branded` |
| P3-6 | `NextActionsAdvisor.tsx:21-26` | Inline style objects violate Tailwind convention; numeric values are unitless |
| P3-7 | `NextActionsAdvisor.tsx` | No empty state when `recommendations` is `[]`; bare `<h2>` floats with no content |
| P3-8 | `NextActionsAdvisor.tsx` | No `role="article"` or ARIA labels — will fail `npm run test:a11y` |
| P3-9 | `domains/new.tsx:37` + `content/new.tsx:41` | `domain.id` / `item.id` accessed on unvalidated `any` from `res.json()`; navigates to `/domains/undefined` on API shape change |
| P3-10 | `PostgresNotificationRepository.ts:33` | `withTransaction` method defined on repository but never called from outside — dead code |
| P3-11 | `nextActions.ts:33-40` | Scoring conditions can simultaneously satisfy "Positive ROI" and "Negative ROI" branches when `roi_12mo = 0.001`; contradictory explanations emitted |

---

## Phase 2 — Adversarial Re-Examination

### Re-1 · `notifications-hook.ts:72-88` — Custom type guard uses `as` casts, not true narrowing

The validator performs:
```typescript
const e = event as Record<string, unknown>;
const meta = e["meta"] as Record<string, unknown>;
```
After a `typeof` check, the value is immediately widened again via `as`. The guard function correctly rejects invalid shapes at runtime, but the pattern defeats the purpose of TypeScript's narrowing and would be flagged by strict `no-unnecessary-type-assertion` rules. A Zod schema (`z.object({...}).safeParse(event)`) would provide both runtime validation and proper inferred types without the casts.

### Re-2 · `notifications-admin.ts` — `sanitizeErrorMessage` imported from a deep relative path

```typescript
import { sanitizeErrorMessage } from '../../../packages/security/logger';
```

This uses a relative path to cross package boundaries instead of the `@security/*` path alias defined in CLAUDE.md. If the `packages/security` directory is moved or restructured, this import silently breaks at build time rather than being caught by the alias configuration.

### Re-3 · `NotificationWorker.ts` comment vs reality mismatch

Line 252: `// HIGH FIX: Added transaction wrapper for batch operations to ensure atomicity`

The `processBatch()` method does **not** wrap operations in a batch-level transaction. Each `process()` call has its own independent transaction. The comment is false and will mislead future maintainers into believing batch atomicity exists when it does not.

---

## Ranked By Immediate Blast Radius

| Rank | ID | File:Line | Issue | Blast Radius |
|------|----|-----------|----|---|
| 1 | P0-1 | `PostgresNotificationRepository.ts:129` | `updated_at` column missing — every `save()` fails | All notification delivery permanently broken |
| 2 | P0-2 | `NotificationWorker.ts:121` | `delivery_token`/`delivery_committed_at` missing — `process()` throws before first delivery | All notification processing permanently broken |
| 3 | P0-3 | `notifications.ts:140` | Preferences GET returns object; client expects array | Preferences UI always empty; users cannot configure notifications |
| 4 | P1-3 | `notifications-admin.ts` (all routes) | `ForbiddenError` returns 500 | 403s are invisible; auth failures indistinguishable from server errors |
| 5 | P1-2 | `notification-admin.ts:174` | `status='cancelled'` bypasses state machine | `TypeError` crash when any cancelled notification is later reconstituted |
| 6 | P1-4 | `NotificationWorker.ts:211` | DLQ write outside failure transaction | DLQ orphans; notification status not updated atomically on failure |
| 7 | P1-1 | `NotificationWorker.ts:48` | `MAX_RETRIES` never enforced | Failed notifications retry forever; pool exhaustion under load |
| 8 | P1-5 | migration + `Preference` repo | No UNIQUE on `(user_id, channel)` | Duplicate preference rows under concurrent writes; last reader wins |
| 9 | P2-3 | All migrations | `TIMESTAMP` without timezone | Timezone-sensitive queries silently wrong after server move or DST |
| 10 | P2-1 | All migrations | Zero indexes on query columns | Full table scans; system collapses at moderate row counts |

**P0-1 and P0-2 are blocking.** No notification can be saved or processed in the current state. They must be fixed before any deployment.
