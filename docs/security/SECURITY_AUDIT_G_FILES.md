# Security Audit — Files Starting with `g`

**Date:** 2026-02-18
**Auditor:** Automated hostile-code-review (two independent subagent passes + manual verification)
**Scope:** All TypeScript/TSX files whose filename starts with `g`

## Files Audited

| File | Lines |
|---|---|
| `apps/api/src/auth/oauth/gbp.ts` | 37 |
| `control-plane/adapters/keywords/gsc.ts` | 259 |
| `control-plane/api/routes/guardrails.ts` | 161 |
| `scripts/generate-openapi.ts` | 79 |
| `test/chaos/graceful-shutdown-chaos.test.ts` | 201 |
| `themes/*/templates/guide.tsx` (×5) | 10 each |
| `apps/api/tests/adapters/ga.adapter.spec.ts` | 17 |
| `apps/api/tests/adapters/gbp.adapter.spec.ts` | 9 |
| `apps/api/tests/adapters/gsc.adapter.spec.ts` | 20 |
| `apps/api/src/adapters/__tests__/google-oauth.test.ts` | 111 |

---

## CRITICAL (P0)

### P0-1 · `gbp.ts:20` · Security/Type
**`clientId` regex `^[a-zA-Z0-9_-]+$` permanently rejects all real Google OAuth client IDs.**
Real Google client IDs are formatted as `123456789012-abcdef.apps.googleusercontent.com` (contain dots). Tests use synthetic values like `test-client-id` so CI passes; production breaks on first real OAuth registration.
**Fixed:** Regex widened to `^[a-zA-Z0-9._-]+$`.

### P0-2 · `guardrails.ts:107–141` · Security
**`GET /admin/flags` exposes entire env-based feature flag landscape to any org owner.**
`featureFlags` from `@config/features` (all env-level internal flags) was merged into the response and returned to anyone with `owner` or `admin` role — any paying customer who is org-owner could enumerate internal flag names, unreleased features, and kill-switch topology.
**Fixed:** Env-based flags removed from this endpoint. The endpoint now returns only DB-backed flags (those explicitly set via the API). Env flags are for platform-internal use and must not be exposed to tenant-level roles.

### P0-3 · `guardrails.ts:70, 149` · Security
**Dead optional-chain on `ctx?.["orgId"]` after `getAuthContext` (which always throws on missing auth) creates IDOR risk.**
`getAuthContext` throws `AuthError` if unauthenticated; `ctx` is always non-null after it. The `ctx?.["orgId"]` pattern was misleading and treated format-checked UUID as an ownership check. Used `orgIdResult.data` (the Zod-validated value) for all downstream calls and added explicit validation.

---

## HIGH (P1) — Fixed

### P1-1 · `gsc.ts:35–36` · Type
**`||` operator silently swaps credentials when caller passes empty string.**
`credentials?.clientId || process.env['GSC_CLIENT_ID'] || ''` treats `''` as falsy, so an explicitly-passed empty `clientId` falls through to the env var, using a different credential than intended.
**Fixed:** `||` → `??` for all credential fallbacks.

### P1-2 · `gsc.ts:79–87` · Logic
**`exchangeCode` returned tokens but did NOT call `this.auth.setCredentials(tokens)`.**
After OAuth code exchange, the adapter instance remained unauthenticated. Any caller that invoked `exchangeCode()` and then immediately called `fetch()` on the same instance received authentication errors.
**Fixed:** `this.auth.setCredentials(tokens)` added before returning.

### P1-3 · `gsc.ts:187–195` · Type
**HTTP error codes compared as numbers but `googleapis` (gaxios) puts HTTP status on `error.response?.status`, not `error.code`.**
`errCode === 401` and `errCode === 403` were dead comparisons — Google API HTTP errors have their status on `response.status`, not on `code`. The error branches were never triggered; raw Google errors (potentially containing OAuth token fragments) leaked to callers.
**Fixed:** Error extraction now checks `error.response?.status` (HTTP status) with fallback to `error.code` (network errors).

### P1-4 · `gsc.ts:105` · Security
**User-supplied `domain` logged verbatim before sanitization.**
`domain` appeared in logs before URL normalization. A value like `https://user:password@internal.corp/secret` would expose credentials and internal hostnames in log aggregation.
**Fixed:** Domain log moved to after `siteUrl` normalization and logs the sanitized `siteUrl`.

### P1-5 · `gsc.ts:155–158` · Logic
**`|| 0` falsely treats `null`, `undefined`, and `NaN` identically; use `?? 0`.**
`|| 0` is semantically wrong for numeric defaults: `NaN || 0 === 0` silently masks data quality issues from the GSC API.
**Fixed:** All metric fields now use `?? 0`.

