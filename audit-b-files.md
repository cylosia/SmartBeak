# Security Audit: All `b*` Files — TypeScript / PostgreSQL Production Codebase

**Date:** 2026-02-18
**Scope:** Every file whose basename starts with `b` (case-insensitive) — 40 files total
**Method:** Full AST read + two independent adversarial agent cross-checks
**Coverage:** TypeScript rigor · SQL/Postgres · Auth/Security · Async/Concurrency · Performance · Observability · Test integrity

---

## Severity Legend

| Level | Label | Meaning |
|-------|-------|---------|
| P0 | **Critical** | Production outage, data loss, or active security breach imminent |
| P1 | **High** | Exploitable under load, data corruption, auth bypass, or financial loss path |
| P2 | **Medium** | Technical debt with real failure modes; performance degradation under load |
| P3 | **Low** | Style, nitpicks, perfectionist ideals |

---

## P0 — Critical (Deploy These = Incident Today)

---

### P0-1 · `billing.security.test.ts:143` · Security · **False-Positive Security Tests — Billing Auth Completely Untested**

**File:** `apps/api/src/routes/__tests__/billing.security.test.ts:143`
**Category:** Security / Test Integrity

```ts
// Line 143
jest.spyOn(require('jsonwebtoken'), 'verify').mockReturnValue({
  sub: 'user-123',
  orgId: 'org-456',
  stripeCustomerId: 'cus_test'
} as any);
```

**Violation:** `billingInvoiceExport.ts` imports `extractAndVerifyToken` from `@security/jwt`, which is a wrapper around `jsonwebtoken`. Spying on `require('jsonwebtoken').verify` does NOT intercept calls made through the `@security/jwt` module's internal closure. Additionally, `require()` does not exist in this ESM project (`"type": "module"` in `package.json`). The mock is completely disconnected from the production code path.

**Impact:** The `billingInvoiceExport` security tests give **zero coverage** of the actual authentication flow. Any regression in `@security/jwt` token verification will go undetected. CI shows green while the route may be totally unauthenticated.

**Fix:** Replace with:
```ts
import { extractAndVerifyToken } from '@security/jwt';
vi.mock('@security/jwt');
(extractAndVerifyToken as jest.Mock).mockReturnValue({
  valid: true,
  claims: { sub: 'user-123', orgId: 'org-456' }
});
```

**Risk if unFixed:** False test confidence. Any auth regression in `billingInvoiceExport` ships to production undetected.

---

### P0-2 · `billing.security.test.ts:117–137` · Security · **Test Asserts Wrong Status Code — Route Returns 401, Test Expects 200**

**File:** `apps/api/src/routes/__tests__/billing.security.test.ts:117–137`
**Category:** Security / Test Integrity

```ts
// Test description: "should skip membership check for user-level billing (no org)"
(verifyToken as jest.Mock).mockReturnValue({
  sub: 'user-123',
  stripeCustomerId: 'cus_test'
  // No orgId
});
// ...
expect(response.statusCode).toBe(200); // ← WRONG
```

**Violation:** `billingInvoices.ts` defines `InvoiceClaimsSchema` requiring `orgId: z.string().min(1)`. A JWT without `orgId` fails `safeParse` and returns **401 Unauthorized**. The test expects **200**, which is the opposite of the actual behavior. The test passes today only because the `verifyToken` mock is not actually connected to the route (the same root cause as P0-1).

**Fix:** Change expected status to 401 (or 403 per the membership hook), and fix the root mock connection:
```ts
expect(response.statusCode).toBe(401);
```

**Risk if unFixed:** The test masks the real behavior. If the mock is ever fixed correctly, this test will start failing and block CI — but by then the incorrect expectation may be read as documentation of desired behavior.

---

### P0-3 · `billing.test.ts:18–23` · Test Integrity · **`redis.set` Missing From Mock — All `assignPlan` Happy-Path Tests Are Broken**

