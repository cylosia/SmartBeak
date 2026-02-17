# Comprehensive Code Review: SmartBeak

**Date:** 2026-02-17
**Reviewer:** Claude Code

## Context

SmartBeak is a TypeScript monorepo (Fastify 5 API + Next.js 15 frontend + BullMQ worker) for content management with multi-tenant org isolation, domain management, publishing pipelines, and billing. The codebase follows DDD patterns with ~120 SQL migrations, 14 domain modules, and 14 shared packages. This review covers security, architecture, correctness, consistency, and maintainability.

---

## Executive Summary

The codebase demonstrates **strong security fundamentals** — many critical vulnerabilities have already been identified and fixed (noted via `P0-FIX`, `P1-FIX` comments). TypeScript strict mode is fully enforced, error handling is well-structured, and the DDD architecture is clean. The main issues found are **consistency gaps** across route handlers, **a few residual bugs**, and **some dead/redundant code**.

**Severity counts:** 3 High, 8 Medium, 10 Low

---

## HIGH Severity

### H1. `verifyToken` is synchronous but `authFromHeader` awaits it

**File:** `packages/security/jwt.ts:299` / `control-plane/services/auth.ts:153`

`verifyToken()` is declared as a regular function returning `JwtClaims` (not a Promise), yet `authFromHeader()` uses `await verifyToken(token)`. This works today because `await` on a non-Promise is a no-op, but it's misleading and fragile — if `verifyToken` ever becomes async (e.g., for remote key fetching), callers that don't `await` would silently break.

**Fix:** Either make `verifyToken` explicitly `async` or remove the `await` in `authFromHeader`.

---

### H2. `DatabaseError.fromDBError` computes `_code` but never uses it

**File:** `packages/errors/index.ts:286`

```typescript
let _code: string = ErrorCodes.DATABASE_ERROR;
// ... _code is reassigned but never read
return new DatabaseError(sanitizedMessage, { ... });
```

The computed `_code` (which distinguishes CONNECTION_ERROR, QUERY_TIMEOUT, DUPLICATE_ENTRY) is discarded. The `DatabaseError` always uses `ErrorCodes.DATABASE_ERROR` from its constructor. This means clients receive the same error code regardless of the failure type, making it impossible to differentiate between a connection timeout and a duplicate key violation.

**Fix:** Pass `_code` as the error code to the `DatabaseError` constructor (requires adding a `code` parameter to the `DatabaseError` constructor or passing it to the `AppError` parent).

---

### H3. `ConflictError` uses `DUPLICATE_ENTRY` instead of `CONFLICT` error code

**File:** `packages/errors/index.ts:327`

```typescript
export class ConflictError extends AppError {
  constructor(message = 'Resource conflict', details?: unknown) {
    super(message, ErrorCodes.DUPLICATE_ENTRY, 409, details);
    //                       ^^^^^^^^^^^^^^^ should be CONFLICT
  }
}
```

`ConflictError` is semantically about resource conflicts (optimistic concurrency, state machine violations), not duplicate database entries. Using `DUPLICATE_ENTRY` conflates two distinct error conditions and makes client-side error handling unreliable.

**Fix:** Change to `ErrorCodes.CONFLICT`.

---

## MEDIUM Severity

### M1. Inconsistent `row.name` vs `row["id"]` — mixed dot and bracket notation

**File:** `control-plane/api/routes/domains.ts:122-130`

```typescript
const domains = rows.map(row => ({
  id: row["id"],       // bracket
  name: row.name,      // dot
  status: row.status,  // dot
```

The project requires bracket notation for index-signature types (`noPropertyAccessFromIndexSignature`). The `pg` library's `QueryResultRow` uses an index signature, so **all** property accesses on query result rows should use bracket notation. Some rows use dot notation (`row.name`, `row.status`) which would fail if the TypeScript config is enforced on these files.

**Fix:** Consistently use `row["name"]`, `row["status"]`, etc. throughout all route files.

---

### M2. Redundant domain ownership check in GET `/domains/:domainId`

**File:** `control-plane/api/routes/domains.ts:266-283`

