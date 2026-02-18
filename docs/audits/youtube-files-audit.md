# Security & Code Quality Audit — Files Starting with `y`

**Date:** 2026-02-18
**Scope:** 8 files — `YouTubeAdapter.ts`, `youtubeImageAnalytics.ts`, `youtubeAnalytics.ts`,
`youtubeCanary.ts`, and their four spec files.
**Dependency chain examined:** `@config`, `@kernel/retry`, `@kernel/logger`, `@errors`,
`@kernel/request`, `validateNonEmptyString`, `runMediaCanary`, `emitMetric`.

---

## CRITICAL (P0) — Production Outage / Data Loss Imminent

None found. Previous audit cycles addressed the most severe issues (the `dimensions` parameter
data-loss bug, response-body TCP leaks, etc.).

---

## HIGH (P1)

### P1-1 — Wrong HTTP Status Code Causes Retry Loop on Schema Failures

**File:** `youtubeAnalytics.ts:155`
**Category:** Async/Concurrency, Performance

```typescript
throw new ApiError('Invalid response format from YouTube Analytics API', 500);
```

`@kernel/retry`'s `retryableStatuses = [408, 429, 500, 502, 503, 504]`. Status 500 is
retryable. `withRetry({ maxRetries: 3 })` with no `shouldRetry` override retries schema
validation failures **three additional times**, each burning real quota.

Compare: `YouTubeAdapter.ts:223` and `:305` correctly use **422** for identical failures.

**Fix:**
```typescript
// BEFORE:
throw new ApiError('Invalid response format from YouTube Analytics API', 500);
// AFTER:
throw new ApiError('Invalid response format from YouTube Analytics API', 422);
```

**Risk:** During any YouTube Analytics API schema change, 4× quota burn per call.
Possible 24h quota ban banning the entire application.

---

### P1-2 — Test Mock Targets Wrong Module — Adapter Tests May Run Against Real Implementation

**File:** `youtube.adapter.spec.ts:10`
**Category:** Testability

```typescript
vi.mock('../../src/utils/request', () => { ... });
```

`YouTubeAdapter.ts` imports from `@kernel/request` (a package alias), not from the
`../../src/utils/request` shim. If Vitest resolves these as different module identities,
the mock is not applied and the real `StructuredLogger`/`MetricsCollector` initialise,
potentially requiring env vars absent in CI.

**Fix:**
```typescript
vi.mock('@kernel/request', () => { ... });
```

**Risk:** Real infrastructure classes run in unit tests; env-var requirement changes break
entire unit test suite with cryptic errors.

---

### P1-3 — `ApiError` Defined in Adapter, Imported by Analytics — Inverted Dependency

**File:** `youtubeAnalytics.ts:8`
**Category:** Architecture, Dependency Direction

```typescript
import { ApiError } from '../../adapters/youtube/YouTubeAdapter';
```

Analytics code imports from an adapter implementation. `ApiError` belongs in `@errors` or a
shared HTTP utility module.

**Fix:** Move `ApiError` (extending `AppError` from `@errors`) to a shared location; import
from there in both files.

**Risk:** Adapter refactor silently breaks analytics ingestion at runtime with
module-not-found errors.

---

### P1-4 — `getVideo` Allows Empty `parts` Array — Guaranteed API Error, Not Validated

**File:** `YouTubeAdapter.ts:248-258`
**Category:** Validation, Performance

If `parts = []`, the allowlist loop never executes, validation passes, and
`url.searchParams.append('part', '')` sends an empty `part=` to the YouTube API which
returns 400.

**Fix:** Add after the loop:
```typescript
if (parts.length === 0) {
  throw new ValidationError('parts array must contain at least one valid part name', ErrorCodes.VALIDATION_ERROR);
}
```

**Risk:** Callers passing empty parts array receive a confusing 400 ApiError instead of a
clear validation message.

---

## MEDIUM (P2)

### P2-1 — `healthCheck` Consumes 1 Quota Unit Per Call — 8,640 Units/Day as Canary

**File:** `YouTubeAdapter.ts:351`
**Category:** Performance, Resource

`channels.list` costs 1 quota unit. At 10-second canary intervals: 8,640 units/day = 86.4%
of the 10,000-unit daily budget, leaving 1,360 units for real application use.

**Fix:** Add a 60-second TTL cache for health check results, or use a quota-free endpoint.

---

### P2-2 — `sanitizeVideoIdForLog` Duplicated With Inconsistent Behavior

**File:** `YouTubeAdapter.ts:116-119` and `youtubeAnalytics.ts:194-196`
**Category:** Architecture, Security

Analytics version returns `''` (invisible in logs) for all-special-char input; adapter
version returns `'<invalid>'`. Extract to a shared utility and use the fallback version
everywhere.

---

### P2-3 — `as` Cast Without Zod Validation in `healthCheck` 403 Body Parsing

**File:** `YouTubeAdapter.ts:378`
**Category:** Type Safety

```typescript
const body = JSON.parse(responseBody) as { error?: { errors?: Array<{ reason?: string }> } };
```

Violates the project's "Zod for all parsing" rule. Safe today due to optional chaining, but
a debugging blind spot on API format changes.

**Fix:** Use `YouTubeErrorBodySchema.safeParse(JSON.parse(responseBody))`.

---

### P2-4 — Inconsistent Logger Abstraction — 4-Arg `logger.error` Call Silently Drops Metadata

**File:** `YouTubeAdapter.ts:191-196`
**Category:** Architecture, Observability

