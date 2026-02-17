# Comprehensive Code Review — SmartBeak
**Date**: 2026-02-17
**Reviewer**: Claude Code
**Branch**: `claude/code-review-plan-BY6HK`
**Scope**: Full codebase (control-plane, domains, packages, apps)

---

## Executive Summary

The SmartBeak codebase has a well-structured monorepo architecture with strong TypeScript conventions and good security primitives. However, the review uncovered **5 critical functional bugs** (routes that are completely broken or return wrong data), **5 high-severity security issues**, and **15+ medium/low issues** covering error handling, rate limiting correctness, TypeScript violations, and code quality.

Issues are grouped by severity and tagged with affected files and line numbers.

---

## Critical Severity — Broken Functionality

These issues cause routes to fail or silently return wrong data for every request.

### CRIT-1: All publishing routes return 400 (`ctx.domainId` always undefined)
**File**: `control-plane/api/routes/publishing.ts:33,45,63`
**Root cause**: `JwtClaimsSchema` (`packages/security/jwt.ts:37–49`) has no `domainId` field. The auth context (`AuthContext`) only carries `userId`, `orgId`, `roles`, `sessionId`. Therefore `ctx["domainId"]` is always `undefined`, and every call to `GET /publishing/targets`, `POST /publishing/targets`, `GET /publishing/jobs` immediately returns `400 "Domain ID is required"`.
**Fix**: Remove the `domainId` guard. The domain should be a query/body parameter, validated with Zod and checked against org ownership via DB, not sourced from the JWT.

### CRIT-2: SQL syntax error in media ownership check
**File**: `control-plane/api/routes/media.ts:29`
**Root cause**: The raw SQL string contains `m["id"] = $1` — JavaScript bracket notation inside a SQL string literal. PostgreSQL will reject this with a syntax error, making `POST /media/:id/complete` always throw.
**Fix**: Change to `m.id = $1`.

### CRIT-3: Wrong table name in analytics ownership check
**File**: `control-plane/api/routes/analytics.ts:37`
**Root cause**: The query reads `FROM content c JOIN domains d ON c.domain_id = d.id WHERE c.id = $1 AND d.org_id = $2`. The table `content` does not exist; the correct name is `content_items` (as corrected in `content.ts` with comment `C4-FIX`). Every `GET /analytics/content/:id` call throws a PostgreSQL "relation does not exist" error.
**Fix**: Change `FROM content c` → `FROM content_items c`.

### CRIT-4: Search results never included in response
**File**: `control-plane/api/routes/search.ts:49–58`
**Root cause**: `const _results = await svc.search(q, limit, offset, ctx)` — the underscore prefix marks the variable as intentionally unused. The response object returned at line 54 only contains `{ pagination: { totalPages } }` — zero results are ever returned to the client.
**Fix**: Include `_results` (rename to `results`) in the response body.

### CRIT-5: `ContentItem.updateDraft()` silently ignores title and body
**File**: `domains/content/domain/entities/ContentItem.ts:129–145`
**Root cause**: The method signature is `updateDraft(_title: string, _body: string)` — both parameters are underscore-prefixed (unused). The method body builds `updates: Partial<ContentItemProps>` containing only `updatedAt` (and optionally a status/publishAt reset). Title and body are never written into `updates`. Every `PATCH /content/:id` call persists no content changes.
**Fix**: Apply `_title` and `_body` to the `updates` object:
```typescript
updates.title = _title;
updates.body  = _body;
```

---

## High Severity — Security Issues

### HIGH-1: Unsafe `req.auth as AuthContext` cast (no type guard)
**Files**:
- `control-plane/api/routes/seo.ts:43`
- `control-plane/api/routes/search.ts:26`
- `control-plane/api/routes/roi-risk.ts:22`