**File:** `control-plane/services/__tests__/billing.test.ts:18–23`
**Category:** Test Integrity / Concurrency

```ts
const mockRedis = {
  get: vi.fn(),
  setex: vi.fn(),
  del: vi.fn(),
  ttl: vi.fn(),
  // ← `set` is MISSING
};
```

**Violation:** `BillingService.tryClaimProcessing()` calls `redis.set(fullKey, ..., 'EX', ttl, 'NX')` (an atomic Redis SET NX). The mock object has no `set` property. Calling `redis.set()` on the mock throws `TypeError: redis.set is not a function`. Every test that exercises `assignPlan()` — the critical billing flow — throws before reaching any Stripe or DB interaction. The tests that use `.rejects.toThrow('Valid orgId')` may mask this because the TypeError propagates before the orgId check only on the first call; but happy-path tests (e.g., "assigns plan successfully on happy path") fail because `svc.assignPlan()` throws a TypeError rather than succeeding.

**Impact:** The idempotency/double-charge protection path (`tryClaimProcessing`) is **completely untested**. The billing service's most critical guard against double-charges has zero test coverage.

**Fix:**
```ts
const mockRedis = {
  get: vi.fn(),
  set: vi.fn().mockResolvedValue('OK'),   // ← add this
  setex: vi.fn().mockResolvedValue('OK'),
  del: vi.fn().mockResolvedValue(1),
  ttl: vi.fn().mockResolvedValue(3600),
};
```

**Risk if unFixed:** Double-charge risk ships uncovered. The Redis SET NX path — the only thing preventing two concurrent requests from both creating Stripe subscriptions — is never tested.

---

### P0-4 · `billingInvoices.ts` · Security · **No Rate Limiting on `/billing/invoices` — Stripe API DoS Vector**

**File:** `apps/api/src/routes/billingInvoices.ts:78–130`
**Category:** Security / Performance

**Violation:** Every other billing route applies rate limiting as its first `onRequest` hook:
- `billingStripe.ts:120`: `rateLimitMiddleware('strict', undefined, { detectBots: true })`
- `billingPaddle.ts:54`: `rateLimitMiddleware('strict', undefined, { detectBots: true })`
- `billingInvoiceExport.ts:83`: `apiRateLimit()`

`billingInvoices.ts` has **zero rate-limiting hooks**. An authenticated attacker loops `/billing/invoices?limit=100` and exhausts: (1) Stripe API rate limits (causing 429 for all other orgs), (2) the connection pool via repeated Stripe SDK HTTP calls, (3) DB reads for `stripe_customer_id` on every request.

**Fix:** Add as the first hook:
```ts
app.addHook('onRequest', rateLimitMiddleware('strict', undefined, { detectBots: true }));
```

**Risk if unFixed:** Stripe API rate-limit exhaustion kills invoicing for all tenants. Trivially achievable with a single valid token in a loop.

---

## P1 — High (Likely Incidents Under Real Load)

---

### P1-1 · `billingStripe.ts:123–135` · Security · **JWT Claims Not Zod-Validated — Numeric `sub` Bypasses Membership Check**

**File:** `apps/api/src/routes/billingStripe.ts:123–135`
**Category:** Security / Type Safety

```ts
(req as AuthenticatedRequest).user = {
  id: result.claims.sub,    // ← no Zod validation
  orgId: result.claims.orgId
};
```

**Violation:** `billingInvoices.ts` (correctly) uses `InvoiceClaimsSchema.safeParse(rawClaims)` before trusting claim fields. `billingStripe.ts` relies on `extractAndVerifyToken` alone, which validates the JWT signature but the `claims` type returned is `JwtClaims` — a type-level assertion, not a runtime Zod parse. The adversarial agent confirmed: if a JWT contains `"sub": 12345` (number), TypeScript's structural typing accepts it at compile time, and `user.id` is a number at runtime. Downstream string-equality membership checks then silently fail or produce unexpected results.

