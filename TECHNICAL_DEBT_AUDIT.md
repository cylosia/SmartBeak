# Technical Debt Audit

**Date:** 2026-02-17
**Codebase:** SmartBeak monorepo
**Repo age:** 5 days (Feb 12–17, 2026)

---

## Executive Summary

The codebase contains **569 technical debt markers** across a structured annotation system. The previous developers used a priority-coded FIX comment system (P0/P1/P2/MEDIUM) rather than informal TODO/FIXME comments. There are **6 explicit TODOs**, **11 P0-CRITICAL** items, **458 P1** items, **48 race condition fixes**, **23 memory leak guards**, and **16 TOCTOU mitigations**. No tests are disabled. No FIXME/HACK/XXX comments exist.

---

## 1. TODO Comments (6 total)

All TODOs are **4–5 days old** (Feb 12–13, 2026). None have been resolved.

### Theme: Unimplemented Features / Stub Code

| File | Line | Comment | Author | Date |
|------|------|---------|--------|------|
| `control-plane/services/shard-deployment.ts` | 287 | `TODO: Implement direct file upload method in VercelAdapter` | cylosia | Feb 12 |
| `apps/web/pages/domains/[id]/integrations.tsx` | 82 | `TODO: Wire to domain_integrations table` | cylosia | Feb 13 |
| `control-plane/adapters/keywords/gsc_real.ts` | 10 | `TODO: GSC API implementation using OAuth credentials pending` | cylosia | Feb 13 |
| `apps/api/src/jobs/feedbackIngestJob.ts` | 247 | `TODO: Implement feedback metrics API integration` | Claude | Feb 13 |

### Theme: Missing Database Migrations

| File | Line | Comment | Author | Date |
|------|------|---------|--------|------|
| `control-plane/api/routes/portfolio.ts` | 40 | `TODO: Create domain_confidence migration and populate real data` | Claude | Feb 13 |
| `control-plane/api/routes/portfolio.ts` | 85 | `TODO: Create these tables via migrations and populate real data` | Claude | Feb 13 |

**Risk:** The portfolio routes are returning mock/placeholder data because the backing tables don't exist yet.

---

## 2. Apologetic / Tech Debt Comments (1 total)

| File | Line | Comment | Author | Date |
|------|------|---------|--------|------|
| `control-plane/services/shard-deployment.ts` | 15 | `@ts-expect-error -- @aws-sdk/s3-request-presigner not yet installed; tracked as tech debt` | cylosia | Feb 12 |

**Impact:** The shard deployment service suppresses a TypeScript error because a dependency is missing entirely. This means the S3 presigned URL code path will fail at runtime.

---

## 3. Warning Comments (11 total)

### Database/Migration Warnings

| File | Line | Comment |
|------|------|---------|
| `MIGRATION_FIX_TIMESTAMPTZ.sql` | 8 | `WARNING: This migration may take time on large tables` |
| `CRITICAL_DATABASE_FIXES.sql` | 4 | `WARNING: Test in staging before running in production` |
| `control-plane/db/migrations/015_fix_timestamptz.sql` | 5 | `WARNING: This migration should be run during a maintenance window` |
| `control-plane/db/migrations/020_autovacuum_configuration.sql` | 231 | `VACUUM FULL audit_events; -- WARNING: Locks table!` |

### Code Safety Warnings

| File | Line | Comment |
|------|------|---------|
| `control-plane/services/webhook-idempotency.ts` | 184 | `WARNING: This function has a TOCTOU race condition (findOne + insert is not atomic)` |
| `control-plane/services/onboarding.ts` | 135 | `WARNING: This method resets all onboarding progress. Guard usage appropriately.` |
| `packages/security/keyRotation.ts` | 109 | `WARNING: These are NOT real provider keys. In production, inject a keyGenerator` |

### Fragile Code Warnings

| File | Line | Comment |
|------|------|---------|
| `control-plane/services/auth.ts` | 155 | `Use instanceof checks instead of fragile string matching on error messages` |
| `control-plane/services/batch.ts` | 5 | `Use @kernel alias instead of fragile relative path crossing package boundaries` |
| `control-plane/services/storage.ts` | 70 | `Hard-coded parameter order was fragile` |

**Highest risk:** The webhook idempotency TOCTOU warning is a known-but-unfixed race condition that could cause duplicate webhook processing in production.

---

## 4. Disabled Tests

**None.** All 126 test files across unit, integration, load, chaos, a11y, and visual regression suites are fully enabled. No `it.skip()`, `xdescribe()`, `test.todo()`, or commented-out tests were found.

---

## 5. Structured FIX Annotation System

The codebase uses a priority-coded annotation system rather than informal comments. This is where the bulk of the technical debt lives.

### P0-CRITICAL (11 items) — Security/DoS Prevention