**Root cause**: These routes use `const ctx = req.auth as AuthContext` — a bare TypeScript cast with no runtime type guard. If auth middleware fails silently or `req.auth` is `undefined`, the cast succeeds at compile time but `ctx` is `undefined` at runtime. The `if (!ctx)` guard at the next line does catch this, but only because `undefined` is falsy. The pattern is fragile and inconsistent.
The canonical safe pattern is already defined in `control-plane/api/types.ts:32–37` (`getAuthContext(req)`) and is used correctly in `content.ts`, `publishing.ts`, `billing.ts`, and `analytics.ts`.
**Fix**: Replace bare casts with `getAuthContext(req)` (which throws on missing auth) or `getOptionalAuthContext(req)` for optional-auth routes.

### HIGH-2: Route params used without Zod validation
**File**: `control-plane/api/routes/roi-risk.ts:29`
**Root cause**: `const { assetId } = req.params as { assetId: string }` — unsafe cast. If the router passes a non-string or the parameter name changes, this silently passes `undefined` into the ownership query, potentially causing unintended data access.
**Fix**: Add a Zod params schema (`z.object({ assetId: z.string().uuid() })`) and use `.safeParse(req.params)`.

### HIGH-3: Rate limiting uses global shared keys (per-endpoint, not per-user/IP)
**Files**:
- `control-plane/api/routes/publishing.ts:31,43,51,73,99` — `rateLimit('publishing', N)`
- `control-plane/api/routes/search.ts:31` — `rateLimit('search', 30)`
- `control-plane/api/routes/seo.ts:48` — `rateLimit('content', 50)`
- `control-plane/api/routes/roi-risk.ts:27` — `rateLimit('roi-risk', 50)`
- `control-plane/api/routes/diligence.ts:29,102` — `rateLimit('diligence', 30)`

**Root cause**: The 2-arg overload `rateLimit(identifier, limit)` builds the key as `ratelimit:global:<identifier>`. When `identifier` is a static string like `'publishing'`, ALL users share the same rate limit bucket. A single user can exhaust the limit for everyone, enabling DoS. The `content.ts` routes correctly pass `req` and `res` as the 3rd/4th args (which use `ratelimit:api:content` as the key), but this is still not per-user/IP.
**Fix**: Pass a user-scoped or IP-scoped identifier: `rateLimit(ctx.userId || getClientIp(req), limit, req, res)` for authenticated routes, or extract the client IP for unauthenticated routes.

### HIGH-4: Three publishing routes have no error handling
**File**: `control-plane/api/routes/publishing.ts:27–68`
**Root cause**: `GET /publishing/targets`, `POST /publishing/targets`, and `GET /publishing/jobs` have no `try/catch`. Any thrown exception (DB failure, service error, etc.) escapes Fastify's route handler without a structured response, potentially leaking a stack trace or crashing the process.
**Fix**: Wrap each handler in `try/catch` with `errors.internal(res)` fallback, matching the pattern in adjacent routes.

### HIGH-5: Analytics route has no error handling
**File**: `control-plane/api/routes/analytics.ts:21–45`
**Root cause**: Same as HIGH-4. The `GET /analytics/content/:id` handler has no try/catch. Any DB error propagates uncaught.
**Fix**: Add try/catch around the handler body.

---

## Medium Severity — Bugs & Policy Violations

### MED-1: `POST /content` runs auth before rate limit (reversed order)
**File**: `control-plane/api/routes/content.ts:196–199`
**Root cause**: `GET /content` has an explicit comment "P1-11 FIX: Rate limit BEFORE auth to prevent CPU exhaustion via JWT verification DDoS." The fix is correct there. However `POST /content` at line 198 calls `getAuthContext(req)` first, then `rateLimit(...)` at line 199. This reintroduces the vulnerability for write operations.
**Fix**: Move `await rateLimit(...)` to before `getAuthContext(req)` on `POST /content`, `PATCH /content/:id`, `POST /content/:id/publish`, and `DELETE /content/:id`.