**Fix:**
```ts
const ClaimsSchema = z.object({ sub: z.string().min(1), orgId: z.string().min(1) });
const parsed = ClaimsSchema.safeParse(result.claims);
if (!parsed.success) return errors.unauthorized(reply, 'Invalid token claims');
(req as AuthenticatedRequest).user = { id: parsed.data.sub, orgId: parsed.data.orgId };
```

**Risk if unFixed:** Crafted JWTs with non-string `sub` bypass string-equality auth checks. Financial checkout route left with weaker input validation than the invoice listing route.

---

### P1-2 · `billingStripe.ts:78` · Observability / Security · **Empty `catch {}` Swallows All Redis/Lua Errors in CSRF Validation**

**File:** `apps/api/src/routes/billingStripe.ts:75–80`
**Category:** Observability / Security

```ts
try {
  const result = await redis.eval(luaScript, 1, key, orgId);
  return result === 1;
} catch {
  return false;  // ← silently swallows ALL errors including programming mistakes
}
```

**Violation:** Any Redis error (network blip, Lua CJSON not available, `EVAL` disabled, key namespace collision) silently returns `false` — appearing as "Invalid CSRF token" to every customer. During a Redis outage, all billing checkout attempts fail with 403 FORBIDDEN. No error is logged. Ops has no visibility into the root cause.

**Fix:**
```ts
} catch (err) {
  logger.error('CSRF validation Redis error', err instanceof Error ? err : new Error(String(err)));
  return false;
}
```

**Risk if unFixed:** Redis outage → all checkouts fail with 403, with no log evidence. MTTR increases to hours as ops misdiagnoses auth failure as a misconfiguration.

---

### P1-3 · `billingInvoices.ts:198–206` · Architecture · **Stripe Error Detection Dead Code — `error.name === 'StripeError'` Never Matches**

**File:** `apps/api/src/routes/billingInvoices.ts:198–206`
**Category:** Architecture / Error Handling

```ts
error.name === 'StripeError'
```

**Violation:** Stripe SDK v14+ throws subclasses (`StripeCardError`, `StripeInvalidRequestError`, etc.). Their `.name` is the subclass name, never the base `'StripeError'`. The adversarial agent confirmed this in the Stripe SDK source. This condition is dead code. The 502 pathway only fires via the `errorCode?.startsWith('stripe_')` branch (which does work), but the `error.name` check is misleading dead code that may cause future contributors to rely on it when it fails silently.

**Same pattern exists in:** `billingStripe.ts:221–223`, `billingPaddle.ts:137–139`

**Fix:** Replace all three instances with:
```ts
import Stripe from 'stripe';
if (error instanceof Stripe.errors.StripeError) {
  return sendError(reply, 502, ErrorCodes.EXTERNAL_API_ERROR, 'Payment provider error');
}
```

**Risk if unFixed:** Future Stripe error types that don't include `'Stripe'` in their message or `'stripe_'` in their code are returned as 500 instead of 502, confusing monitoring and causing PagerDuty to fire the wrong runbook.

---

### P1-4 · `billing.test.ts:160–182` · Test Integrity · **"Retry After Timeout" Test Asserts Behavior the Code Does Not Implement**

**File:** `control-plane/services/__tests__/billing.test.ts:160–182`
**Category:** Test Integrity

```ts
it('allows retry after processing timeout expires', async () => {
  mockRedis.get.mockResolvedValue(JSON.stringify({
    status: 'processing',
    startedAt: Date.now() - FIVE_MIN_MS - 1000, // timed out
  }));
  // ...
  await svc.assignPlan('org-1', 'plan-pro');
  expect(mockRedis.del).toHaveBeenCalled(); // ← WRONG
```

