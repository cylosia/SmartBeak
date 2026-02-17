# Test Coverage Analysis

**Date**: 2026-02-17
**Scope**: Full codebase audit of test presence, quality, and gaps

---

## 1. Coverage by File Presence (~15.6%)

| Area | Source Files | Test Files | File Coverage |
|---|---|---|---|
| control-plane/ | 151 | 11 | 7% |
| domains/ | 93 | 15 | 16% |
| packages/ | 166 | 27 | 16% |
| apps/ | 409 | 48 | 12% |
| **Total** | **~809** | **~126** | **~15.6%** |

### Strongest coverage
- `packages/security/` — 56% (SSRF, JWT, key rotation, input validation, session binding)
- `packages/config/` — 40% (env validation, secrets, security config, feature flags)
- `apps/api/src/middleware/` — fully covered (CSRF, abuse guard, rate limiter)

### Weakest coverage
- `control-plane/api/routes/` — 0% (37 route files, 0 tests)
- `apps/web/` — 1.1% (181 components, 2 tests)
- `apps/api/src/seo/` — 0% (12 SEO modules, 0 tests)
- `control-plane/services/` — 16% (11 of 69 services tested)
- `domains/*/application/` — 33% (3 of 9 domains have handler tests)

---

## 2. Test Quality Assessment

### Behavior vs implementation detail testing: 7/10

Tests are **mostly behavior-focused** in security and infrastructure packages. SSRF tests
check allow/block outcomes. JWT tests use the real `jsonwebtoken` library. Error tests
verify the full sanitization pipeline.

**Problem areas:**
- Rate limiter tests mock Redis pipeline internals and verify call counts instead of
  testing "user blocked / user allowed" outcomes
- Event bus tests reimplement `runSafely` in mocks, then verify mock call arguments
- Some domain tests are too minimal to provide value (e.g., `content.revision.test.ts`
  is 10 lines testing one shallow assertion)

### Mock coupling: 5/10

Heavy mock coupling in `rateLimiterRedis.test.ts` (rebuilds entire Redis pipeline API),
`event-bus.test.ts` (reimplements safe handler), and several service tests that verify
`mock.calls` without checking observable effects.

---

## 3. Critical Untested Paths

### Control-plane API routes — 0% coverage (37 files)
No route-level tests for Zod schema validation, auth enforcement, error responses,
or HTTP contracts. Includes billing, org management, publishing, domains, and content
routes.

### Control-plane billing service — 0% coverage
`control-plane/services/billing.ts` handles Stripe compensation, idempotency, and
transactions. The jest.config.ts mandates 90% for billing paths, but this service has
no test file.

### Domain application handlers — 67% of domains untested
Use-case handlers (CreateDraft, PublishContent, ScheduleContent, SaveRevision,
UpdateDraft) in `domains/content/application/handlers/` have zero tests.

### Individual job handlers — 0% coverage
Scheduler/worker infrastructure is tested, but `publishExecutionJob.ts`,
`domainExportJob.ts`, `contentIdeaGenerationJob.ts`, and 4+ other job files are not.

### Frontend — 1.1% coverage
181 React/TSX files, 2 test files (both Clerk webhook tests). No component, form,
or routing tests.

---

## 4. Flaky Test Indicators

### Confirmed flaky test (fixed)
`apps/api/src/routes/__tests__/adminAuditExport.security.test.ts:172` — comment reads:
"P1-FIX: Replaced flaky wall-clock timing test with a deterministic check."

### Timing-dependent tests (46 instances of setTimeout in tests)
- `test/chaos/graceful-shutdown-chaos.test.ts` — 35-second sleep
- `test/performance/p1-fixes.integration.test.ts` — 5.5-second sleep
- `packages/cache/__tests__/multiTierCache.memory.test.ts` — 10-second sleep

### Timeout overrides suggesting past flakiness
- `JobScheduler.concurrency.test.ts` — 30s timeout
- `multiTierCache.memory.test.ts` — 20s timeout
- Default jest timeout is 10s; several tests have 5+ second sleeps

### Mixed timer strategies
Some files use `jest.useFakeTimers()`, others `vi.useFakeTimers({ shouldAdvanceTime: true })`,
and some mix fake timers with real `setTimeout`. Inconsistency is a flakiness vector.

### No skipped tests found
No `.skip`, `xit`, `xdescribe`, or `.only` left in the codebase. Good discipline.

---

## 5. Overall Character

**Paranoid plumbing, optimistic product code.**

Security and infrastructure packages show paranoid-level testing (DNS rebinding, decimal IP
encoding, constant-time comparison, cascading circuit breaker failures). Test type diversity
is strong (unit, integration, load, chaos, a11y, visual regression, contract tests).

But business logic — routes, services, domain handlers, jobs — is largely untested. 58 of 69
control-plane services lack tests. The DDD architecture has 9 domain modules but application
use cases are mostly bare.

---

## Top 5 Missing Tests Ranked by Risk

### 1. Control-plane billing service
**File**: `control-plane/services/billing.ts`
**Risk**: Financial — double-charging, failed refunds, broken idempotency.
Orchestrates Stripe interactions, compensation logic, and transactions. Config demands
90% coverage for billing. Currently at 0%.

### 2. API route auth/validation layer
**Files**: `control-plane/api/routes/*.ts` (all 37)
**Risk**: Security — auth bypass, injection, data exposure.
No verification that auth middleware is applied, Zod schemas reject bad input, or error
responses don't leak internals. One misconfigured route exposes org data.

### 3. Content domain application handlers
**Files**: `domains/content/application/handlers/`
**Risk**: Data integrity — publishing wrong content, scheduling failures, draft corruption.
Core product workflows (PublishContent, CreateDraft, ScheduleContent) are untested at the
handler level. Domain entities have lifecycle tests but handlers coordinate across entities.

### 4. Job execution handlers
**Files**: `apps/api/src/jobs/*Job.ts`
**Risk**: Silent failures — content never publishes, exports never complete.
`publishExecutionJob.ts` pushes content to external platforms. `domainExportJob.ts` exports
customer data. Scheduler is tested; actual job logic is not.

### 5. Multi-tenant isolation
**Files**: `control-plane/services/org-service.ts`, `membership-service.ts`, route-level scoping
**Risk**: Cross-tenant data leakage.
Org management and per-org data scoping have minimal tests. One missing `WHERE org_id = $1`
clause leaks data across tenants.