### MED-2: Zod error handling uses unsafe `as` cast instead of `ZodError`
**File**: `control-plane/api/routes/content.ts:214–221, 261–268, 305–325, 370–377`
**Root cause**: When `.parse()` throws, the catch block does `const zodError = validationError as { issues?: Array<...> }`. This is an unsafe cast — the thrown error might not have `.issues`. The correct pattern is either use `.safeParse()` (already done in other handlers in the same file) or check `instanceof ZodError`.
**Fix**: Replace `.parse()` + catch with `.safeParse()` + `if (!result.success)` checks consistently across all handlers in `content.ts`.

### MED-3: Pagination responses missing `total` count
**Files**:
- `control-plane/api/routes/content.ts:184–187`
- `control-plane/api/routes/notifications.ts:112–114`

**Root cause**: Both return `{ pagination: { totalPages } }` but not `total`. API clients generally need the raw total count to render pagination UI and know how many items exist.
**Fix**: Add `total` to the pagination object: `{ totalPages: Math.ceil(total / limit), total }`.

### MED-4: Internal error messages exposed through handler result types
**Files**:
- `domains/content/application/handlers/CreateDraft.ts:71`
- `domains/content/application/handlers/UpdateDraft.ts:88`

**Root cause**: Both handlers return `{ success: false, error: error instanceof Error ? error.message : 'Failed...' }`. The DB/domain error message ends up in the result object. While the route layer catches this and calls `errors.internal(res)`, the pattern of returning error messages in results creates a risk that future callers will surface them to clients.
**Fix**: Return a generic message: `{ success: false, error: 'Operation failed' }` and log the detail server-side. The handler should only expose the success/failure signal, not the internal reason.

### MED-5: `console.log` / `console.error` in production source files
**Files** (non-test, non-script files):
- `domains/search/application/SearchIndexingService.ts`
- `control-plane/api/routes/queues.ts`
- `control-plane/api/routes/queue-metrics.ts`
- `apps/api/src/db.ts`
- `apps/api/src/middleware/csrf.ts`
- `packages/kernel/redlock.ts`
- `packages/security/keyRotation.ts`

**Root cause**: CLAUDE.md prohibits `console.log`; use `getLogger('...').info/warn/error` instead. Console statements bypass the structured logger's auto-redaction of sensitive fields (tokens, passwords, API keys), bypass log level control, and cannot be parsed by log aggregation tooling.
**Fix**: Replace each occurrence with an appropriate `getLogger(...)` call.

### MED-6: `seo.ts` rate limit uses wrong namespace
**File**: `control-plane/api/routes/seo.ts:48`
**Root cause**: `rateLimit('content', 50)` uses the `'content'` identifier for SEO requests. This means SEO update attempts count against the `content` bucket and vice versa, making rate limit enforcement unpredictable.
**Fix**: Change to `rateLimit('seo', 50, req, res)` (or a user-scoped key).

### MED-7: `roi-risk.ts` returns hardcoded fallback data
**File**: `control-plane/api/routes/roi-risk.ts:100–108`
**Root cause**: When `riskFactors.length === 0`, the route returns three hardcoded fake entries:
```js
{ name: 'Traffic Concentration', level: 'medium', score: 45 }, ...
```
Similarly for `recommendations`. This silently serves fabricated data as if it were real analytics, which could mislead users.
**Fix**: Return empty arrays when no data exists; let the frontend handle the empty state.

### MED-8: `PATCH /content/:id` makes two round-trips for the same record
**File**: `control-plane/api/routes/content.ts:330–343`
**Root cause**: The route fetches `item` for ownership verification (line 330), then `UpdateDraft.execute()` fetches the same item again from the DB (line 62 in `UpdateDraft.ts`). Two unnecessary round-trips per update.
**Fix**: Thread the already-fetched `item` through to the handler, or merge the ownership check into the handler query.

---

## Low Severity — Code Quality & Consistency