**Violation:** When a processing timeout is exceeded, `BillingService.tryClaimProcessing()` (line 197) throws `new Error('Previous operation timed out — please retry')`. It does NOT call `redis.del`, does NOT proceed to assign the plan, and does NOT return `{ claimed: true }`. The test expects success (`await svc.assignPlan(...)` without `.rejects`) and expects `mockRedis.del` to be called. Both assertions are wrong — the code throws.

**Fix:** Change to:
```ts
await expect(svc.assignPlan('org-1', 'plan-pro'))
  .rejects.toThrow('Previous operation timed out');
expect(mockRedis.del).not.toHaveBeenCalled();
```

**Risk if unFixed:** The timeout-retry path is untested. If the timeout logic regresses, clients stuck in 5-minute "timed out" idempotency keys cannot retry their subscription assignment.

---

### P1-5 · `billingStripe.ts:197`, `billingPaddle.ts:116` · Security · **UUID Regex Rejects v6/v7/v8 — Breaks Checkout for Modern UUID Orgs**

**Files:** `apps/api/src/routes/billingStripe.ts:197`, `apps/api/src/routes/billingPaddle.ts:116`
**Category:** Security / Compatibility

```ts
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
```

**Violation:** This regex accepts UUID v1–v5 only (the `[1-5]` in position 3 of the third group). UUIDv7 (time-ordered, now widely used in new PostgreSQL setups and Clerk) uses version digit `7`. If the org IDs in JWTs are v7 UUIDs, the regex returns 400 "Invalid organization ID" for every checkout attempt.

**Fix:** Use Zod's built-in `.uuid()` which handles all current UUID versions:
```ts
import { z } from 'zod';
if (!z.string().uuid().safeParse(orgId).success) {
  return errors.badRequest(reply, 'Invalid organization ID', ErrorCodes.INVALID_UUID);
}
```

**Risk if unFixed:** If Clerk or any new org-creation path switches to UUIDv7 (which they have), all those orgs silently receive 400 on every billing checkout until manually debugged.

---

### P1-6 · `BillingStatusBanner.tsx:5–6` · Architecture · **`'trialing'` Status Shows "Subscription Inactive" — Product Bug Locks Out Trial Users**

**File:** `apps/web/components/BillingStatusBanner.tsx:5–6`
**Category:** Architecture / Product

```ts
const msg = status === 'past_due'
  ? 'Billing issue detected. The system is in read-only mode.'
  : 'Subscription inactive. Read-only access only.';
```

**Violation:** The component accepts `'active' | 'past_due' | 'canceled' | 'trialing'`. The `'trialing'` case falls into the else branch with "Subscription inactive. Read-only access only." A user in a free trial is told their subscription is inactive and they're in read-only mode — which is factually wrong and blocks feature adoption.

**Fix:**
```ts
const msg = status === 'past_due'
  ? 'Billing issue detected. The system is in read-only mode.'
  : status === 'trialing'
  ? 'You are in a free trial. Upgrade to unlock all features.'
  : 'Subscription inactive. Read-only access only.';
```

**Risk if unFixed:** Trial users told they're in read-only mode churn. Support tickets spike. Activation rate drops.

---

### P1-7 · `billingInvoiceExport.ts` / `billingInvoices.ts` · Performance · **Stripe Invoice Pagination Not Followed — Silently Truncates at 50 Items**

**Files:** `apps/api/src/routes/billingInvoiceExport.ts:183–186`, `control-plane/api/routes/billing-invoices.ts:46–50`
**Category:** Performance / Data Integrity

```ts
const invoices = await stripe.invoices.list({
  customer: customerId,
  limit: 50           // ← Stripe max is 100; has_more never checked
});
```

**Violation:** Neither the export nor the listing route checks `invoices.has_more`. Any org with >50 invoices receives a silently truncated list. The export CSV is missing invoices. Accountants using the export for reconciliation get incomplete data with no warning.

**Fix:** Paginate through all pages:
```ts
let page = await stripe.invoices.list({ customer: customerId, limit: 100 });
const allInvoices = [...page.data];
while (page.has_more) {
  page = await stripe.invoices.list({
    customer: customerId, limit: 100,
    starting_after: allInvoices[allInvoices.length - 1]?.id
  });
  allInvoices.push(...page.data);
}
```