All 11 P0-CRITICAL items relate to **unbounded pagination** or **encryption**:

| File | Issue |
|------|-------|
| `apps/api/src/adapters/gbp/GbpAdapter.ts:539` | Use AES-256-GCM encryption for refresh tokens |
| `domains/content/infra/persistence/PostgresContentRepository.ts:234,327` | Clamp limit/offset to prevent unbounded pagination |
| `domains/media/infra/persistence/PostgresMediaRepository.ts:103` | Clamp limit/offset to prevent unbounded pagination |
| `domains/notifications/infra/persistence/PostgresNotificationRepository.ts:170,235` | Clamp limit/offset to prevent unbounded pagination |
| `domains/search/infra/persistence/PostgresIndexingJobRepository.ts:115` | Clamp limit to prevent unbounded pagination |
| `domains/search/infra/persistence/PostgresSearchIndexRepository.ts:150` | Clamp limit/offset to prevent unbounded pagination |
| `domains/seo/infra/persistence/PostgresSeoRepository.ts:109` | Clamp limit/offset to prevent unbounded pagination |
| `packages/kernel/queue/DLQService.ts:129,200` | Cap offset to prevent unbounded pagination |

**Note:** These are labeled as "FIX" comments meaning the fix is already applied. They document *what was fixed*, not *what needs fixing*. However, they indicate areas that were previously vulnerable.

### P1-FIX (458 items) — High Priority Fixes Applied

Top themes by frequency:

| Theme | Count | Example Locations |
|-------|-------|-------------------|
| **Race condition prevention** | 48 | Transactions, distributed locks, atomic operations |
| **Memory leak guards** | 23 | Bounded caches, listener cleanup, TTL expiration |
| **TOCTOU mitigations** | 16 | Atomic UPDATE, INSERT ON CONFLICT, FOR UPDATE locks |
| **Connection pool tuning** | ~15 | PgBouncer compatibility, pool sizing, timeouts |
| **Retry logic fixes** | ~12 | AbortController placement, idempotency-safe retries |
| **Buffer overflow protection** | ~8 | Analytics pipeline, event queues |
| **Magic number extraction** | 10 | Timeouts, thresholds → named constants |

### Key Hotspot Files (highest FIX density)

| File | Approx FIX count | Primary concerns |
|------|-------------------|-----------------|
| `packages/database/pgbouncer.ts` | 8+ | PgBouncer compatibility workarounds |
| `control-plane/adapters/linkedin/LinkedInAdapter.ts` | 6+ | Retry safety on non-idempotent POST |
| `packages/analytics/pipeline.ts` | 5+ | Buffer overflow, race conditions |
| `control-plane/services/webhook-idempotency.ts` | 4+ | TOCTOU race (unfixed), atomic inserts |
| `apps/api/src/routes/emailSubscribers/index.ts` | 4+ | Concurrency TOCTOU fixes |
| `packages/kernel/event-bus.ts` | 3+ | Handler limits, memory leak prevention |

---

## 6. Git Blame Timeline

The entire codebase was authored in a **5-day window** (Feb 12–17, 2026) by two contributors:

| Author | Role |
|--------|------|
| `cylosia` | Human developer, initial codebase |
| `Claude` | AI assistant, fixes and features |

All technical debt markers were introduced during initial development — there are no "aged" workarounds or long-forgotten hacks. The FIX annotations appear to be a systematic code review pass that documented and addressed issues in-place.

---

## 7. Top Pain Points — Prioritized Action Items

### Critical (fix before production)

1. **`@aws-sdk/s3-request-presigner` missing** — `shard-deployment.ts:15` uses `@ts-expect-error` to suppress a missing dependency. Will fail at runtime.
2. **Webhook idempotency TOCTOU** — `webhook-idempotency.ts:184` has an explicitly documented race condition that has NOT been fixed, only warned about.
3. **Portfolio routes return mock data** — `portfolio.ts:40,85` — backing tables and migrations don't exist.

### High (address soon)

4. **GSC adapter is a stub** — `gsc_real.ts:10` — Google Search Console integration is unimplemented.
5. **Domain integrations not wired** — `integrations.tsx:82` — UI exists but isn't connected to database.
6. **Feedback metrics stub** — `feedbackIngestJob.ts:247` — job exists but API integration is unimplemented.
7. **Vercel file upload not implemented** — `shard-deployment.ts:287` — deployment path is incomplete.

### Medium (ongoing quality)

8. **Magic numbers** — 10 locations with hard-coded timeouts/thresholds that should be constants.
9. **Fragile string matching in auth** — `auth.ts:155` — error type checking via string comparison.
10. **Migration warnings** — Several migrations require maintenance windows or staging-first testing.
11. **Key rotation uses test keys** — `keyRotation.ts:109` — placeholder keys in security code.
