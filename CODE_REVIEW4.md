# Comprehensive Code Review — Round 4

**Date:** 2026-02-17
**Reviewer:** Claude Code
**Branch:** `claude/code-review-dJE4v`
**Scope:** Full codebase — `control-plane/`, `packages/`, `domains/`, `apps/`, `migrations/`

---

## Executive Summary

The codebase shows strong security hygiene with many prior fixes applied: parameterised queries throughout, atomic Redis Lua scripting for auth rate limiting, JWT algorithm confusion prevention, circuit breaker for Redis failures, graceful shutdown, proper security headers, and IDOR checks. This round identifies **two active bugs** (search results discarded, double `page` parsing) and **several medium-severity architectural issues** not covered by prior reviews.

---

## Bugs (Active, User-Facing)

### BUG-1 · Critical — Search Results Never Returned

**File:** `control-plane/api/routes/search.ts:49–54`

```ts
const _results = await svc.search(q, limit, offset, ctx); // results computed ...
const total = await svc.searchCount(q, ctx.orgId);

return res.send({
  pagination: { totalPages: Math.ceil(total / limit) }  // ... but never sent
});
```

`_results` is assigned with the underscore convention (suppresses "unused variable" lint warning), but the actual search data is **never included in the response body**. Every call to `GET /search` currently returns only `{ pagination: { totalPages } }` with no `results` key. The service is called (causing DB load), but clients receive no data.

**Fix:** Include `results` in the response:

```ts
const results = await svc.search(q, limit, offset, ctx);
const total = await svc.searchCount(q, ctx.orgId);

return res.send({
  results,
  pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
});
```

---

### BUG-2 · Medium — Double Parsing of `page` Parameter in Search

**File:** `control-plane/api/routes/search.ts:22,40`

```ts
// Line 22 — Zod validates and coerces `page` ...
page: z.coerce.number().min(1).default(1),

// Line 40 — ... then page is re-parsed from raw query, discarding Zod result
const page = Math.max(1, parseInt(String((req.query as Record<string, string | undefined>)['page'])) || 1);
```

`parseResult.data.page` (the Zod-validated, type-safe value) is never used. The raw re-parse of `req.query.page` can differ from what Zod produces and bypasses schema validation. Remove the raw re-parse and use the validated value:

```ts
const { q, limit, page } = parseResult.data;
```

---

## Architecture Issues

### ARCH-1 · Critical — `BillingService` Uses a Stub `StripeAdapter` in Production

**File:** `control-plane/services/stripe.ts:1–4`

```ts
if (process.env['NODE_ENV'] === 'production') {
  throw new Error('Stripe mock cannot be used in production');
}
```

The `StripeAdapter` injected into `BillingService` is a mock that **immediately throws** in any production environment. This makes `POST /billing/subscribe` and `cancelSubscription` completely non-functional in production. By contrast, `billing-invoices.ts` imports the real Stripe SDK directly, creating an inconsistency.

A real `StripeAdapter` (or a concrete implementation of an `IStripeAdapter` interface) needs to exist in `control-plane/adapters/` with the stub only used for development/test injection.

---

### ARCH-2 · High — Rate Limiting on Billing Routes Uses In-Memory Limiter Only

**File:** `control-plane/api/routes/billing.ts:29,51`

```ts
await rateLimit('billing', 20);   // 2-arg form → in-memory only
await rateLimit('billing', 50);
```

The 2-argument `rateLimit(identifier, limit)` overload routes to the **synchronous in-memory** LRU limiter, not Redis. In a multi-instance deployment each pod maintains its own counter, multiplying the effective limit by instance count. Billing is the highest-value endpoint and deserves distributed enforcement via `checkRateLimitAsync()`:

```ts
const result = await checkRateLimitAsync(ctx.userId, 'billing.subscribe', 'billing');
if (!result.allowed) return errHelpers.rateLimited(res, Math.ceil((result.resetTime - Date.now()) / 1000));
```

The same issue applies to `billing-invoices.ts`.

---

### ARCH-3 · Medium — Auth Rate Limiting Order Inconsistent Across Routes

**File:** `control-plane/api/routes/billing.ts:26–29`, vs `content.ts:65–67`

`GET /content` explicitly documents its fix:
```ts
// P1-11 FIX: Rate limit BEFORE auth to prevent CPU exhaustion via JWT verification DDoS.
await rateLimit('content', 50, req, res);
const ctx = getAuthContext(req);
```