Or for the listing endpoint, expose `has_more` to the client and use cursor-based pagination (already implemented in `billingInvoices.ts` for the DTO response, just missing the full-page loop).

**Risk if unFixed:** Orgs with >50 invoices download incomplete CSVs. Compliance/audit failures. Accounting reconciliation errors.

---

### P1-8 · `billing.ts` (control-plane route) · Security · **`planId` Lacks Character Validation — Arbitrary Strings Reach `assignPlan`**

**File:** `control-plane/api/routes/billing.ts:22–24`
**Category:** Security

```ts
const SubscribeSchema = z.object({
  planId: z.string().min(1).max(100),
}).strict();
```

**Violation:** No `.regex()` constraint on `planId`. Any character string up to 100 chars reaches `billing.assignPlan()` and is stored in the `plans` table lookup. While parameterized queries prevent SQL injection, a planId like `"plan-<script>alert(1)</script>"` can be stored in the `audit_events.metadata` JSONB and reflected back in API responses or admin UIs without sanitization.

**Fix:**
```ts
planId: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/, 'planId must be alphanumeric with _ or -'),
```

**Risk if unFixed:** Stored XSS via plan ID in audit logs / admin dashboards. Depending on admin UI rendering, this can lead to admin account takeover.

---

## P2 — Medium (Technical Debt With Real Failure Modes)

---

### P2-1 · `control-plane/api/routes/billing-invoices.ts:20` · Architecture · **Hardcoded Stripe API Version Diverges from Canonical Config**

**File:** `control-plane/api/routes/billing-invoices.ts:20`

```ts
const stripe = new Stripe(billingConfig.stripeSecretKey, {
  apiVersion: '2023-10-16',   // ← hardcoded
});
```

**Fix:** Use `billingConfig.stripeApiVersion` (which already exists and is maintained centrally).

---

### P2-2 · `BillingInvoices.tsx:22` · Security / UX · **Error Message Rendered Directly From Untrusted Source**

**File:** `apps/web/components/BillingInvoices.tsx:22`

```tsx
<EmptyState title={`Error loading invoices: ${error.message}`} />
```

If the `error` is not an `Error` instance (e.g., a rejected Promise with a string value), `error.message` is `undefined`, rendering "Error loading invoices: undefined". If `EmptyState` ever uses `dangerouslySetInnerHTML`, this is XSS. The title should be a static string with the dynamic detail in a separate UI element.

---

### P2-3 · `BillingInvoices.tsx:36` · Type Safety · **`null` React List Key — Collision Risk**

**File:** `apps/web/components/BillingInvoices.tsx:36`

```tsx
<li key={inv.id}>
```

`InvoiceDto.id` is typed `string | null`. A `null` key becomes the string `"null"` in React, which can collide across multiple `null`-id invoices, causing incorrect rendering/reconciliation.

**Fix:** `key={inv.id ?? inv.number ?? String(index)}`

---

### P2-4 · `BulkPublishView.tsx` · Performance · **O(n²) Selection State — `Array.includes` in Render Loop**

**File:** `apps/web/components/BulkPublishView.tsx:30`

```ts
checked={selected.includes(d.id)}
```

`Array.includes` is O(n). Called in a map over all drafts = O(n²) per render. For 100 drafts with 100 selected, that's 10,000 comparisons per render.

**Fix:** `const [selected, setSelected] = useState<Set<string>>(new Set()); ... checked={selected.has(d.id)}`

---

### P2-5 · `apps/web/pages/attribution/buyer.tsx:11` · Security · **Raw Acquisition Intelligence Rendered Verbatim in DOM**

**File:** `apps/web/pages/attribution/buyer.tsx:11`

```tsx
<pre>{JSON.stringify(rows, null, 2)}</pre>
```