### LOW-1: Missing `.strict()` on Zod request schemas
**Files**:
- `control-plane/api/routes/content.ts:26` — `CreateContentSchema`
- `control-plane/api/routes/content.ts:38` — `UpdateContentSchema`
- `control-plane/api/routes/publishing.ts:15` — `TargetBodySchema`

**Root cause**: CLAUDE.md mandates `.strict()` on Zod object schemas to reject extra properties. Without it, extra fields in the request body are silently stripped, which can mask client bugs.
**Fix**: Add `.strict()` to each schema.

### LOW-2: Inconsistent auth context access pattern
**Root cause**: Routes use three different patterns:
1. `getAuthContext(req)` — correct, type-safe (content.ts, billing.ts, analytics.ts)
2. `const { auth: ctx } = req as AuthenticatedRequest` — safe with the type definition (orgs.ts, media.ts, notifications.ts)
3. `const ctx = req.auth as AuthContext` — bare unsafe cast (seo.ts, search.ts, roi-risk.ts)

**Fix**: Standardize on pattern 1 (`getAuthContext(req)`) across all routes, as it provides a clear throw-on-missing semantic.

### LOW-3: `search.ts` parses `page` twice
**File**: `control-plane/api/routes/search.ts:40`
**Root cause**: The Zod schema already validates and coerces `page` into `parseResult.data.page`, but line 40 re-parses `page` from the raw query string. This makes the schema validation for `page` redundant.
**Fix**: Use `parseResult.data.page` directly.

### LOW-4: `UpdateDraft.validateInputs` allows empty ID
**File**: `domains/content/application/handlers/UpdateDraft.ts:109`
**Root cause**: `if (id.length < 1)` is unreachable because the previous check `if (!id ...)` already catches falsy/empty strings.
**Fix**: Remove the redundant check.

### LOW-5: `listByStatus` without `orgId` filter can leak cross-tenant data
**File**: `domains/content/infra/persistence/PostgresContentRepository.ts:257–265`
**Root cause**: When `domainId` is not provided, `listByStatus` queries `content_items WHERE status = $1` with no domain or org scoping. Any caller that passes `undefined` for `domainId` would receive content from all organizations.
**Fix**: Require either `domainId` or `orgId`, and make that parameter non-optional at the type level.

### LOW-6: Module-level mutable key cache in `jwt.ts`
**File**: `packages/security/jwt.ts:242–244`
**Root cause**: `let currentKeys = getKeys()` at module load time is fine in production but causes test isolation issues — if one test modifies env vars, subsequent tests may use stale keys. The 60-second reload interval also means a fresh test run shares state.
**Fix**: Add a `resetForTests()` export (or mock the module), or call `reloadKeys()` in test setup.

---

## Implementation Plan

Issues are ordered by priority. Each fix is self-contained and can be implemented independently.

### Phase 1 — Critical Fixes (implement first, unblocks features)

| # | Issue | File(s) | Effort |
|---|-------|---------|--------|
| P1-1 | CRIT-1: Remove `domainId` from publishing auth guard; accept as query param | `publishing.ts` | S |
| P1-2 | CRIT-2: Fix SQL `m["id"]` → `m.id` | `media.ts:29` | XS |
| P1-3 | CRIT-3: Fix table name `content` → `content_items` in analytics | `analytics.ts:37` | XS |
| P1-4 | CRIT-4: Return `results` in search response | `search.ts:49–58` | XS |
| P1-5 | CRIT-5: Apply title/body in `updateDraft()` | `ContentItem.ts:134–145` | XS |

### Phase 2 — High Security Fixes