### P1-6 · `gsc.ts:151` · Logic
**Empty-string keywords silently persisted into downstream storage.**
GSC rows with no `keys` array or empty first element produced `keyword: ''`. These passed into `KeywordSuggestion` without filtering, polluting DB tables and corrupting keyword cardinality counts.
**Fixed:** `.filter(s => s.keyword !== '')` added after `.map()`.

### P1-7 · `gsc.ts:251–258` · Architecture
**Module-level singleton cannot be re-initialized after credential rotation.**
`let _gscAdapter: GscAdapter | undefined` lived for the process lifetime. After secret rotation, the singleton continued using revoked credentials. Documented with explicit comment; `resetGscAdapter()` export added for credential rotation support.

### P1-8 · `guardrails.ts:155` · API
**`GET /alerts` error response omitted `ErrorCodes` and Zod issues — inconsistent contract.**
`errors.badRequest(res, 'Invalid organization ID')` was missing the `ErrorCodes.VALIDATION_ERROR` and issue details present on every other call site.
**Fixed:** Full `errors.badRequest(res, ..., ErrorCodes.VALIDATION_ERROR, orgIdResult["error"].issues)` call.

### P1-9 · `guardrails.ts:41–62` · Observability
**No audit log on feature flag mutation.**
`POST /admin/flags/:key` mutated global system configuration with zero audit trail. SOC2/ISO27001 compliance requires attribution of all admin configuration changes.
**Fixed:** Structured audit log emitted after every flag set operation.

### P1-10 · `guardrails.ts:121` · Logic
**`_dbKeys` dead variable signals unimplemented merge logic.**
The dead variable indicated incomplete implementation. Merge semantics were undocumented and potentially incorrect (DB flags silently overwrote env flags without documented contract).
**Fixed:** Dead variable removed; endpoint now returns only DB flags.

### P1-11 · `guardrails.ts:86–87` · Validation
**Negative alert thresholds accepted and stored.**
`z.number().finite().safe()` allowed `-9007199254740991`. Depending on comparison direction in `AlertService.check()`, a negative threshold causes permanent alert storm or total alert suppression.
**Fixed:** `.min(0, 'Threshold must be non-negative')` added.

### P1-12 · `themes/*/templates/guide.tsx` · Security
**DOMPurify global `addHook`/`removeAllHooks` pattern creates race condition in concurrent SSR.**
`sanitizeHtml()` registered a hook then called `removeAllHooks()`. Under concurrent SSR requests, interleaved calls caused Request B's sanitization to run without the `rel="noopener noreferrer"` hook — silently losing tab-napping protection on user-generated links.
**Not fixed in this PR** (issue is in `themes/sanitize.ts`, outside the `g`-file scope). Tracked in: [TODO: create issue].

### P1-13 · `generate-openapi.ts:20, 64` · Ops
**`import.meta.url.replace('file://', '')` is incorrect path parsing.**
On Windows (`file:///C:/...`) and paths with URL-encoded characters, this produces invalid file paths. Correct Node.js API is `fileURLToPath` from `node:url`.
**Fixed:** Both occurrences replaced with `fileURLToPath(import.meta.url)`.

### P1-14 · `generate-openapi.ts:45` · Security
**Fake `sk_live_` / `pk_live_` prefixes mimic production credentials and trigger secret scanners.**
`STRIPE_SECRET_KEY: sk_live_${rnd()}` and `CLERK_SECRET_KEY: sk_live_${rnd()}` are production-format secrets. GitHub/GitGuardian fire false positives; code with `if (key.startsWith('sk_live_'))` activates production-mode behavior.
**Fixed:** Changed to `sk_test_` / `pk_test_` prefixes.

### P1-15 · `apps/api/tests/adapters/gbp.adapter.spec.ts` · Testing
**No HTTP mocks — test made real network calls to Google APIs.**
No `jest.mock('googleapis')`. `GbpAdapter.createPost` attempted real HTTPS to `mybusiness.googleapis.com`. In CI: network timeouts, flaky tests. With credentials in env: actual side-effecting API calls.
**Fixed:** `googleapis` mocked; test now verifies call parameters and response mapping.

### P1-16 · `apps/api/tests/adapters/gsc.adapter.spec.ts` · Testing
**`google.auth.OAuth2` not mocked; constructor failed before any assertion.**
The mock only stubbed `google.searchconsole`. `validateAuth()` requires `.authorize` method. Additionally `fetchSearchAnalytics({})` (empty body) failed `validateSearchAnalyticsRequest` requiring `startDate`/`endDate`. Zero regression coverage.
**Fixed:** Auth mock added; valid request body provided; call-parameter assertions added.