The entire API response (domain acquisition intelligence, competitor analysis, financial ROI data) is rendered in a `<pre>` tag. Any user with DevTools or view-source can read all fields. `rows` is typed `unknown` so TypeScript provides zero guidance on what's being exposed. Authentication is checked, but no role-based filtering is applied.

---

### P2-6 · `business-kpis.ts:263–266` · Architecture · **Singleton Replacement Leaks `setInterval` — Previous Timer Never Stopped**

**File:** `packages/monitoring/business-kpis.ts:263–266`

```ts
export function initBusinessKpis(collector?: MetricsCollector): BusinessKpiTracker {
  const c = collector ?? getMetricsCollector();
  instance = new BusinessKpiTracker(c);  // ← old instance's timer never stopped
  return instance;
}
```

Every call to `initBusinessKpis()` (e.g., in tests that call it multiple times) leaks the old instance's `setInterval`. Old timers keep firing, double-counting metrics and wasting CPU.

**Fix:**
```ts
export function initBusinessKpis(collector?: MetricsCollector): BusinessKpiTracker {
  instance?.stop();  // stop previous timer before replacing
  instance = new BusinessKpiTracker(collector ?? getMetricsCollector());
  return instance;
}
```

---

### P2-7 · `billing.ts` (billing service) · SQL · **`getSubscriptions` Has No LIMIT — Unbounded Result Set**

**File:** `control-plane/services/billing.ts:541–548`

```ts
const { rows } = await this.pool.query<Subscription>(
  `SELECT ... FROM subscriptions WHERE org_id = $1 ORDER BY created_at DESC`,
  [orgId]
);
```

An org that has subscribed and cancelled many times (e.g., enterprise customer with 500 historical subscriptions) returns all records into memory. No pagination or LIMIT clause.

---

### P2-8 · `bloatDetector.ts:278–298` · Architecture · **Accesses Undocumented Knex Internal APIs — Breaks on Knex Upgrades**

**File:** `packages/database/maintenance/bloatDetector.ts:278–298`

```ts
const kClient = knex.client as {
  acquireConnection(): Promise<unknown>;
  query(conn: unknown, obj: { sql: string; bindings: unknown[] }): Promise<unknown>;
  destroyRawConnection(conn: unknown): Promise<void>;
};
```

These are undocumented internal Knex APIs. They are not part of the public contract and change between Knex major versions without SemVer notice. A Knex upgrade can silently break all REINDEX operations in production.

---

### P2-9 · `packages/config/billing.ts:88–91` · Security · **JWT Key Minimum Length Not Validated**

**File:** `packages/config/billing.ts:88–91`

```ts
const jwtKey = process.env['JWT_KEY_1'];
if (!jwtKey) { throw new Error('...'); }
// No length or format check
```

A 1-character JWT key passes validation. HMAC-SHA256 requires at least 32 bytes of entropy for adequate security. A short key makes offline brute-force of any JWT trivial.

**Fix:**
```ts
if (jwtKey.length < 32) {
  throw new Error('FATAL: JWT_KEY_1 must be at least 32 characters for HMAC-SHA256 security');
}
```

---

### P2-10 · `billing.ts` (service) · SQL / Concurrency · **`cancelSubscription` Outer Catch Calls ROLLBACK After COMMIT**

**File:** `control-plane/services/billing.ts:454,475–479`

If `client.query('COMMIT')` at line 454 itself throws (disk full, pg crash), the outer catch at line 475 attempts `ROLLBACK` on a partially committed or already committed transaction. PostgreSQL responds with "there is no transaction in progress" — this error is silently swallowed (the original COMMIT error is rethrown, not the ROLLBACK error), but the ROLLBACK roundtrip adds latency to an already-failing path.

**Fix:** Track transaction state in a variable: `let txStarted = false; // set true after BEGIN` and only call ROLLBACK if `txStarted && !committed`.

---