`StructuredLogger` is imported from `@kernel/request`. If its `error` signature matches
`@kernel/logger`'s `Logger.error(message, err?, metadata?)`, then the 4-argument calls in
`YouTubeAdapter.ts` (`logger.error(message, context, new Error(...), { ... })`) put `context`
in the `err` slot and `new Error(...)` in the `metadata` slot — the actual metadata object
(HTTP status, body, videoId) is **silently dropped on every error**.

**Fix:** Migrate to `getLogger` from `@kernel/logger` (per CLAUDE.md), fix all call sites to
3-argument form.

---

### P2-5 — Raw `Error` Thrown Instead of `AppError` Subclasses

**File:** `YouTubeAdapter.ts:256, 324`; `youtubeAnalytics.ts:88, 91, 107`
**Category:** Architecture, Security

CLAUDE.md mandates `AppError` subclasses with `ErrorCodes`. Raw `Error` objects bypass
`sanitizeErrorForClient()` and may expose stack traces in HTTP responses.

**Fix:** Replace with `ValidationError`, `NotFoundError` etc. from `@errors`.

---

### P2-6 — No Circuit Breaker for YouTube API

**File:** `YouTubeAdapter.ts:161, 262`; `youtubeAnalytics.ts:103`
**Category:** Resilience

`@kernel/retry` exports `CircuitBreaker`. Without it, quota-exhaustion (403) events cause
every subsequent call to make a real HTTP round-trip before failing, burning connection pool
slots.

**Fix:** Instantiate `CircuitBreaker('youtube-api', { failureThreshold: 5, resetTimeoutMs: 60_000 })`
and wrap `withRetry` calls with it.

---

### P2-7 — Orphaned `healthCheck` Promise After Canary Timeout

**File:** `youtubeCanary.ts:40-50`
**Category:** Async/Concurrency, Resource

After `Promise.race` timeout fires, `adapter.healthCheck()` continues for up to
`DEFAULT_TIMEOUTS.short` (5s) more. At high canary frequencies, orphaned promises accumulate
holding TCP connections. Documented as a known gap requiring `AbortSignal` in
`CanaryAdapter.healthCheck()`.

---

### P2-8 — `withRetry` Not Given AbortSignal — Outer Cancellation Ignored

**File:** `YouTubeAdapter.ts:161, 262`; `youtubeAnalytics.ts:103`
**Category:** Async/Concurrency

Without a `signal`, client disconnects leave retry loops running for up to
`maxRetries × timeoutMs` = 90 seconds, burning quota and holding connections.

**Fix:** Thread `signal?: AbortSignal` through adapter methods and pass to `withRetry`.

---

## LOW (P3)

### P3-1 — Spec Files Use Vitest; CLAUDE.md Mandates Jest for Unit Tests

All 4 spec files use `import { vi, ... } from 'vitest'`. Unit test coverage is not counted
by Jest; branch/line thresholds can pass on paper while these tests provide no counted
coverage.

### P3-2 — Redundant `clearTimeout` in `updateMetadata` Finally Block

`YouTubeAdapter.ts:217` clears timeout before `json()` (intentional); `finally` at line
226-228 also clears it (harmless but confusing). Add a comment explaining intent.

### P3-3 — `computeYouTubeThumbnailCtr` Uses `z.input` Instead of `z.output`

`youtubeImageAnalytics.ts:10`. Semantically correct type is `z.output`. Currently identical
since no transforms exist, but diverges if transforms are ever added.

### P3-4 — `getVideo` videoId Not Validated Against YouTube Regex

`YouTubeAdapter.ts:251`. Analytics module uses `YOUTUBE_VIDEO_ID_REGEX`; adapter only checks
non-empty. Inconsistent defence-in-depth.

### P3-5 — Token Factory Retry Test Is Brittle

`youtube.adapter.spec.ts:385-411`. Manually re-implements retry logic in a mock. Use a Vitest
spy wrapping the real `withRetry` with `initialDelayMs: 0`.

---

## Blast Radius Ranking

| Rank | Issue | File:Line | Blast Radius |
|------|-------|-----------|--------------|
| 1 | P1-1 — Schema failure → 4× quota on API degradation | `youtubeAnalytics.ts:155` | All YT Analytics ingestion stops; possible 24h quota ban |
| 2 | P2-1 — Health check burns 86% of daily quota | `YouTubeAdapter.ts:351` | Quota exhaustion blocks all real YT operations |
| 3 | P2-4 — Logger 4-arg call drops error metadata silently | `YouTubeAdapter.ts:191` | Debugging impossible during incidents |
| 4 | P1-2 — Test mock targets wrong module | `youtube.adapter.spec.ts:10` | Unit test isolation lost; suite breaks on infra changes |
| 5 | P1-3 — Analytics imports from adapter | `youtubeAnalytics.ts:8` | Adapter refactor silently breaks analytics at runtime |
| 6 | P2-6 — No circuit breaker | All withRetry call sites | Quota bans cause N× connection-pool burn |
| 7 | P2-8 — Missing AbortSignal on retry | All withRetry call sites | 90s zombie retries under client disconnect load |
| 8 | P1-4 — Empty parts[] not caught | `YouTubeAdapter.ts:258` | Confusing 400 errors for callers |

---

## Summary

| Priority | Count |
|----------|-------|
| P0 Critical | 0 |
| P1 High | 4 |
| P2 Medium | 8 |
| P3 Low | 5 |
| **Total** | **17** |

The three highest-impact issues (P1-1, P2-1, P2-4) together represent a plausible path to
complete YouTube API quota exhaustion and invisible incident response in production without
any unusual traffic pattern.