The route runs **two** queries — one `SELECT 1` to verify ownership, then a full `SELECT ... WHERE d.id = $1 AND d.org_id = $2`. The second query already enforces the org filter, making the first query unnecessary overhead.

**Fix:** Remove the preliminary ownership check and handle the "not found" case from the main query result.

---

### M3. Rate limit middleware returns `503` on service error but auth rate limiter returns `429`

**Files:** `control-plane/services/rate-limit.ts:268` vs `control-plane/api/http.ts:284`

When the rate limiting service itself fails, the middleware returns `503 Service Unavailable` (correct), but the auth rate limiter in `http.ts` returns `429 Too Many Requests` with "Rate limiting service unavailable." Returning `429` when the client hasn't actually exceeded any limit is semantically wrong and causes clients to back off unnecessarily.

**Fix:** Auth rate limiter failure should return `503` instead of `429`, consistent with the middleware pattern.

---

### M4. Legacy `rateLimit` function has confusing overloaded signature

**File:** `control-plane/services/rate-limit.ts:96-140`

The deprecated `rateLimit()` has two overloads: `(identifier, limit?, namespace?)` and `(identifier, limit, req, res)`. The 4-arg overload determines dispatch by checking `arguments.length >= 3 && res !== undefined`, which is fragile. The 3-arg overload `rateLimit("x", 100, "ns")` would accidentally match the 4-arg path since `arguments.length >= 3`, then fail because `res` would be `undefined`.

Actually, reviewing more carefully: when called as `rateLimit("x", 100, "ns")`, `res` parameter maps to the 4th argument which is `undefined`, so `res !== undefined` is false, and it falls through to the 3-arg path. This is correct but extremely confusing.

**Fix:** Since this function is deprecated, add a runtime deprecation warning and plan removal. At minimum, add a comment explaining the dispatch logic.

---

### M5. Duplicate `AuthContext` and `AuthError` type definitions

**Files:** `packages/security/jwt.ts:58-63` and `control-plane/services/auth.ts:14-19`; `packages/errors/index.ts:215` and `control-plane/services/auth.ts:24`

There are two `AuthContext` interfaces:
- `jwt.ts`: `roles: string[]` (string array)
- `auth.ts`: `roles: Role[]` (typed enum array)

And two `AuthError` classes:
- `packages/errors/index.ts:215`: Extends `AppError`
- `control-plane/services/auth.ts:24`: Extends `Error`

Routes could accidentally import the wrong one, getting different behavior (e.g., the `@errors` `AuthError` has `statusCode` and `code`, while the `services/auth.ts` `AuthError` has different properties).

**Fix:** Consolidate to a single `AuthContext` and `AuthError`. The `services/auth.ts` version should re-export from `@errors` or `packages/security/jwt.ts`.

---

### M6. `shouldExposeErrorDetails()` checks `DEBUG=true` — potential info leak in production

**File:** `packages/errors/index.ts:578-580`

```typescript
export function shouldExposeErrorDetails(): boolean {
  return process.env['NODE_ENV'] === 'development' || process.env['DEBUG'] === 'true';
}
```

If `DEBUG=true` is accidentally set in production (common oversight), detailed error internals would be exposed to clients. The `toClientJSON()` and `createErrorResponse()` methods only check `NODE_ENV`, so this function is inconsistent with the rest of the error package.

**Fix:** Remove the `DEBUG` check, or gate it behind `NODE_ENV !== 'production'`.

---

### M7. Health check queue query lacks org isolation

**File:** `control-plane/api/http.ts:659-664`

```sql
SELECT COUNT(*) FILTER (WHERE status = 'processing' AND updated_at < NOW() - INTERVAL '30 minutes') AS stalled ...
FROM publishing_jobs
```

This queries **all** publishing jobs across all organizations. While it's used for infrastructure health (not tenant-facing), the stalled job threshold of 10 could trigger false positives in a multi-tenant environment where one org legitimately has long-running jobs.

**Fix:** Consider whether the threshold should be per-org or whether long-running jobs should be excluded via a `max_duration` column.

---

### M8. `ValidationError.fromZodIssues` ignores `_requestId` parameter