### P2-11 · `buyerRoiSummary.ts:77–80` · Architecture · **Single Bad Row Throws and Aborts Entire Summary**

**File:** `apps/api/src/roi/buyerRoiSummary.ts:77–80`

```ts
if (!Number.isFinite(cost) || !Number.isFinite(revenue)) {
  throw new Error(`Non-numeric financial data in ROI row: ...`);
}
```

One row with a NaN cost (e.g., a DB migration that left a sentinel value) aborts the entire summary for all rows. A buyer making an acquisition decision sees a 500 error instead of a partial summary.

**Fix:** Log the bad row and skip it (add to `missingDataCount`), rather than throwing.

---

### P2-12 · `billingStripe.ts:40–52` · Security · **No Per-Org Rate Limit on CSRF Token Generation**

**File:** `apps/api/src/routes/billingStripe.ts:40–52`

`generateBillingCsrfToken` creates a Redis key per token with no cap on tokens per org. An attacker with a valid token loops the `/billing/stripe/csrf-token` endpoint, filling Redis with `csrf:billing:*` keys. At 15-minute TTL and 1000 req/s, this fills ~54 MB of Redis in an hour before the route-level rate limit kicks in (if it exists at the right tier).

---

### P2-13 · `bulkPublishCreate.test.ts:153–176` · Test Quality · **Tier-Limit Tests Test No Application Code**

**File:** `apps/api/src/routes/__tests__/bulkPublishCreate.test.ts:153–176`

```ts
it('free tier allows max 5 drafts and 3 targets', () => {
  const tier = 'free';
  const maxDrafts = tier === 'agency' ? 100 : tier === 'pro' ? 20 : 5;
  // ← This inline ternary IS the test logic. No route code called.
```

These tests verify a ternary expression defined in the test file itself. They would pass even if the actual route enforces completely different tier limits. They provide zero coverage of the production code.

---

### P2-14 · `breaker_timeout.spec.ts:8–11` · Test Quality · **Timing-Sensitive Test Flaky Under CI Load**

**File:** `apps/api/tests/adapters/breaker_timeout.spec.ts:8–11`

```ts
const slow = new Promise(resolve => setTimeout(resolve, 50));
await expect(withTimeout(slow, 10)).rejects.toThrow('Timeout');
```

Absolute millisecond timings (50ms/10ms) are unreliable under CI load. If the scheduler is delayed and the 50ms promise resolves before the 10ms timeout fires, the test passes spuriously — or vice versa. Use fake timers.

---

### P2-15 · `billing.security.test.ts:63` · Test Integrity · **`process.env` Mutation Not Cleaned Up Between Tests**

**File:** `apps/api/src/routes/__tests__/billing.security.test.ts:63`

```ts
process.env.STRIPE_SECRET_KEY = 'sk_test_xxx';  // in beforeEach, no afterEach restore
```

This mutates the process environment for subsequent tests in the same worker. If another test relies on `STRIPE_SECRET_KEY` being unset or having a different value, it sees a polluted value.

**Fix:** Add `afterEach(() => { delete process.env['STRIPE_SECRET_KEY']; })`.

---

## P3 — Low (Nitpick / Perfectionist)

---

### P3-1 · `BillingStatusBanner.tsx` · Accessibility · **Missing `role="alert"` on Status Banner**

Screen readers do not automatically announce `<div>` elements as important notifications. Add `role="alert"` or `<output>`.

---

### P3-2 · `BuyerSeoReportView.tsx:30` · React · **Array Index as List Key**

```tsx
{report.notes.map((n, i) => <li key={`note-${i}`}>{n}</li>)}
```

Using index as key breaks React reconciliation when the list is reordered or filtered. Use a stable key derived from the note content or a note ID.

---

### P3-3 · `billing.tsx:9` · UX / Security · **Plain `<a>` Link to Stripe Portal Instead of Authenticated POST**

```tsx
<a href='/api/stripe/portal'>Open billing portal</a>
```

