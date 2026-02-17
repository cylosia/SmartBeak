# Critical Files Analysis: Highest Consequence, Lowest Protection

> Generated 2026-02-17. Identifies the 10 files where a bug would cause the most
> damage (financial loss, auth bypass, data corruption, cascade failure) relative
> to how well-protected they are today.

Methodology: Each file is ranked by `(consequence of failure) × (1 / protection level)`.
Files that are both critical AND well-tested (like `packages/security/jwt.ts` with 516
lines of tests) rank lower — the goal is to surface code that **matters most but is
under-protected**.

---

## The 10 Most Critical Under-Protected Files

### 1. `control-plane/services/billing.ts` (416 lines)

| Metric | Detail |
|--------|--------|
| **Depends on it** | Billing routes, subscription management, plan assignment (~10 consumers) |
| **Bug impact** | Financial loss (double-charges, lost subscriptions, orphaned Stripe records). The `compensateStripe()` rollback silently swallows errors — compensation failure means money taken with no DB record. |
| **Protection** | **ZERO direct unit tests.** The only billing test (`apps/api/src/routes/__tests__/billing.security.test.ts`) tests route-level invoice/checkout security, NOT the core `assignPlan()`, `cancelSubscription()`, `enterGrace()`, or `updateSubscriptionStatus()` methods. Idempotency logic is untested. The `auditLog()` only writes to `logger.info` — not to the DB audit table (comment says "In production, this would write to an audit log table" — it doesn't). |

**Risk: CRITICAL** — Financial operations with zero service-level test coverage.

---

### 2. `control-plane/services/stripe.ts` (30 lines)

| Metric | Detail |
|--------|--------|
| **Depends on it** | `BillingService` instantiates `StripeAdapter` for all payment operations |
| **Bug impact** | Silent payment failure — every method returns hardcoded success. The production guard (`if (process.env['NODE_ENV'] === 'production') throw`) runs at module load time only. `cancelSubscription()` returns `true` regardless — the caller trusts this without verification. |
| **Protection** | **ZERO tests.** No test validates the production guard. No interface/contract ensuring a real Stripe adapter implements the same methods. No TypeScript interface enforcement. |

**Risk: CRITICAL** — The payment gateway is a mock with no production implementation and zero tests.

---

### 3. `control-plane/services/membership-service.ts` (211 lines)

| Metric | Detail |
|--------|--------|
| **Depends on it** | `control-plane/api/routes/orgs.ts` — member add/update/remove. This is the authorization enforcement layer. |
| **Bug impact** | Privilege escalation (`addMember()` could allow unauthorized roles). Orphaned orgs (`removeMember()` has a last-owner check — if it fails, org loses all owners). Authorization bypass (`updateRole()` could elevate viewer to owner). |
| **Protection** | **ZERO tests.** No test for `addMember()`, `updateRole()`, `removeMember()`, last-owner protection, or duplicate checks. Audit log is logger-only (not DB). Email validation is copy-pasted from `invite-service.ts`. |

**Risk: HIGH** — Authorization enforcement with zero test coverage.

---

### 4. `control-plane/services/rate-limit.ts` (290 lines)

| Metric | Detail |
|--------|--------|
| **Depends on it** | Every API route. 39+ imports. First line of defense against abuse. |
| **Bug impact** | DDoS vulnerability if rate limiting silently fails. The overloaded `rateLimit()` function has confusing 2-arg/4-arg signatures — the 4-arg form was a P0-FIX because it was previously a no-op. Redis fallback to in-memory means distributed deployments have per-instance limits, not shared. |
| **Protection** | **ZERO unit tests** for `rateLimit()`, `checkRateLimitAsync()`, `rateLimitMiddleware()`, or `buildRateLimitKey()`. The `RedisRateLimiter` class also has no dedicated tests. |

**Risk: HIGH** — DDoS protection with zero test coverage.

---

### 5. `control-plane/services/org-service.ts` (40 lines)

| Metric | Detail |
|--------|--------|
| **Depends on it** | `control-plane/api/routes/orgs.ts` — org creation endpoint |
| **Bug impact** | Data corruption — `createOrg()` creates org + owner membership in a transaction; failure produces orgs without owners or memberships without orgs. No input validation on `name` (no length/format checks). No duplicate org check. `listMembers()` has no pagination. |
| **Protection** | **ZERO tests.** No Zod schema validation. No branded type usage (raw `string` for IDs). |

**Risk: HIGH** — Foundation of multi-tenancy with zero tests and minimal validation.

---

### 6. `control-plane/services/invite-service.ts` (192 lines)

| Metric | Detail |
|--------|--------|
| **Depends on it** | `control-plane/api/routes/orgs.ts` — invite endpoint |
| **Bug impact** | Unauthorized access — a bug in `validateRole()` could allow inviting as owner (excluded from VALID_ROLES but never tested). TOCTOU race — `checkExistingMembership()` does NOT use FOR UPDATE locking unlike the membership service equivalent. |
| **Protection** | **ZERO tests.** Email validation copy-pasted from `membership-service.ts`. `auditLog()` generates a `_correlationId` that is never used (dead code). |

**Risk: MEDIUM-HIGH** — Access control with zero tests and a subtle race condition.

---

### 7. `packages/database/pool/index.ts` (415 lines)

| Metric | Detail |
|--------|--------|
| **Depends on it** | **Every database operation.** 60+ imports. If this breaks, everything breaks. |
| **Bug impact** | Cascade failure (pool exhaustion takes down entire API). Data corruption (advisory lock bugs could allow concurrent writes). Connection leak (wrapped `client.release()` — if released via different path, semaphore permit leaks). `poolValidated` set once, never resets after DB recovery. |
| **Protection** | Transaction tests exist but test the transactions module, not the pool directly. **No direct tests for:** `acquireConnection()`, backpressure gate, `checkPoolExhaustion()`, advisory lock lifecycle, `validateSortColumn()`, pool metrics. |

**Risk: HIGH** — Single point of failure for all data access with insufficient direct testing.

---

### 8. `control-plane/services/auth.ts` (242 lines)

| Metric | Detail |
|--------|--------|
| **Depends on it** | Every authenticated route. 39 direct imports. |
| **Bug impact** | Auth bypass (`authFromHeader()` could return valid AuthContext for invalid token). Privilege escalation (`requireRole()` uses `Array.some()` + `Array.includes()`). Cross-org data access (`requireOrgAccess()` is a simple string equality check). |
| **Protection** | Has `__tests__/auth.test.ts` but tests focus on happy path. No tests for: empty roles array, roles with whitespace, P0-FIX runtime role validation, `requireAccess()` combined check, `hasRole()`/`hasOrgAccess()` boolean variants. `authFromHeader()` duplicates JWT verification logic from `packages/security/jwt.ts` — drift risk. |

**Risk: HIGH** — Central auth gate with limited edge-case test coverage.

---

### 9. `packages/errors/index.ts` (673 lines)

| Metric | Detail |
|--------|--------|
| **Depends on it** | 87+ imports. Every error response to clients flows through this. |
| **Bug impact** | Information leakage (`sanitizeErrorForClient()` is last defense before errors reach users). `shouldExposeErrorDetails()` checks `DEBUG === 'true'` — setting this in production exposes all details. ZodError detection uses duck typing (`'issues' in error`) — could match non-Zod errors. `DatabaseError.fromDBError()` sanitizes by keyword matching only. |
| **Protection** | Has `__tests__/index.test.ts` but single file for 673 lines. `shouldExposeErrorDetails()` DEBUG bypass is untested. No test validates production responses never contain SQL or stack traces. |

**Risk: MEDIUM-HIGH** — Error boundary with incomplete test coverage for info leakage.

---

### 10. `control-plane/api/routes/billing.ts` (61 lines)

| Metric | Detail |
|--------|--------|
| **Depends on it** | Client-facing billing endpoint for subscription creation and plan queries. |
| **Bug impact** | Financial — `/billing/subscribe` triggers `billing.assignPlan()`. **Auth ordering bug**: line 29 calls `rateLimit('billing', 20)` AFTER `getAuthContext()` and `requireRole()` — the P1-11 FIX (rate limit before auth) was applied to content routes but **NOT to billing routes**. Error swallowing — catch block returns `errors.internal(res)` hiding all errors including business logic errors (e.g., "already has active subscription" → should be 409). |
| **Protection** | The billing security test tests the **other** billing routes, NOT this one. **ZERO tests for `/billing/subscribe` or `/billing/plan`.** |

**Risk: MEDIUM-HIGH** — Financial endpoint with zero direct tests and an auth-before-rate-limit ordering bug.

---

## Summary: Protection Gap Matrix

| # | File | Consequence | Tests | Gap |
|---|------|------------|-------|-----|
| 1 | `control-plane/services/billing.ts` | Financial loss, double-charge | NONE | **CRITICAL** |
| 2 | `control-plane/services/stripe.ts` | Silent payment failure (mock) | NONE | **CRITICAL** |
| 3 | `control-plane/services/membership-service.ts` | Privilege escalation | NONE | **HIGH** |
| 4 | `control-plane/services/rate-limit.ts` | DDoS exposure | NONE | **HIGH** |
| 5 | `control-plane/services/org-service.ts` | Data corruption, no validation | NONE | **HIGH** |
| 6 | `control-plane/services/invite-service.ts` | Unauthorized access | NONE | **MEDIUM-HIGH** |
| 7 | `packages/database/pool/index.ts` | Cascade failure | Indirect only | **HIGH** |
| 8 | `control-plane/services/auth.ts` | Auth bypass | Partial | **HIGH** |
| 9 | `packages/errors/index.ts` | Info leakage | Minimal | **MEDIUM-HIGH** |
| 10 | `control-plane/api/routes/billing.ts` | Financial, auth ordering bug | NONE | **MEDIUM-HIGH** |

**Key pattern:** The entire `control-plane/services/` directory — containing core business
logic — has almost no unit test coverage. The security and kernel packages are well-tested,
but the services that *use* them are not.

---

## Recommended Actions (Priority Order)

1. **Add unit tests for `BillingService`** — Cover `assignPlan()` idempotency, `compensateStripe()` failure paths, `cancelSubscription()` with and without Stripe IDs
2. **Replace or interface-guard `stripe.ts`** — Define a `PaymentGateway` interface, implement both mock and real adapters, add startup check that mock is never loaded in production
3. **Add unit tests for `MembershipService`** — Last-owner removal protection, concurrent duplicate checks, role escalation paths
4. **Add unit tests for rate limiting** — Overloaded `rateLimit()`, key collision prevention, Redis fallback, middleware IP extraction
5. **Fix billing route auth ordering** — Move `rateLimit()` before `getAuthContext()` to match P1-11 fix applied to content routes
6. **Add unit tests for `OrgService`** — Transaction atomicity, add input validation for org name
7. **Add direct tests for database pool** — Backpressure gate, advisory lock lifecycle, pool exhaustion detection
8. **Expand auth.ts edge-case tests** — Empty roles, whitespace, `requireAccess()`, P0-FIX runtime validation
9. **Test error sanitization in production mode** — Verify `sanitizeErrorForClient()` never leaks SQL/stack traces, document or remove `DEBUG=true` bypass
10. **Deduplicate email validation** — Extract shared validation from `membership-service.ts` and `invite-service.ts`