### P1-17 · `test/chaos/graceful-shutdown-chaos.test.ts:120` · Testing
**`vi.useRealTimers()` inside test body leaks fake timers on assertion failure.**
If any assertion before line 120 failed, the exception propagated past `vi.useRealTimers()`, leaving all subsequent tests running with fake timers active and hanging.
**Fixed:** Timer setup/teardown scoped to nested `beforeEach`/`afterEach` inside the `Handler Timeout` describe block.

---

## MEDIUM (P2) — Fixed in this PR

| ID | File | Description | Fix |
|---|---|---|---|
| P2-1 | `gsc.ts:125` | `split('T')[0] as string` suppresses `noUncheckedIndexedAccess` | Changed to `.slice(0, 10)` |
| P2-2 | `gsc.ts:60` | OAuth state not validated for minimum entropy | Added length check |
| P2-3 | `gsc.ts:209` | `listSites` returned empty strings for null `siteUrl` | Used `flatMap` with guard |
| P2-6 | `gbp.ts` | Missing `prompt: consent` loses refresh token on re-authorization | Added to URL params |
| P2-7 | `gbp.ts` | `GBP_OAUTH_SCOPES` mutable exported array (scope escalation) | `Object.freeze` + `as const` |
| P2-8 | `guardrails.ts:13` | Hyphens in flag keys can collide with underscore env var names | Documented; no regex change (hyphens allowed by design) |
| P2-9 | `guardrails.ts:96` | Cannot distinguish "disabled" from "non-existent" flag | Documented as known limitation |
| P2-10 | `guardrails.ts` | Per-request Zod schema instantiation | Hoisted `OrgIdSchema` to module scope |
| P2-13 | `generate-openapi.ts` | Non-atomic file write leaves partial JSON on kill | Write-to-tmp + rename |
| P2-14 | `generate-openapi.ts:75` | `${err}` drops stack trace in CI | Fixed to `err instanceof Error ? err.stack : String(err)` |
| P2-15 | `gsc.ts:93` | `setRefreshToken` accepted empty string | Added `validateNonEmptyString` |
| P2-16 | `ga.adapter.spec.ts` | `runReport` mock returned wrong shape; test asserted on mock artifact | Fixed mock shape |

---

## MEDIUM (P2) — Tracked, Not Fixed Here

| ID | File | Description |
|---|---|---|
| P2-4 | `gsc.ts:221` | `healthCheck()` calls `listSites()` — expensive API call on every health tick |
| P2-5 | `gbp.ts:21` | `redirectUri` validated by prefix only — no allowlist |
| P2-11 | `themes/*/guide.tsx` | Five byte-for-byte identical template files — DRY violation |
| P2-12 | `themes/sanitize.ts` | `href` allows `javascript:` URIs (DOMPurify config gap) |

---

## LOW (P3) — Tracked

- `gsc.ts`, `gbp.ts`: `throw new Error(...)` throughout — must be `ValidationError`/`AppError` subclasses per `CLAUDE.md`
- `gsc.ts`: Dual `GscAdapter` implementations (`control-plane` vs `apps/api`) with incompatible APIs
- `guardrails.ts:107`: `GET /admin/flags` handler missing `res` parameter (cannot return structured errors from thrown exceptions)
- `themes/sanitize.ts`: `export { DOMPurify }` exposes global mutable instance
- `generate-openapi.ts`: `app.close()` not called in error path
- `graceful-shutdown-chaos.test.ts:86`: Exit code 0 on handler failure needs documentation

---

## Production Incident Risk Ranking

| Rank | ID | Blast Radius |
|---|---|---|
| 1 | **P0-1** `gbp.ts:20` | All GBP OAuth broken — real Google client IDs rejected. Feature dead in prod. |
| 2 | **P0-2** `guardrails.ts:107` | Any org-owner enumerates full internal feature flag set. |
| 3 | **P1-2** `gsc.ts:79` | GSC OAuth callback succeeds; adapter stays unauthenticated. Empty keyword data. |
| 4 | **P1-3** `gsc.ts:187` | GSC 401/403 errors raw-rethrown; potential token fragments in error responses. |
| 5 | **P1-12** `sanitize.ts` | Intermittent loss of `rel="noopener noreferrer"` under SSR concurrency. |
| 6 | **P0-3** `guardrails.ts:70` | IDOR risk — org validation is format-only, not ownership check. |
| 7 | **P1-7** `gsc.ts:251` | Singleton uses revoked credentials after rotation. |
| 8 | **P1-9** `guardrails.ts:41` | No audit trail for flag mutations — compliance failure. |
| 9 | **P2-6** `gbp.ts` | No `prompt=consent` — users who revoke GBP cannot reconnect. |
| 10 | **P1-17** `chaos.test.ts:120` | Fake timer leak hides real test failures in CI. |