`POST /billing/subscribe` does the opposite:
```ts
const ctx = getAuthContext(req);
requireRole(ctx, ['owner']);
await rateLimit('billing', 20);   // ← after auth
```

Billing is a high-value target for brute-force. Rate limiting should occur before JWT verification on all routes.

---

### ARCH-4 · Medium — `req.auth as AuthContext` Cast Bypasses Type Safety

**Files:** `publishing.ts`, `roi-risk.ts`, `search.ts`, `seo.ts` (8 occurrences)

```ts
const ctx = req.auth as AuthContext;  // unsafe cast
if (!ctx) { return errors.unauthorized(res); }
```

`getAuthContext(req)` in `control-plane/api/types.ts` already provides a type-safe accessor with a proper type guard. The `as AuthContext` cast can silently produce `undefined as AuthContext` at runtime if the middleware didn't set `req.auth`, and the downstream `if (!ctx)` check happens to work only because `undefined` is falsy. It's a logic accident rather than safe design. Replace with:

```ts
const ctx = getAuthContext(req);  // throws if missing; caught by global handler
```

---

### ARCH-5 · Medium — `BUDGET_EXCEEDED` Is a Magic String Not in `ErrorCodes`

**File:** `control-plane/api/http.ts:394`

```ts
} else if (statusCode === 402) {
  errorCode = 'BUDGET_EXCEEDED';   // ← not in ErrorCodes
```

This is a raw string literal. `ErrorCode` is a discriminated union derived from `ErrorCodes`. Using a string literal breaks exhaustiveness, prevents IDE completion, and could silently drift from the actual code sent to clients. Add `BUDGET_EXCEEDED: 'BUDGET_EXCEEDED'` to `ErrorCodes` in `packages/errors/index.ts`.

---

## Code Quality Issues

### CQ-1 · Medium — Content Search Uses ILIKE on Potentially Large `body` Column

**File:** `control-plane/api/routes/content.ts:91–97`

```ts
query += ` AND (c.title ILIKE $${paramIndex} ESCAPE '\\' OR c.body ILIKE $${paramIndex} ESCAPE '\\')`;
```

`body` is up to 50 KB of text. An `ILIKE` scan on that column without a full-text index forces PostgreSQL to detoast and pattern-match every row sequentially. With a large `content_items` table this will degrade to a full table scan regardless of other predicate selectivity. Consider:

1. Adding a GIN index: `CREATE INDEX idx_content_fts ON content_items USING gin(to_tsvector('english', coalesce(title,'') || ' ' || coalesce(body,'')));`
2. Replacing the `ILIKE` with `to_tsvector` / `plainto_tsquery` on the indexed column.

---

### CQ-2 · Low — Validation Error Extraction Is Inconsistent

**File:** `control-plane/api/routes/content.ts` (multiple handlers)

```ts
const zodError = validationError as { issues?: Array<{ path: ...; message: string; code: string }> };
return errors.validationFailed(res, zodError.issues?.map(...));
```

`packages/errors/index.ts` exports `extractZodIssues(error)` exactly for this purpose. The manual cast pattern:
- Doesn't protect against `validationError` not being a Zod error at all
- Is duplicated across 5+ handlers
- Will break silently if Zod changes its error shape

Use `safeParse` (already done in many routes) or `extractZodIssues`:
```ts
return errors.validationFailed(res, extractZodIssues(validationError));
```

---

### CQ-3 · Low — Pagination Response Missing `total` and `page`

**File:** `control-plane/api/routes/content.ts:107–111`

```ts
pagination: {
  totalPages: Math.ceil(total / limit),
  // missing: total, page, limit
}
```

The count query calculates `total` but it's not returned to the client. Clients cannot display "Showing 1-20 of 243 results" or build accurate page selectors. Return the full set: `{ total, page, limit, totalPages }`.

---

### CQ-4 · Low — `publishing.ts` Handlers Missing `try/catch`

**File:** `control-plane/api/routes/publishing.ts:26–130`

Most `GET /publishing/targets`, `POST /publishing/targets`, `GET /publishing/jobs`, `GET /publishing/jobs/:id`, `POST /publishing/jobs/:id/retry` handlers lack `try/catch` blocks. Unhandled exceptions propagate to Fastify's global error handler, which produces the correct HTTP response, but no contextual logging is emitted (the logger call in each handler is skipped). Add per-handler `try/catch` consistent with other route files.