| # | Issue | File(s) | Effort |
|---|-------|---------|--------|
| P2-1 | HIGH-1: Replace bare `req.auth as AuthContext` with `getAuthContext(req)` | `seo.ts`, `search.ts`, `roi-risk.ts` | XS |
| P2-2 | HIGH-2: Add Zod validation for `assetId` param | `roi-risk.ts:29` | XS |
| P2-3 | HIGH-3: Scope rate limit keys to user/IP | `publishing.ts`, `search.ts`, `seo.ts`, `roi-risk.ts`, `diligence.ts` | S |
| P2-4 | HIGH-4: Add try/catch to three publishing routes | `publishing.ts:27–68` | XS |
| P2-5 | HIGH-5: Add try/catch to analytics route | `analytics.ts:21–45` | XS |

### Phase 3 — Medium Fixes

| # | Issue | File(s) | Effort |
|---|-------|---------|--------|
| P3-1 | MED-1: Move rate limit before auth on write content routes | `content.ts:196–411` | XS |
| P3-2 | MED-2: Replace `.parse()` + cast with `.safeParse()` in content.ts | `content.ts:212–325` | S |
| P3-3 | MED-3: Add `total` to pagination responses | `content.ts:184`, `notifications.ts:112` | XS |
| P3-4 | MED-4: Sanitize handler error messages | `CreateDraft.ts:71`, `UpdateDraft.ts:88` | XS |
| P3-5 | MED-5: Replace `console.log` with structured logger | 7 files | S |
| P3-6 | MED-6: Fix SEO rate limit namespace | `seo.ts:48` | XS |
| P3-7 | MED-7: Remove hardcoded fallback data in roi-risk | `roi-risk.ts:100–108` | XS |
| P3-8 | MED-8: Eliminate double-fetch in PATCH /content/:id | `content.ts:330–343` | M |

### Phase 4 — Low Priority Cleanup

| # | Issue | File(s) | Effort |
|---|-------|---------|--------|
| P4-1 | LOW-1: Add `.strict()` to 3 Zod schemas | `content.ts`, `publishing.ts` | XS |
| P4-2 | LOW-2: Standardize auth context access to `getAuthContext(req)` | All routes | S |
| P4-3 | LOW-3: Use `parseResult.data.page` in search route | `search.ts:40` | XS |
| P4-4 | LOW-4: Remove unreachable check in `UpdateDraft.validateInputs` | `UpdateDraft.ts:109` | XS |
| P4-5 | LOW-5: Make orgId/domainId required in `listByStatus` | `PostgresContentRepository.ts:225` | S |

---

## Effort Key
- **XS** — < 5 lines changed, < 15 min
- **S** — < 30 lines, < 1 hour
- **M** — < 100 lines, < 3 hours

## Files Requiring the Most Attention

1. `control-plane/api/routes/content.ts` — P1-5, MED-1, MED-2, MED-3
2. `control-plane/api/routes/publishing.ts` — CRIT-1, HIGH-3, HIGH-4
3. `control-plane/api/routes/search.ts` — CRIT-4, HIGH-1, HIGH-3
4. `domains/content/domain/entities/ContentItem.ts` — CRIT-5
5. `control-plane/api/routes/analytics.ts` — CRIT-3, HIGH-5

---

## What Is Already Well-Done

- JWT implementation (`packages/security/jwt.ts`): algorithm allowlist, constant-time comparison, key rotation, Zod claim validation, PEM key detection.
- SSRF protection (`packages/security/ssrf.ts`): comprehensive IP blocklist, DNS rebinding protection via `validateUrlWithDnsCheck`, encoded-IP bypass prevention.
- Error handling infrastructure (`packages/errors/index.ts`): well-structured AppError hierarchy, `sanitizeErrorForClient`, proper NODE_ENV gating.
- Domain entity design (`ContentItem.ts`): immutable update pattern, lifecycle state machine, validation in constructor.
- Parameterized queries throughout — no raw string interpolation in SQL.
- IDOR protection in `orgs.ts`: explicit `ctx.orgId !== id` check with audit log.
- Auth middleware: `owner` role included in hierarchy, no silent defaulting of missing roles.