**File:** `packages/errors/index.ts:203-212`

```typescript
static fromZodIssues(issues: ..., _requestId?: string): ValidationError {
  return new ValidationError('Validation failed', issues.map(...));
  // _requestId is never passed to the constructor
}
```

The `requestId` parameter is accepted but discarded. Validation errors in production won't carry the request ID for distributed tracing.

**Fix:** Pass `_requestId` to the `ValidationError` constructor (it accepts `requestId` as the 3rd argument).

---

## LOW Severity

### L1. Cache-Control headers have incorrect indentation

**File:** `control-plane/api/http.ts:180-184`

```typescript
  if (authHeader?.startsWith('Bearer ')) {
  void reply.header('Cache-Control', ...);  // <-- not indented inside if
  void reply.header('Pragma', 'no-cache');
  void reply.header('Expires', '0');
  }
```

The headers inside the `if` block are not indented relative to the block. This is purely cosmetic but makes the code harder to read and could mask logic errors.

---

### L2. `checkQueues()` uses `parseInt` on potentially null values

**File:** `control-plane/api/http.ts:668-670`

```typescript
const stalledJobs = parseInt(row?.stalled || '0', 10);
```

Using `||` fallback with `parseInt` works but `row?.stalled` could be `null` from the SQL `COUNT`, which coerces to `'0'` via `||`. Using `Number(row?.stalled ?? 0)` would be cleaner and more idiomatic with the rest of the codebase (see `http.ts:790` which already uses `Number()` for port parsing).

---

### L3. `container.getHealth()` result accessed with dot notation

**File:** `control-plane/api/http.ts:706`

```typescript
status: containerHealth.services["database"] ? 'healthy' : 'degraded',
```

Mixed notation: `containerHealth.services` (dot) then `["database"]` (bracket). Should be consistent.

---

### L4. Inconsistent error message phrasing in auth errors

**File:** `control-plane/services/auth.ts`

Some errors say "Missing Authorization header" (line 138), others "Invalid Authorization header format" (line 143), others "Token too short or empty" (line 148). While each is accurate, the inconsistent style (some start with adjective, some with noun) makes client-side error handling pattern matching harder.

---

### L5. Unused import `_kernelIsValidIp`

**File:** `control-plane/services/rate-limit.ts:4`

```typescript
import { getClientIp as kernelGetClientIp, isValidIp as _kernelIsValidIp } from '@kernel/ip-utils';
```

`_kernelIsValidIp` is imported but never used (underscore prefix suppresses lint, but the import should be removed entirely).

---

### L6. `namespace!` non-null assertion unnecessary

**File:** `control-plane/services/rate-limit.ts:126`

```typescript
const key = buildRateLimitKey(identifier, namespace!);
```

`namespace` is already `typeof namespaceOrReq === 'string' ? namespaceOrReq : 'global'` — it can never be null. The `!` is unnecessary.

---

### L7. `cleanupRateLimit` uses bracket notation for `.clear()` unnecessarily

**File:** `control-plane/services/rate-limit.ts:284`

```typescript
memoryCounters["clear"]();
```

`LRUCache.clear()` is a direct method, not an index-signature access. Dot notation (`memoryCounters.clear()`) is more readable and correct here.

---

### L8. Missing `Content-Type` validation on POST/PATCH/PUT routes

**File:** `control-plane/api/routes/domains.ts` and other route files

No route explicitly validates that the incoming `Content-Type` is `application/json`. Fastify will parse JSON by default, but requests with other content types may produce confusing Zod validation errors instead of a clear `415 Unsupported Media Type`.

---

### L9. `QUOTA_EXCEEDED` error code not in standard `getStatusCodeForErrorCode`

**File:** `packages/errors/index.ts:84` / `control-plane/api/routes/domains.ts:200`

`ErrorCodes.QUOTA_EXCEEDED` exists as a constant, but `getStatusCodeForErrorCode()` doesn't handle it in its switch statement — it falls through to the `default: 500` case. Meanwhile, the domains route returns HTTP 402 manually via `sendError`. This inconsistency means any code using the standard helper would get the wrong status code.