---

### CQ-5 · Low — Standard `Retry-After` HTTP Header Missing from In-Memory Rate Limiter

**File:** `control-plane/services/rate-limit.ts:114–119`

The 4-argument overload of `rateLimit()` (used by content routes) sends `{ retryAfter }` in the JSON body but does **not** set the `Retry-After` HTTP response header. RFC 6585 §4 requires this header on 429 responses for correct client back-off behaviour. The `errors.rateLimited()` helper in `@errors/responses` already sets the header when called; route-level enforcement via the raw `.status(429).send()` path should do the same.

---

## Security — Positive Findings

The following controls were reviewed and found to be correctly implemented:

| Control | Location |
|---|---|
| Parameterised queries throughout; no string concatenation for values | All DB query sites |
| LIKE wildcard escaping (`\%`, `\_`) with `ESCAPE` clause | `content.ts:87` |
| Atomic Redis Lua `INCR+EXPIRE` for auth rate limiting | `http.ts:265–271` |
| Auth rate limit fail-closed on Redis error | `http.ts:278–283` |
| PEM key rejection on JWT secrets | `jwt.ts:isPemKey()` |
| Token refresh verifies before re-signing (`jwt.verify` not `jwt.decode`) | `jwt.ts:refreshToken()` |
| JWT circuit breaker for Redis revocation check | `jwt.ts:_isTokenRevoked()` |
| `owner` role added to all role schemas (was missing, caused silent 401s) | `jwt.ts`, `security/jwt.ts` |
| Auth middleware is secure-by-default (rejects missing auth unless public) | `http.ts:301–323` |
| Webhook routes require explicit `config: { public: true }` | `http.ts:301` comment |
| Security headers (HSTS, CSP, Permissions-Policy) applied globally | `http.ts:165–186` |
| Authenticated requests get `Cache-Control: no-store` | `http.ts:178–183` |
| Backpressure rejection at 90% DB pool utilisation | `http.ts:199–214` |
| DB pool connection leak fixed in `/health` (timeout race) | `http.ts:584–626` |
| BigInt serialisation handled with depth guard | `http.ts:330–349` |
| IDOR check on all `/orgs/:id/*` routes | `orgs.ts:75,99,122` |
| CSV injection prefix protection | `billing-invoices.ts:122–127` |
| Singleton Stripe client (not per-request) | `billing-invoices.ts:getStripeClient()` |
| Idempotency + Stripe compensation in `assignPlan` | `billing.ts:assignPlan()` |
| Structured logging with no `console.log` in production code | All service files |
| Graceful shutdown: Fastify close + OTel flush + cost tracker flush | `http.ts:793–809` |

---

## Recommended Fixes by Priority

| # | Severity | File | Issue |
|---|---|---|---|
| 1 | **Critical bug** | `search.ts` | Search results discarded, never returned (BUG-1) |
| 2 | **Critical arch** | `services/stripe.ts` | Stub StripeAdapter throws in production (ARCH-1) |
| 3 | **High arch** | `billing.ts`, `billing-invoices.ts` | Rate limiting is in-memory, not distributed (ARCH-2) |
| 4 | **Medium bug** | `search.ts` | Double `page` parse bypasses Zod validation (BUG-2) |
| 5 | **Medium arch** | `billing.ts` | Rate limit runs after auth, not before (ARCH-3) |
| 6 | **Medium arch** | `publishing.ts`, `search.ts`, etc. | Unsafe `req.auth as AuthContext` cast (ARCH-4) |
| 7 | **Medium arch** | `http.ts` | `BUDGET_EXCEEDED` magic string not in `ErrorCodes` (ARCH-5) |
| 8 | **Medium perf** | `content.ts` | ILIKE on 50 KB body column without FTS index (CQ-1) |
| 9 | **Low** | `content.ts` | Inconsistent Zod error extraction (CQ-2) |
| 10 | **Low** | `content.ts` | Pagination response missing `total` and `page` (CQ-3) |
| 11 | **Low** | `publishing.ts` | Missing `try/catch` for contextual error logging (CQ-4) |
| 12 | **Low** | `rate-limit.ts` | Missing `Retry-After` header on 429 (CQ-5) |