A GET request to open a Stripe portal session is a state-changing operation. If the endpoint creates a session and redirects, it should be triggered from a button with an authenticated fetch POST, not a plain anchor tag. Also: no auth check on this Next.js page — unauthenticated users see the billing page (though the portal link will fail server-side).

---

### P3-4 · `billingStripe.ts:2–3`, `billingPaddle.ts:2–3` · Code Quality · **Stale/Orphaned Comment**

```ts
// Using 'as const' for type safety
```

This comment appears at the top of both files but there is no `as const` assertion in either file. Dead comment from a prior refactor.

---

### P3-5 · `packages/config/billing.ts:31–33` · Ops · **Hardcoded Stripe API Version Will Become Deprecated**

```ts
get stripeApiVersion(): '2023-10-16' { return '2023-10-16'; }
```

Stripe deprecates API versions. In 2026 this version is already approaching end-of-life. This should be a configurable env var or at minimum flagged for quarterly review.

---

### P3-6 · `bot-detection.ts:67` · Logic · **`break` After First Pattern Match Under-Scores Multi-Pattern UAs**

```ts
for (const pattern of SUSPICIOUS_USER_AGENTS) {
  if (userAgent.includes(pattern)) {
    score += 20;
    break;  // ← only scores 20 even if 10 patterns match
  }
}
```

A UA matching 5 suspicious patterns scores the same (20 points) as one matching 1. Remove the `break` and cap the loop contribution at, say, 60 points.

---

### P3-7 · `packages/kernel/validation/branded.ts:653` · Type Safety · **`unsafeBrand` Not Enforceably Internal**

```ts
export function unsafeBrand<T, B>(value: T): Brand<T, B> {
  return value as Brand<T, B>;
}
```

Marked `@internal` but TypeScript does not enforce `@internal` tags at compile time. Any consumer can `import { unsafeBrand }` and cast any string to any branded ID without UUID validation. Consider a build-time lint rule (`no-restricted-imports`) to block external usage.

---

## Ranked: Issues Most Likely to Cause an Incident Today

| Rank | ID | File | Impact |
|------|----|------|--------|
| 1 | P0-1 | `billing.security.test.ts:143` | False-positive test coverage on billing auth export route. Security regression ships silently. Blast radius: anyone with a valid JWT can access any org's invoice export if the auth path has a bug. |
| 2 | P0-4 | `billingInvoices.ts` | No rate limit on Stripe invoice listing. One token = exhausted Stripe API quota for all tenants. Blast radius: global billing DoS. |
| 3 | P0-3 | `billing.test.ts` | `redis.set` missing from mock. Double-charge protection path has zero test coverage. Blast radius: concurrent subscription creation creates double Stripe charges. |
| 4 | P0-2 | `billing.security.test.ts:117` | Test asserts wrong behavior (200 vs 401). Blast radius: masks future auth regression in invoice listing. |
| 5 | P1-6 | `BillingStatusBanner.tsx` | Trial users shown "read-only" banner. Blast radius: trial churn, activation failure. |
| 6 | P1-7 | Invoice export/listing | Silently truncated at 50 invoices. Blast radius: accounting reconciliation failures for large orgs. |
| 7 | P1-5 | CSRF/Paddle UUID regex | v7 UUIDs rejected at checkout. Blast radius: 100% checkout failure if org IDs migrate to UUIDv7. |
| 8 | P1-2 | `billingStripe.ts:78` | Redis errors swallowed in CSRF validation. Blast radius: all checkouts fail during Redis blip with no diagnostic logs. |
| 9 | P1-4 | `billing.test.ts:160` | Timeout-retry test asserts non-existent behavior. Blast radius: timeout edge case ships untested, stuck orgs cannot retry subscription. |
| 10 | P2-9 | `config/billing.ts` | JWT key length not validated. Blast radius: weak key → offline JWT forgery → billing account takeover. |