**Fix:** Add `case ErrorCodes.QUOTA_EXCEEDED: return 402;` to the switch.

---

### L10. TODOs left in production code

**Files:** Found in `control-plane/api/routes/portfolio.ts` (lines 40, 85) and `control-plane/services/shard-deployment.ts` (line 287).

These indicate incomplete features (missing migrations, unimplemented file upload). They should be tracked as issues rather than left as code comments.

---

## Positive Patterns Worth Highlighting

1. **Atomic Redis rate limiting** (`http.ts:267-271`): The Lua script for INCR+EXPIRE prevents permanent rate-limiting if a crash occurs between the two commands.

2. **Fail-closed auth rate limiting** (`http.ts:279-284`): Redis failure denies auth requests rather than allowing unlimited brute-force.

3. **Connection leak prevention** (`http.ts:589-627`): The `checkDatabase` function properly tracks the `connectPromise` to release orphaned connections when the timeout wins the race.

4. **Advisory lock tracking** (`packages/database/pool/index.ts:31-108`): Locks are tracked with their original connections, preventing the silent failure of releasing session-scoped locks on different connections.

5. **Domain name validation** (`domains.ts:22-26`): Label-by-label validation avoids ReDoS from nested quantifiers.

6. **Transaction safety in domain CRUD** (`domains.ts:181-244`): `SELECT FOR UPDATE` prevents race conditions in quota checks, and usage counters are updated within the same transaction.

7. **Pre-verification algorithm check** (`jwt.ts:184-193`): Defense-in-depth against algorithm confusion attacks by rejecting disallowed algorithms before signature verification.

8. **Comprehensive error sanitization** (`packages/errors/index.ts`): Database errors are mapped to generic messages, and detailed info is stripped in production.

---

## Recommended Changes (Implementation Plan)

The following fixes are ordered by severity and impact:

### Phase 1: Bug Fixes (High)
1. **H2** — Wire the computed `_code` into `DatabaseError.fromDBError` return value
2. **H3** — Change `ConflictError` to use `ErrorCodes.CONFLICT`
3. **H1** — Align `verifyToken` signature with its usage (remove unnecessary `await` or make it explicitly async)

### Phase 2: Consistency & Correctness (Medium)
4. **M1** — Audit all route files for mixed dot/bracket notation on query result rows
5. **M3** — Change auth rate limiter failure to return `503` instead of `429`
6. **M5** — Consolidate duplicate `AuthContext` and `AuthError` definitions
7. **M6** — Remove `DEBUG` check from `shouldExposeErrorDetails()`
8. **M8** — Pass `requestId` through in `ValidationError.fromZodIssues`
9. **L9** — Add `QUOTA_EXCEEDED` case to `getStatusCodeForErrorCode()`
10. **M2** — Remove redundant ownership queries in domain routes

### Phase 3: Cleanup (Low)
11. **L5** — Remove unused `_kernelIsValidIp` import
12. **L6** — Remove unnecessary `!` assertion
13. **L7** — Use dot notation for `memoryCounters.clear()`
14. **L1** — Fix indentation in security headers block

### Files to Modify
- `packages/errors/index.ts` — H2, H3, M6, M8, L9
- `packages/security/jwt.ts` — H1, M5
- `control-plane/services/auth.ts` — H1, M5
- `control-plane/api/http.ts` — M3, L1, L2, L3
- `control-plane/api/routes/domains.ts` — M1, M2
- `control-plane/services/rate-limit.ts` — L5, L6, L7

---

## Verification

After implementing fixes:
1. Run `npm run type-check` to verify TypeScript compliance
2. Run `npm run lint` to verify ESLint rules pass
3. Run `npm run test:unit` to verify unit tests pass
4. Manually verify that `getStatusCodeForErrorCode(ErrorCodes.QUOTA_EXCEEDED)` returns `402`
5. Manually verify that `DatabaseError.fromDBError(new Error('duplicate key'))` returns a `DUPLICATE_ENTRY` code
6. Manually verify that `new ConflictError().code` returns `'CONFLICT'`
