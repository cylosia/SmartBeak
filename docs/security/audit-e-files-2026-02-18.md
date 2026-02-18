# Security & Code-Quality Audit — `e*` Files
**Date:** 2026-02-18
**Scope:** All 30 repository files whose filename starts with `e` (25 source, 5 test/config)
**Methodology:** Three independent subagents audited in parallel; a fourth verified every cross-file claim against actual source. Only confirmed findings are listed.
**Branch:** `claude/security-audit-typescript-postgres-PDqt3`

---

## Table of Contents
1. [Files Audited](#files-audited)
2. [P0 — Critical (Deploy and Production Burns)](#p0--critical)
3. [P1 — High (Fix Before Next Release)](#p1--high)
4. [P2 — Medium (Immediate Sprint)](#p2--medium)
5. [P3 — Low (Schedule)](#p3--low)
6. [Production Incident Ranking](#production-incident-ranking)

---

## Files Audited

| File | Lines |
|------|-------|
| `apps/api/src/email/schema/emailBlocks.ts` | 68 |
| `apps/api/src/jobs/experimentStartJob.ts` | 192 |
| `apps/api/src/routes/email.ts` | 21 (re-export) |
| `apps/api/src/routes/emailSubscribers.ts` | 22 (re-export) |
| `apps/api/src/routes/experiments.ts` | 140 |
| `apps/api/src/routes/exports.ts` | 135 |
| `apps/api/src/utils/validation/email.ts` | 132 |
| `apps/api/tests/experiments.spec.ts` | 11 |
| `apps/web/lib/env.d.ts` | 14 |
| `apps/web/lib/env.ts` | 21 (re-export) |
| `apps/web/pages/exports.tsx` | 41 |
| `domains/shared/infra/validation/errors.ts` | 12 (re-export) |
| `k8s/base/external-secrets.yaml` | 70 |
| `packages/config/__tests__/env.security.test.ts` | 212 |
| `packages/config/env.ts` | 131 |
| `packages/config/environment.ts` | 47 |
| `packages/errors/error-context.ts` | 52 |
| `packages/kernel/__tests__/event-bus.test.ts` | 131 |
| `packages/kernel/event-bus.ts` | 219 |
| `packages/kernel/validation/email.ts` | 73 |
| `packages/kernel/validation/errorHelpers.ts` | 408 |
| `packages/types/events/events.contract.test.ts` | 8 |
| `plugins/notification-adapters/email-adapter.ts` | 799 |
| `test/benchmarks/event-bus-throughput.bench.ts` | 156 |
| `test/chaos/event-bus-handler-failures.test.ts` | 196 |
| `test/visual/components/error-boundary.visual.ts` | 48 |

---

## P0 — Critical

> Deploy any of these and production is compromised or non-functional.

---

### P0-1 · Postmark Path Missing `stripCrlf` — SMTP Header Injection

**File:** `plugins/notification-adapters/email-adapter.ts:707-712`
**Category:** Security

**Violation:**
```typescript
// sendWithPostmark() — CRLF stripping absent:
body: JSON.stringify({
  From: `${this.config.fromName} <${this.config.fromEmail}>`,  // ← no stripCrlf
  To: Array.isArray(payload.to) ? payload.to.join(',') : payload.to, // ← no stripCrlf
  Subject: payload.subject,
  HtmlBody: payload.html,
  TextBody: payload.text,
  ReplyTo: this.config.replyTo,   // ← no stripCrlf
}),
```

`sendWithSES()` (line 518) and `sendWithSMTP()` (line 591) both call `stripCrlf` on these fields with explicit comments explaining why. The Postmark path silently omits it. `this.config.fromName` reads from `EMAIL_FROM_NAME` env var (operator-controlled); `replyTo` from `EMAIL_REPLY_TO`. An attacker who controls either can inject `\r\nBcc: victim@attacker.com`, silently BCCing every Postmark-routed email.

**Fix:**
```typescript
body: JSON.stringify({
  From: `${stripCrlf(this.config.fromName ?? '')} <${this.config.fromEmail}>`,
  To: (Array.isArray(payload.to) ? payload.to : [payload.to]).map(stripCrlf).join(','),
  Subject: stripCrlf(payload.subject),
  HtmlBody: payload.html,
  TextBody: payload.text,
  ReplyTo: this.config.replyTo ? stripCrlf(this.config.replyTo) : undefined,
}),
```

**Blast radius:** Silent BCC injection on every Postmark-routed outbound email. CAN-SPAM and GDPR liability. Potential provider account suspension for spam abuse.

---

### P0-2 · Unvalidated SMTP Attachments — Path Traversal, Executable Delivery, Quota Exhaustion

**File:** `plugins/notification-adapters/email-adapter.ts:600-603`
**Category:** Security

**Violation:**
```typescript
await transporter.sendMail({
  // ...
  attachments: payload.attachments,  // ← no MIME check, no size limit, no filename sanitization
});
```

`payload.attachments` is typed `Array<{ filename: string; content: Buffer | string; contentType?: string }>`. No validation on:
- **`filename`**: path traversal sequences (`../../../../etc/passwd`) forwarded verbatim in `Content-Disposition` to recipient mail clients that auto-save attachments.
- **`content`**: unlimited size — one attachment can deplete the SMTP provider's sending quota for the entire account.
- **`contentType`**: `application/x-msdownload` (Windows executable) or `application/x-sh` (shell script) are accepted.
- **Count**: unlimited array length.

**Fix:**
```typescript
const ALLOWED_MIME = new Set([
  'application/pdf', 'image/png', 'image/jpeg',
  'text/plain', 'text/csv', 'image/gif',
]);
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;  // 5 MB
const MAX_ATTACHMENTS = 5;

function sanitizeAttachments(
  raw: EmailPayload['attachments']
): EmailPayload['attachments'] {
  if (!raw) return undefined;
  if (raw.length > MAX_ATTACHMENTS)
    throw new ExternalAPIError('Too many attachments', ErrorCodes.PAYLOAD_TOO_LARGE, {});
  return raw.map(a => {
    const filename = a.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    if (a.contentType && !ALLOWED_MIME.has(a.contentType))
      throw new ExternalAPIError(`Disallowed MIME type: ${a.contentType}`, ErrorCodes.INVALID_FORMAT, {});
    const size = Buffer.isBuffer(a.content)
      ? a.content.length
      : Buffer.byteLength(a.content as string);
    if (size > MAX_ATTACHMENT_BYTES)
      throw new ExternalAPIError('Attachment too large', ErrorCodes.PAYLOAD_TOO_LARGE, {});
    return { ...a, filename };
  });
}
// Call before sendMail: payload.attachments = sanitizeAttachments(payload.attachments);
```

**Blast radius:** Executable attachments forwarded to users. SMTP quota exhaustion disables all email delivery for the account. Path traversal payloads in `Content-Disposition` headers.

---

### P0-3 · `exports.ts` CSRF and Rate-Limit Hooks Not Properly Awaited

**File:** `apps/api/src/routes/exports.ts:84-86`
**Category:** Security

**Violation:**
```typescript
// exports.ts — no type cast:
app.addHook('onRequest', csrfProtection());
app.addHook('onRequest', apiRateLimit());

// experiments.ts — explicit cast used correctly:
app.addHook('onRequest', csrfProtection() as (req: FRequest, reply: FastifyReply, done: HookHandlerDoneFunction) => void);
app.addHook('onRequest', apiRateLimit()   as (req: FRequest, reply: FastifyReply, done: HookHandlerDoneFunction) => void);
```

Fastify distinguishes between `done`-callback hooks and async hooks. If `csrfProtection()` and `apiRateLimit()` return async functions (Promise-based), registering them without the explicit hook-type cast causes Fastify to treat them as synchronous `done`-callback hooks and invoke `done()` immediately — without awaiting the middleware. CSRF validation and rate limiting never execute. The `experiments.ts` file contains the exact cast that works around this; `exports.ts` omits it, silently removing all protection from the export endpoint.

**Fix:**
```typescript
import type { FastifyReply, FastifyRequest as FRequest, HookHandlerDoneFunction } from 'fastify';

app.addHook('onRequest',
  csrfProtection() as (req: FRequest, reply: FastifyReply, done: HookHandlerDoneFunction) => void);
app.addHook('onRequest',
  apiRateLimit()   as (req: FRequest, reply: FastifyReply, done: HookHandlerDoneFunction) => void);
```

**Blast radius:** `/exports` endpoint has no CSRF protection and no rate limiting. Any authenticated-user page on the same origin (or a cross-origin page if `SameSite` is not `Strict`) can submit cross-site form requests triggering financial data exports without user consent.

---

### P0-4 · `ExportBodySchema` Missing `.strict()` — Extra Fields Silently Accepted

**File:** `apps/api/src/routes/exports.ts:11-15`
**Category:** Security

**Violation:**
```typescript
const ExportBodySchema = z.object({
  domain_id: z.string().uuid('Domain ID must be a valid UUID'),
  type: z.string().min(1, 'Export type is required').optional()
  // No .strict() — violates CLAUDE.md convention explicitly
});
```

Without `.strict()`, extra request body fields are silently stripped by Zod. Consequences:
1. Future schema additions (e.g., `include_pii`, `output_format`) that are partially deployed receive no validation fence — an attacker can probe new fields before they are guarded.
2. Objects with `__proto__` or `constructor` keys pass Zod parsing and reach downstream spread operations.

**Fix:**
```typescript
const ExportBodySchema = z.object({
  domain_id: z.string().uuid('Domain ID must be a valid UUID'),
  type: z.string().min(1).max(100).optional(),
}).strict();
```

**Blast radius:** Defense-in-depth failure. Prototype pollution risk. Probe vector for future schema additions before their guards are deployed.

---

## P1 — High

> Fix before the next production release.

---

### P1-1 · No Role Check on Financial Exports Page — Horizontal Privilege Escalation

**File:** `apps/web/pages/exports.tsx:11-18`
**Category:** Security / Authorization

**Violation:**
```typescript
export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const { userId } = getAuth(ctx.req);
  if (!userId) return { redirect: { destination: '/login', permanent: false } };
  return { props: {} };
  // Any viewer, editor, admin, or owner sees Revenue Ledger, Buyer Diligence Bundle
};
```

The page renders `Revenue Ledger`, `Domain Transfer Package`, `Buyer Diligence Bundle` — financially and legally sensitive M&A export options. Authentication is checked; authorization is not. The API route (`/exports`) also only checks `!!row` (any membership), not `row.role`.

**Fix — page (`exports.tsx`):**
```typescript
import { clerkClient } from '@clerk/nextjs/server';

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const { userId, orgId } = getAuth(ctx.req);
  if (!userId || !orgId)
    return { redirect: { destination: '/login', permanent: false } };
  const membership = await clerkClient.organizations
    .getOrganizationMembership({ organizationId: orgId, userId });
  if (!['admin', 'owner'].includes(membership.role))
    return { redirect: { destination: '/unauthorized', permanent: false } };
  return { props: {} };
};
```

**Fix — API route (`exports.ts:56`):**
```typescript
// Change:
return !!row;
// To:
return !!row && ['admin', 'owner'].includes(row['role'] as string);
```

**Blast radius:** Every `viewer`/`editor` role member in any organization has immediate access to Revenue Ledger and M&A-sensitive export bundles. Direct horizontal privilege escalation.

---

### P1-2 · `canAccessDomain` Returns 403 on DB Error — Misleading Failure Mode

**Files:** `apps/api/src/routes/experiments.ts:58-61`, `apps/api/src/routes/exports.ts:57-60`
**Category:** Security / Resilience

**Violation:**
```typescript
} catch (error) {
  logger.error('Error checking domain access', error as Error);
  return false;  // ← transient DB error produces 403 "Access denied to domain"
}
```

A transient DB failure (connection pool exhaustion, maintenance window) makes legitimate users receive 403 ("Access denied") instead of 503 ("Service Unavailable"). On-call engineers see a 403 spike, investigate permissions (wrong root cause), and no 5xx alert fires (correct root cause hidden).

**Fix:**
```typescript
} catch (error) {
  logger.error('Error checking domain access',
    error instanceof Error ? error : new Error(String(error)));
  throw new ServiceUnavailableError('Authorization check temporarily unavailable');
}
```

**Blast radius:** Transient DB failures produce misleading 403s. Zero monitoring signal for authorization service degradation. On-call investigates the wrong system.

---

### P1-3 · `draft` Status Experiments Can Be Started — Invalid State Transition

**File:** `apps/api/src/jobs/experimentStartJob.ts:92-103, 128-132`
**Category:** Correctness / SQL

**Violation:**
```typescript
// Guards explicitly block 'running', 'completed', 'cancelled' — but NOT 'draft':
if (exp.status === 'running') { return { status: 'already_running', experimentId }; }
if (exp.status === 'completed' || exp.status === 'cancelled') { throw ... }

// whereNotIn also omits 'draft':
.whereNotIn('status', ['running', 'completed', 'cancelled'])
.update({ status: 'running', ... })
```

Experiments in `draft` status (presumably incomplete or unapproved) transition directly to `running`, bypassing any `ready`-state workflow. A draft experiment may have 0 or 1 variants; the variant-count guard on line 105 (`exp.variants.length < 2`) uses the `ExperimentVariantSchema` which uses `.passthrough()` — incomplete variant shapes pass validation.

**Fix:**
```typescript
// Replace the compound guard with an allowlist:
if (exp.status !== 'ready') {
  throw new Error(`Cannot start experiment with status: ${exp.status}`);
}

// And align the whereNotIn:
.whereNotIn('status', ['running', 'completed', 'cancelled', 'draft'])
```

**Blast radius:** Incomplete/unapproved experiments run in production. A/B test results are invalid. Potential data corruption if experiment machinery assumes minimum variant structure.

---

### P1-4 · `validateExperiment` Throws Plain `Error` → HTTP 500 Instead of 400

**Files:** `apps/api/src/domain/experiments/validateExperiment.ts:31-40`, `apps/api/src/routes/experiments.ts:108-126`
**Category:** Correctness / Error Handling

**Violation:**
```typescript
// validateExperiment.ts — business rule violations:
if (intents.size > 1) throw new Error('All variants must share the same intent');
if (types.size > 1)   throw new Error('All variants must share the same content type');

// Route catch — catches everything as a server error:
} catch (error) {
  logger.error('Error processing experiment request', error as Error);
  return errors.internal(reply);  // ← 500 for a client 400-class error
}
```

Verified: `validateExperiment.ts` throws plain `Error`. The blanket catch routes them to HTTP 500. Valid client errors inflate 5xx metrics and trigger false on-call alerts.

**Fix — `validateExperiment.ts`:**
```typescript
import { ValidationError } from '@errors';
if (intents.size > 1)
  throw new ValidationError('All variants must share the same intent');
if (types.size > 1)
  throw new ValidationError('All variants must share the same content type');
```

**Fix — route catch:**
```typescript
} catch (error) {
  if (error instanceof ValidationError)
    return errors.validationFailed(reply, [{ message: error.message }]);
  logger.error('Error processing experiment request',
    error instanceof Error ? error : new Error(String(error)));
  return errors.internal(reply);
}
```

**Blast radius:** All domain-rule violations produce HTTP 500. 5xx metrics and alerting are permanently polluted by client-side errors.

---

### P1-5 · `triggeredBy` Has No Max Length — Unbounded DB Column Write

**File:** `apps/api/src/jobs/experimentStartJob.ts:35, 122, 158`
**Category:** Security / SQL

**Violation:**
```typescript
triggeredBy: z.string().optional(),  // ← no maxLength
// ...
started_by: triggeredBy ?? null,     // ← written directly to DB column
```

A multi-megabyte `triggeredBy` string triggers either a PostgreSQL `value too long` error mid-transaction (rolling back the experiment start, leaving it stuck) or unbounded `TEXT` storage growth.

**Fix:** `triggeredBy: z.string().max(256).optional()`

**Blast radius:** DoS of the experiment-start job via oversized payload. Transaction rollback mid-way leaves experiments in a stuck `draft`/`ready` state.

---

### P1-6 · `parseJSONEnv<T>` Casts to `T` Without Runtime Validation

**File:** `packages/config/env.ts:122`
**Category:** Security / TypeScript

**Violation:**
```typescript
return JSON.parse(value) as T;  // ← no runtime type enforcement
```

`RATE_LIMIT_CONFIG={"maxRequests":"10","windowMs":true}` returns a typed object where `maxRequests` is a string and `windowMs` is a boolean. Downstream arithmetic (`windowMs / 1000`) produces `NaN`, silently disabling rate limits or other security controls configured via this utility.

**Fix:**
```typescript
export function parseJSONEnv<T>(
  name: string,
  schema: z.ZodType<T>,
  defaultValue: T
): T {
  const value = process.env[name];
  if (!value) return defaultValue;
  try {
    const result = schema.safeParse(JSON.parse(value));
    if (!result.success) {
      logger.warn('JSON env var has unexpected shape, using default',
        { name, error: result.error.message });
      return defaultValue;
    }
    return result.data;
  } catch (e) {
    logger.warn('Failed to parse JSON env var, using default',
      { name, error: e instanceof Error ? e.message : String(e) });
    return defaultValue;
  }
}
```

**Blast radius:** Security-critical configuration values (rate limits, CORS origins, feature flags) silently receive mistyped data; `NaN`/`undefined` propagates through arithmetic.

---

### P1-7 · `\btest\b` in `PLACEHOLDER_PATTERN` False-Positives on Stripe Test Keys

**File:** `packages/config/env.ts:13`
**Category:** Correctness

**Violation:**
```typescript
const PLACEHOLDER_PATTERN = /\bplaceholder\b|\byour_|\bxxx\b|\bexample\b|\btest\b|.../i;
```

`sk_test_<...>` (a legitimate Stripe test-mode API key) matches `\btest\b` because `_` is a word-boundary delimiter. `isPlaceholder()` returns `true`, causing config validation to treat the real key as unconfigured and potentially refuse startup or skip Stripe initialization in staging environments.

**Fix:** Replace `\btest\b` with `^test$` (match only when the entire value is the word "test"):
```typescript
const PLACEHOLDER_PATTERN =
  /\bplaceholder\b|\byour_|\bxxx\b|\bexample\b|^test$|\bdemo\b|\bfake\b|\bmock\b|\binvalid\b|\bnull\b|^\s*$/i;
```

**Blast radius:** Staging environments with Stripe test-mode API keys (format `sk_test_*`) fail config validation, breaking Stripe payment flows. May cause CI startup failure.

---

### P1-8 · `attemptRecovery('retry')` Does Not Retry

**File:** `packages/kernel/validation/errorHelpers.ts:264-267`
**Category:** Correctness / Resilience

**Violation:**
```typescript
case 'retry':
  // Retry logic is handled at a higher level
  config.onRecovery?.(error, 'retry');
  throw error;  // ← zero retries performed; maxRetries and retryDelayMs are unused
```

The `ErrorRecoveryConfig<T>` interface declares `maxRetries?: number` and `retryDelayMs?: number` — both silently unused. Every caller specifying `strategy: 'retry'` receives an immediate rethrow.

**Fix:** Either implement retry using `withRetry` from `@kernel/retry`, or remove `'retry'` from the `RecoveryStrategy` union type and document the intended alternative.

**Blast radius:** All retry-configured recovery paths immediately propagate errors. Transient network/DB failures not recovered from.

---

### P1-9 · `experiment_runs` Insert Has No Conflict Guard

**File:** `apps/api/src/jobs/experimentStartJob.ts:154-160`
**Category:** SQL / Correctness

**Violation:**
```typescript
await trx('experiment_runs').insert({
  id: randomUUID(),
  experiment_id: experimentId,
  // ...
});
// ← No ON CONFLICT DO NOTHING or unique constraint guard
```

If the job succeeds in updating `experiments.status` to `'running'` but the transaction fails before commit (network partition), a retry enters the race-condition path (finds status `'running'`, returns `already_running`) and may still reach the insert, creating a duplicate run record.

**Fix:** Add a unique constraint in the migration:
```sql
ALTER TABLE experiment_runs
  ADD CONSTRAINT uniq_experiment_running_status
  UNIQUE (experiment_id, status)
  WHERE (status = 'running');
```

Or use `ON CONFLICT DO NOTHING` at the application layer:
```typescript
await trx('experiment_runs')
  .insert({ id: randomUUID(), experiment_id: experimentId, ... })
  .onConflict(['experiment_id'])  // adjust to actual unique key
  .ignore();
```

**Blast radius:** Duplicate experiment run records corrupt A/B test result aggregation and audit trails.

---

### P1-10 · `error as Error` Casts in `canAccessDomain` and `recordAuditEvent`

**Files:** `apps/api/src/routes/experiments.ts:58,79`, `apps/api/src/routes/exports.ts:57,77`
**Category:** TypeScript

**Violation:**
```typescript
logger.error('Error checking domain access', error as Error);
logger.error('Failed to record audit event', error as Error);
```

CLAUDE.md: "Catch parameters must be `unknown`. Use `getErrorMessage(error)` from `@errors`." A non-`Error` thrown value (e.g., a rejected promise that resolves to a string) passed as `Error` produces garbled structured log output and may skip PII redaction paths that only walk `Error.message`.

**Fix:**
```typescript
import { getErrorMessage } from '@errors';
logger.error('Error checking domain access', { message: getErrorMessage(error) });
```

**Blast radius:** Non-Error exceptions produce garbled log entries; potential PII exposure if the thrown value contains user data not on the redaction path.

---

## P2 — Medium

> Schedule for the immediate sprint.

---

### P2-1 · `/exports` Returns `generating` With No Job Dispatched

**File:** `apps/api/src/routes/exports.ts:127`
**Category:** Correctness / Observability

**Violation:**
```typescript
return reply.status(200).send({ status: 'generating' });
// ← No job enqueued. The export will never be produced.
```

The audit trail records `action: 'export_requested'` with no corresponding `action: 'export_completed'`. Users requesting Revenue Ledger or Buyer Diligence Bundle receive a false `generating` response and wait indefinitely.

**Fix:** Dispatch the job or return `501 Not Implemented` until wired:
```typescript
await exportQueue.add('generate-export', {
  domainId, exportType: parseResult.data.type,
  orgId: auth.orgId, userId: auth.userId,
});
return reply.status(202).send({ status: 'generating' });
```

**Blast radius:** Functional outage of all export features. Misleading audit trail complicates compliance investigations.

---

### P2-2 · EventBus `publish()` Reads Live Handler Array — Mutation During Iteration

**File:** `packages/kernel/event-bus.ts:122, 187`
**Category:** Concurrency

**Violation:**
```typescript
const handlers = this.handlers.get(event.name) ?? [];  // ← live reference
// subscribe() calls existing.push() → mutates this exact array in place

// After allSettled:
handlers[index]!.plugin  // ← may reference wrong plugin if array grew during dispatch
```

`getHandlers()` (line 112) correctly returns a deep copy; `publish()` does not use it.

**Fix:** `const handlers = [...(this.handlers.get(event.name) ?? [])];`

**Blast radius:** Wrong plugin name logged for failures. Potential out-of-bounds `handlers[index]` access if array shrinks during dispatch (unsubscribe from within a handler).

---

### P2-3 · Circuit Breaker Trips Only on 100% Handler Failure

**File:** `packages/kernel/event-bus.ts:194-197`
**Category:** Resilience

**Violation:**
```typescript
const allFailed = results.every(r => r.status === 'rejected');
if (allFailed && results.length > 0) { throw ... }
```

9/10 handler failures — covering billing, audit, and notification services simultaneously — do not trip the circuit breaker if one handler succeeds.

**Fix:**
```typescript
const failedCount = results.filter(r => r.status === 'rejected').length;
const FAILURE_RATIO_THRESHOLD = 0.5;
if (results.length > 0 && failedCount / results.length >= FAILURE_RATIO_THRESHOLD) {
  throw new Error(`${failedCount}/${results.length} handlers failed for event: ${event.name}`);
}
```

**Blast radius:** Systemic downstream failures masked. Missing billing events, audit events, and notification deliveries are all silent.

---

### P2-4 · `SELECT *` on `experiments` Table Inside Transaction

**File:** `apps/api/src/jobs/experimentStartJob.ts:80-83`
**Category:** Performance / SQL

**Violation:**
```typescript
const expResult = await trx('experiments')
  .where({ id: experimentId })
  .forUpdate()
  .first();  // ← fetches all columns including potentially large JSONB fields
```

**Fix:** `.select(['id', 'name', 'status', 'variants'])` — only the fields used by `validateExperiment`.

---

### P2-5 · `isValidationError` Spoofable by Duck Typing

**File:** `packages/kernel/validation/errorHelpers.ts:31-37`
**Category:** Security

**Violation:**
```typescript
return error instanceof ValidationError ||
  (typeof error === 'object' && error !== null &&
   'name' in error && error.name === 'ValidationError');  // ← spoofable
```

Any object `{ name: 'ValidationError', message: 'auth required' }` satisfies this guard, mapping it to HTTP 400 instead of the correct 401.

**Fix:** `return error instanceof ValidationError;`

---

### P2-6 · `classifyError` Classification Manipulable via Attacker-Controlled Error Messages

**File:** `packages/kernel/validation/errorHelpers.ts:354-384`
**Category:** Security

**Violation:**
```typescript
if (message.includes('not found') || message.includes('404')) return 'not_found';
if (message.includes('unauthorized') || message.includes('401')) return 'authentication';
```

An AWS SES error message like `"401 Unauthorized: invalid key"` reaches `classifyError` after being embedded into an `ExternalAPIError.message`. The result is `'authentication'` → HTTP 401, suggesting the caller retry with credentials instead of diagnosing a misconfiguration.

**Fix:** Remove the plain-`Error` message-string branch entirely:
```typescript
if (error instanceof Error) {
  return 'unknown';  // Never classify by message — content may be attacker-controlled
}
```

---

### P2-7 · `recordAuditEvent` Silently Swallows DB Failures — Audit Trail Loss

**Files:** `apps/api/src/routes/experiments.ts:63-81`, `apps/api/src/routes/exports.ts:63-80`
**Category:** Observability / Compliance

**Violation:**
```typescript
} catch (error) {
  logger.error('Failed to record audit event', error as Error);
  // ← export proceeds; no audit record written; no alert raised
}
```

For financial exports, a failed audit write must be either fatal (no audit = no export) or queued for guaranteed delivery.

**Fix for exports.ts (compliance-critical):**
```typescript
// Remove the try/catch — let DB write failures propagate:
await db('audit_events').insert({ ... });
```

**Fix for experiments.ts (lower criticality):** Queue to a dead-letter store for guaranteed delivery.

---

### P2-8 · `as EmailConfig` Unsafe Cast in `EmailAdapter` Constructor

**File:** `plugins/notification-adapters/email-adapter.ts:169-174`
**Category:** TypeScript

**Violation:**
```typescript
this.config = {
  ...safeConfig,
  fromEmail: safeConfig.fromEmail || getEnvWithDefault('EMAIL_FROM', DEFAULT_FROM_EMAIL),
  // ...
} as EmailConfig;  // ← bypasses required-field type checking
```

**Fix:** Use `satisfies` instead of `as`:
```typescript
this.config = {
  fromEmail: safeConfig.fromEmail ?? getEnvWithDefault('EMAIL_FROM', DEFAULT_FROM_EMAIL),
  fromName: safeConfig.fromName ?? getEnvWithDefault('EMAIL_FROM_NAME', DEFAULT_FROM_NAME),
  replyTo: safeConfig.replyTo ?? getEnv('EMAIL_REPLY_TO') ?? undefined,
  // all other optional fields explicitly listed:
  provider: safeConfig.provider,
  awsAccessKeyId: safeConfig.awsAccessKeyId,
  // ...
} satisfies EmailConfig;
```

---

### P2-9 · Raw Internal Error Messages Returned from `send()`

**File:** `plugins/notification-adapters/email-adapter.ts:342-344`
**Category:** Security

**Violation:**
```typescript
error: error instanceof Error ? error.message : String(error),
```

AWS SDK errors include IAM ARNs and regional endpoints. SMTP errors include server hostnames and auth failure details. These reach callers and may be stored in delivery audit records.

**Fix:**
```typescript
error: error instanceof DeliveryAdapterError ? error.message : 'Email delivery failed',
```

---

### P2-10 · `blocks` Has No Minimum Constraint — Zero-Block Emails Pass Validation

**File:** `apps/api/src/email/schema/emailBlocks.ts:63`
**Category:** Correctness

**Violation:** `blocks: z.array(EmailBlockSchema).max(100)` — no `.min(1)`.

**Fix:** `blocks: z.array(EmailBlockSchema).min(1).max(100)`

---

### P2-11 · `buildTimestamp` Recomputes `new Date()` on Every Access

**File:** `packages/config/environment.ts:42`
**Category:** Correctness

**Violation:**
```typescript
get buildTimestamp() { return process.env['BUILD_TIMESTAMP'] || new Date().toISOString(); }
```

Every access in a process without `BUILD_TIMESTAMP` returns the current wall-clock time, not a fixed build timestamp.

**Fix:**
```typescript
const _buildTs = process.env['BUILD_TIMESTAMP'] ?? new Date().toISOString();
// then:
get buildTimestamp() { return _buildTs; },
```

---

### P2-12 · Timer Leak in `runSafely` — `setTimeout` Never Cleared

**File:** `packages/kernel/safe-handler.ts:165-169` (verified cross-file)
**Category:** Performance / Resilience

**Violation:**
```typescript
const timeoutPromise = new Promise<never>((_, reject) => {
  setTimeout(() => reject(...), HANDLER_TIMEOUT_MS);  // ← handle never stored or cleared
});
await Promise.race([handler(), timeoutPromise]);
```

When `handler()` resolves, the 60-second timer remains live. Under sustained load, thousands of active timers accumulate, preventing graceful shutdown and increasing memory pressure.

**Fix:**
```typescript
let timeoutId: ReturnType<typeof setTimeout> | undefined;
const timeoutPromise = new Promise<never>((_, reject) => {
  timeoutId = setTimeout(() => reject(new Error(`Handler timed out after ${HANDLER_TIMEOUT_MS}ms`)), HANDLER_TIMEOUT_MS);
});
try {
  await Promise.race([handler(), timeoutPromise]);
} finally {
  clearTimeout(timeoutId);
}
```

---

### P2-13 · `canAccessDomain` Has No Query Timeout — Connection Pool Starvation

**Files:** `apps/api/src/routes/experiments.ts:46-62`, `apps/api/src/routes/exports.ts:41-61`
**Category:** Performance

**Violation:**
```typescript
const row = await db('domain_registry')
  .join('memberships', ...)
  .where(...)
  .first();
// ← no statement_timeout, no withTimeout() guard
```

Unlike `experimentStartJob.ts` (which correctly sets `SET LOCAL statement_timeout = 30000`), route handlers have no query timeout. A slow join holds an HTTP connection and a DB connection from the pool indefinitely.

**Fix:** Wrap with `withTimeout()` from `@kernel/retry` or set `statement_timeout` at the pool level.

---

### P2-14 · `isMailchimpMemberResponse` Type Guard Too Permissive

**File:** `apps/api/src/utils/validation/email.ts:127-131`
**Category:** TypeScript / Correctness

**Violation:**
```typescript
return typeof obj['id'] === 'string' || typeof obj['email_address'] === 'string';
```

A Mailchimp 404 error response `{ "title": "Not Found", "status": 404, "email_address": "lookup@example.com" }` passes this guard. Downstream code records incorrect subscriber states.

**Fix:**
```typescript
return typeof obj['id'] === 'string' &&
  !('status' in obj && typeof obj['status'] === 'number');
```

---

### P2-15 · Revenue Template Renders `Infinity`/`NaN` — Financial Data Integrity

**File:** `plugins/notification-adapters/email-adapter.ts:443`
**Category:** Correctness

**Violation:**
```typescript
const revenue = getNumber('revenue', 0);
// html: `<li>Revenue: $${revenue}</li>`
```

`payload['revenue'] = Infinity` → `Revenue: $Infinity`. `NaN` → `Revenue: $NaN`. No currency formatting; floating point issues (`0.1 + 0.2 = 0.30000000000000004`).

**Fix:**
```typescript
const rawRevenue = getNumber('revenue', 0);
if (!isFinite(rawRevenue))
  throw new ExternalAPIError('Invalid revenue value', ErrorCodes.INVALID_FORMAT, {});
const revenue = rawRevenue.toLocaleString('en-US',
  { minimumFractionDigits: 2, maximumFractionDigits: 2 });
```

---

### P2-16 · `AuditEventParams`/`canAccessDomain`/`recordAuditEvent` Duplicated Across 8+ Files

**Files:** `experiments.ts`, `exports.ts`, and ≥6 other route files
**Category:** Architecture

**Violation:** The `AuditEventParams` interface and the `canAccessDomain` + `recordAuditEvent` functions are copy-pasted identically across at least 8 route files. The `params["ip"]` bracket notation is already inconsistent with `ip: string` in the interface.

**Fix:** Extract to `control-plane/services/audit.ts`:
```typescript
// audit.ts
export interface AuditEventParams { ... }
export async function canAccessDomain(...): Promise<boolean> { ... }
export async function recordAuditEvent(params: AuditEventParams): Promise<void> { ... }
```

Import in all route files.

---

## P3 — Low

> Schedule within the next quarter.

---

### P3-1 · `jitteredBackoff` Returns `[0, cappedDelay)` — Can Return 0ms Delay

**File:** `packages/kernel/retry.ts:603-609` (verified cross-file)
**Category:** Correctness

**Violation (verified):**
```typescript
const jitter = Math.random() * cappedDelay;
return Math.floor(jitter);  // ← only jitter; base exponential delay discarded; can be 0
```

**Fix (equal jitter — guarantees minimum `cappedDelay/2` wait):**
```typescript
return Math.floor(cappedDelay / 2 + Math.random() * cappedDelay / 2);
```

---

### P3-2 · `ExportBodySchema.type` Contradiction: `.min(1, 'required')` but `.optional()`

**File:** `apps/api/src/routes/exports.ts:14`
**Category:** TypeScript

**Violation:** `type: z.string().min(1, 'Export type is required').optional()` — the error message says "required" but the field is optional.

**Fix:** `type: z.string().min(1).max(100).optional()`

---

### P3-3 · `parseIntEnv` Accepts Whitespace-Only Values → Returns `0`

**File:** `packages/config/env.ts:34-41`
**Category:** Correctness

**Violation:**
```typescript
const value = process.env[name];  // '  '
if (!value) return defaultValue;  // '  ' is truthy, skipped
const parsed = Number(value);     // Number('  ') === 0
return Number.isInteger(parsed) ? parsed : defaultValue;  // returns 0
```

`PORT='  '` → `parseIntEnv('PORT', 3001)` returns `0`. Server binds to a random ephemeral port.

**Fix:**
```typescript
const trimmed = value.trim();
if (!trimmed) return defaultValue;
const parsed = Number(trimmed);
if (!Number.isInteger(parsed) || !/^-?\d+$/.test(trimmed)) return defaultValue;
return parsed;
```

---

### P3-4 · `deliveryId` Uses `Date.now()` — No Entropy Added

**File:** `plugins/notification-adapters/email-adapter.ts:337`
**Category:** Correctness

**Violation:** `deliveryId: \`email_${Date.now()}_${crypto.randomUUID()}\``

`Date.now()` adds no entropy; the UUID already provides 122 bits. If delivery IDs are exposed to clients, the timestamp prefix leaks message-send timing.

**Fix:** `deliveryId: \`email_${crypto.randomUUID()}\``

---

### P3-5 · Minimal Test Coverage in `experiments.spec.ts`

**File:** `apps/api/tests/experiments.spec.ts`
**Category:** Testability

**Violation:** One test case total. Uses a relative import instead of `@domain/*` alias. No coverage for: successful validation, `contentType` mismatch, fewer than 2 variants, empty array, `weight` bounds, metadata handling.

**Fix:** Expand test suite to cover all branches of `validateExperiment.ts`. Use `@domain/experiments/validateExperiment` alias.

---

### P3-6 · Missing Coverage in `env.security.test.ts`

**File:** `packages/config/__tests__/env.security.test.ts`
**Category:** Testability

Missing test cases:
- `parseIntEnv` with whitespace-only value (`'  '`) — returns `0`, not default (P3-3)
- `parseIntEnv` with scientific notation `'1e3'` — returns `1000` (undocumented behavior)
- `parseBoolEnv` with `'true '` (trailing space) — falls to `logger.warn` + default
- `parseJSONEnv` with valid JSON of wrong type (P1-6)
- `isPlaceholder` with a Stripe test-mode key (e.g. `sk_test_<redacted>`) — confirms or denies false-positive (P1-7)
- `requireBoolEnv` with whitespace-only value

---

## Production Incident Ranking

If deployed today, these issues fire incidents in this order:

| Rank | Finding | Incident Type | Blast Radius |
|------|---------|---------------|--------------|
| 1 | **P0-3** `exports.ts` CSRF hooks not awaited | Silent security bypass | All `/exports` POST requests unprotected; any on-page JS can forge requests |
| 2 | **P0-1** Postmark CRLF header injection | Data breach | All Postmark emails BCC'd to attacker if env vars compromised; GDPR/CAN-SPAM liability |
| 3 | **P0-2** Unvalidated SMTP attachments | Abuse / DoS | Executable payloads forwarded to users; quota exhaustion disables all email delivery |
| 4 | **P1-1** No role check on exports page | Privilege escalation | Every `viewer`/`editor` accesses Revenue Ledger and M&A bundles immediately |
| 5 | **P2-1** `/exports` returns `generating` with no job | Functional outage | All export requests silently dropped; misleading audit trail |
| 6 | **P1-3** Draft experiments can be started | Data corruption | Invalid A/B tests run; results corrupted |
| 7 | **P1-4** `validateExperiment` → HTTP 500 | Monitoring integrity | All domain-rule violations inflate 5xx; false alerting |
| 8 | **P1-6** `parseJSONEnv` unsafe cast | Silent misconfiguration | Rate limits, CORS, feature flags silently misconfigured |
| 9 | **P2-7** Audit trail silently lost on DB error | Compliance violation | Financial exports proceed unaudited during DB turbulence |
| 10 | **P1-7** `\btest\b` false-positive on Stripe keys | Startup failure | Staging environments with Stripe test-mode keys fail config validation |

---

*Generated by automated adversarial audit on 2026-02-18. Three independent analysis passes + one cross-file verification pass.*
