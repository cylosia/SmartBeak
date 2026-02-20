# HOSTILE CODE REVIEW: Files Starting With "j" — Financial-Grade Audit

**Date**: 2026-02-20
**Scope**: 12 files with filenames starting with "j" (excluding node_modules, dist, .next)
**Standard**: Financial-grade — assume every line has a bug until proven otherwise

## Files Audited (12)

| # | File | Lines | Role |
|---|------|-------|------|
| 1 | `apps/api/src/jobs/jobGuards.ts` | 134 | Job concurrency guards |
| 2 | `apps/api/tests/integration/job-processing.test.ts` | 345 | Integration tests |
| 3 | `apps/web/pages/system/jobs.tsx` | 29 | Admin UI page |
| 4 | `control-plane/services/__tests__/jwt-signing.test.ts` | 101 | JWT signing tests |
| 5 | `control-plane/services/jwt.ts` | 656 | JWT service (sign, revoke, verify) |
| 6 | `jest.config.ts` | 162 | Test runner config |
| 7 | `packages/config/jobs.ts` | 113 | Job queue config |
| 8 | `packages/kernel/validation/jsonb.ts` | 173 | JSONB validation |
| 9 | `packages/monitoring/jobOptimizer.ts` | 481 | Job coalescing/scheduling |
| 10 | `packages/security/__tests__/jwt.test.ts` | 521 | JWT verification tests |
| 11 | `packages/security/jwt.ts` | 519 | JWT verification (canonical) |
| 12 | `test/factories/job.ts` | 121 | Test factory |

---

## CRITICAL (P0) — Production outage, data loss, security breach imminent

### P0-1: TOCTOU Race Condition in Job Capacity Guard — Concurrency Limit Bypass

- **File:Line**: `apps/api/src/jobs/jobGuards.ts:53-84`
- **Category**: SQL | Concurrency
- **Violation**: `assertOrgCapacity` reads the active job count (lines 56-58), then returns control to the caller who inserts a new job in a separate operation. No transaction, no lock, no atomic check-and-insert. Two concurrent requests both read count=9 (limit=10), both pass the check, both insert → 11 jobs running, limit violated.
- **Fix**: Use advisory lock within a transaction:
  ```sql
  BEGIN;
  SELECT pg_advisory_xact_lock(hashtext('org_capacity:' || $1));
  SELECT count(*) FROM job_executions WHERE status='started' AND entity_id=$1;
  -- if under limit, INSERT the new job within same transaction
  COMMIT;
  ```
- **Risk if not fixed**: Under any concurrent load, the 10-job-per-org limit is unenforced. A single org can exhaust the entire job worker pool, causing denial-of-service for all other orgs.
- **Blast radius**: All orgs, entire job processing system.

### P0-2: JWT Revocation Fail-Open on Redis Outage — Revoked Tokens Accepted

- **File:Line**: `control-plane/services/jwt.ts:421-448`
- **Category**: Security
- **Violation**: When the circuit breaker is open (Redis down), `isTokenRevoked()` returns `false` (lines 424, 446). All revoked tokens are treated as valid. An attacker who triggers Redis unavailability (or waits for a natural outage) can use revoked/compromised tokens indefinitely.
- **Fix**: Fail-closed — reject tokens when revocation cannot be verified:
  ```typescript
  if (isCircuitOpen()) {
    logger.error('Redis unavailable, rejecting token (fail-closed)');
    throw new AuthError('Token verification unavailable', 'REVOCATION_CHECK_FAILED');
  }
  ```
- **Risk if not fixed**: Compromised tokens cannot be revoked during Redis outages. `revokeAllUserTokens()` becomes security theatre.
- **Blast radius**: All authenticated endpoints, all users, duration of Redis downtime.

### P0-3: Placeholder Regex Rejects Legitimate JWT Keys Containing "key"

- **File:Line**: `control-plane/services/jwt.ts:243`
- **Category**: Security | Configuration
- **Violation**: `const placeholderPatterns = /placeholder|example|test|demo|secret|key/i;` matches the substring `key` within any key value (e.g., `a1b2c3d4e5f6a1b2c3d4keY5f6a1b2c3`). Unlike `packages/config/env.ts:15` which uses word boundaries, this regex uses no word boundaries. On key rotation, a randomly-generated key containing "key" crashes the app at startup with `InvalidKeyError`.
- **Fix**: Use word boundaries or exact matches:
  ```typescript
  const placeholderPatterns = /^(placeholder|example|test|demo|secret|changeme)$/i;
  ```
  Or adopt the same `PLACEHOLDER_PATTERN` from `packages/config/env.ts`.
- **Risk if not fixed**: Random production key rotation failure → complete outage.
- **Blast radius**: Entire application; startup failure = total downtime.

### P0-4: `closeJwtRedis()` Never Called — Redis Connection Leak on Shutdown

- **File:Line**: `control-plane/services/jwt.ts:650-655`
- **Category**: Deployment | Resource Leak
- **Violation**: `closeJwtRedis()` is exported but never called anywhere — confirmed by grep. The JWT Redis connection (created by `getRedisClient()` at line 291) is separate from kernel Redis. No shutdown handler closes it. On graceful shutdown, this connection hangs open, blocking clean process exit and delaying Kubernetes pod termination.
- **Fix**: Register in shutdown handler:
  ```typescript
  // In shutdown/graceful-shutdown module:
  import { closeJwtRedis } from '../control-plane/services/jwt';
  process.on('SIGTERM', async () => { await closeJwtRedis(); });
  ```
- **Risk if not fixed**: Slow deployments, pods stuck in `Terminating` state, Redis connection exhaustion during rolling deploys.
- **Blast radius**: All deployments, Redis server.

---

## HIGH (P1) — Likely bugs under load, security vulnerabilities, data corruption

### P1-1: Missing Composite Index for Job Capacity Query

- **File:Line**: `apps/api/src/jobs/jobGuards.ts:56-58` / migrations
- **Category**: SQL | Performance
- **Violation**: The query `WHERE status='started' AND entity_id=?` runs COUNT(*) on `job_executions`. Existing indexes are separate single-column: `idx_job_executions_entity_id(entity_id)`, `idx_job_executions_status(status)`. No composite `(status, entity_id)` index exists. The partial index `idx_job_executions_queue` covers `status IN ('pending', 'retrying')` — not `'started'`.
- **Fix**: Add migration:
  ```sql
  CREATE INDEX CONCURRENTLY idx_job_executions_status_entity
    ON job_executions(status, entity_id)
    WHERE status = 'started';
  ```
- **Risk**: As `job_executions` grows, COUNT query slows linearly, blocking job scheduling.

### P1-2: Vitest Tests Running Under Jest — Silent False Passes

- **File:Line**: `jest.config.ts:55-63`
- **Category**: Testability
- **Violation**: Two vitest test files are NOT excluded from Jest's `testPathIgnorePatterns`:
  - `control-plane/services/__tests__/jwt-signing.test.ts` (imports `vi` from `'vitest'`)
  - `packages/security/__tests__/jwt.test.ts` (imports `vi` from `'vitest'`)

  Jest's testMatch `**/__tests__/**/*.test.ts` picks up both files. Under Jest, vitest APIs (`vi.mock`, `vi.fn`) are undefined — mocks don't function, tests silently pass without exercising production code.
- **Fix**: Add to `testPathIgnorePatterns`:
  ```typescript
  'control-plane/services/__tests__/jwt-signing.test.ts',
  'packages/security/__tests__/jwt.test.ts',
  ```
- **Risk**: JWT signing and verification regressions ship undetected. Coverage numbers are inflated.

### P1-3: `batchSchedule` Casts `JobData[]` to `JobData` — Runtime Type Lie

- **File:Line**: `packages/monitoring/jobOptimizer.ts:431`
- **Category**: Type
- **Violation**: `batch as unknown as JobData` — `batch` is `JobData[]` (an array), but `JobData` is `Record<string, unknown>`. An array is not a Record. Downstream code: `Object.entries(data)` yields `["0", item1], ["1", item2]`; coalescing key extractors call `data['domainId']` which returns undefined; coalescing keys become `"domain:undefined"`.
- **Fix**: Wrap the batch:
  ```typescript
  await this.scheduleWithCoalescing(jobName, { items: batch }, { priority: 'background' });
  ```
- **Risk**: Batch-scheduled jobs produce garbage coalescing keys, causing incorrect deduplication.

### P1-4: UserRole Schema Drift — 'buyer' Missing in 4 Files

- **File:Line**: Cross-file
- **Category**: Type | Security
- **Violation**: `packages/security/jwt.ts:38` and `control-plane/services/jwt.ts:52` define 5 roles including `'buyer'`. Four other files define UserRole with only 4 roles (missing `'buyer'`):
  - `packages/security/auth.ts:361`
  - `packages/types/auth.ts:27`
  - `packages/kernel/validation/types.ts:370`
  - `apps/web/lib/auth.ts:8`

  Any code path validating role through these files rejects buyer-role tokens.
- **Fix**: Add `'buyer'` to all 4 files, or consolidate into a single source of truth.
- **Risk**: All buyer-role users get 401/403 errors on affected code paths.

### P1-5: `getOptimalPriority` Uses Server Local Time, Not UTC

- **File:Line**: `packages/monitoring/jobOptimizer.ts:283`
- **Category**: Architecture
- **Violation**: `const hour = new Date().getHours()` returns server local time. In multi-region deployment, servers in different timezones assign different priorities to the same job.
- **Fix**: `const hour = new Date().getUTCHours()` and document windows are UTC.
- **Risk**: Priority scheduling is non-deterministic across regions.

### P1-6: `parseIntEnv` Has No Upper/Lower Bounds Validation

- **File:Line**: `packages/config/env.ts:41-51`, consumed by `packages/config/jobs.ts`
- **Category**: Configuration | Resilience
- **Violation**: `parseIntEnv` accepts any integer including negatives and astronomically large values. `JOB_WORKER_CONCURRENCY=1000000` or `JOB_BATCH_SIZE=-1` causes resource exhaustion or undefined behavior.
- **Fix**: Add `min`/`max` parameters to `parseIntEnv`.
- **Risk**: Env var misconfiguration → OOM or infinite loops.

### P1-7: `jobGuards.ts` Throws Bare `Error`, Not `AppError` Subclasses

- **File:Line**: `apps/api/src/jobs/jobGuards.ts:62,73,83,121,129`
- **Category**: Architecture | Error Handling
- **Violation**: All 5 throws use `new Error(...)` instead of `AppError` subclasses. Bypasses error sanitization, structured error codes, and HTTP status mapping. Capacity-limit errors produce 500 instead of 429.
- **Fix**: Line 83 → `RateLimitError`; lines 62/121 → `DatabaseError`; lines 73/129 → `ValidationError`.

### P1-8: `orgId: string` Not Using Branded Types

- **File:Line**: `apps/api/src/jobs/jobGuards.ts:22-25,53,114`
- **Category**: Type
- **Violation**: Uses plain `string` for `orgId`, `id`, `entity_id` instead of branded types (`OrgId`). A `UserId` can be accidentally passed where `OrgId` is expected with no compile-time error.
- **Fix**: `import type { OrgId } from '@kernel/branded';` and update signatures.

---

## MEDIUM (P2) — Technical debt, maintainability, performance degradation

### P2-1: `truncateJSONB` Missing Try/Catch on `JSON.stringify`

- **File:Line**: `packages/kernel/validation/jsonb.ts:137`
- **Category**: Error Handling
- **Violation**: `calculateJSONBSize` and `serializeForJSONB` have try/catch around `JSON.stringify` (P0-FIX), but `truncateJSONB` at line 137 does not. Circular references crash the caller.
- **Fix**: Wrap in try/catch.

### P2-2: Size Calculation Inconsistency in JSONB Module

- **File:Line**: `packages/kernel/validation/jsonb.ts:32-46` vs `115`
- **Category**: Architecture
- **Violation**: `calculateJSONBSize` uses manual UTF-8 byte counting (lines 32-46). `serializeForJSONB` uses `Buffer.byteLength` (line 115). Different results for same input on edge-case Unicode. Validation and serialization disagree on sizes.
- **Fix**: Standardize on `Buffer.byteLength` everywhere.

### P2-3: `truncateJSONB` Truncation Heuristic Can Overshoot

- **File:Line**: `packages/kernel/validation/jsonb.ts:160-168`
- **Category**: Correctness
- **Violation**: Fixed 10-byte overhead estimate per field key underestimates for long key names. No post-truncation size check. Truncated output can still exceed `maxSize`.
- **Fix**: Add final size validation after truncation.

### P2-4: Admin Page Has No Role-Based Authorization

- **File:Line**: `apps/web/pages/system/jobs.tsx:20-28`
- **Category**: Security
- **Violation**: `getServerSideProps` calls `authFetch(apiUrl('system/health'))` which is a PUBLIC endpoint (confirmed at `control-plane/api/http.ts:542`) — it only checks that the user is logged in, not their role. Any viewer-role user can access the admin system jobs page. Compare to the CORRECT pattern in `apps/web/pages/system/feature-flags.tsx:177-191` which calls `admin/flags` (role-gated endpoint) and `apps/web/pages/system/cache.tsx:325-347` which queries the DB for owner/admin role.
- **Related finding** (out-of-scope but critical): `apps/web/pages/system/incidents.tsx` has NO `getServerSideProps` at all — zero auth, accessible by unauthenticated users.
- **Fix**: Call a role-gated endpoint like `admin/jobs` or check user role explicitly, matching the pattern in `feature-flags.tsx`.

### P2-5: Admin Page Renders Hardcoded Static Content

- **File:Line**: `apps/web/pages/system/jobs.tsx:11-16`
- **Category**: Architecture
- **Violation**: Displays hardcoded "Keyword ingestion — completed" instead of real job data. Misleading to operators in production.

### P2-6: Dual Redis Connections — JWT Service Creates Own

- **File:Line**: `control-plane/services/jwt.ts:291-309`
- **Category**: Architecture | Resource
- **Violation**: `getRedisClient()` creates standalone `new Redis(url)` separate from `@kernel/redis`. Doubles connection pool, duplicates error handling, no health check integration.
- **Fix**: Use `getRedis()` from `@kernel/redis`.

### P2-7: `getTokenInfo` Returns `isRevoked: false` for Unverified Tokens

- **File:Line**: `control-plane/services/jwt.ts:572`
- **Category**: Security | API Contract
- **Violation**: `getTokenInfo` uses `jwt.decode` (no verification) and returns `isRevoked: false`. Semantically "unknown", not "false". Callers who trust this field make incorrect decisions.
- **Fix**: Change to `isRevoked: undefined` or remove the field.

### P2-8: `refreshToken` Has Unused Parameter

- **File:Line**: `control-plane/services/jwt.ts:591`
- **Category**: Architecture
- **Violation**: `_expiresIn` parameter is accepted but never used. Callers passing custom expiry get default expiration silently.
- **Fix**: Implement the parameter or remove it.

### P2-9: `scheduleCoalesced` Drops Jobs on Scheduler Failure

- **File:Line**: `packages/monitoring/jobOptimizer.ts:240-250`
- **Category**: Resilience
- **Violation**: Deletes key from `pendingJobs` before calling `scheduler.schedule()`. On failure, job is logged but permanently lost.
- **Fix**: Delete from `pendingJobs` only after successful scheduling.

### P2-10: Missing Jest Module Aliases

- **File:Line**: `jest.config.ts:85-93`
- **Category**: Testability
- **Violation**: Root `moduleNameMapper` missing aliases: `@monitoring`, `@utils/*`, `@types/*`, `@domain/*`, `@adapters/*`, `@packages/*`, `@shutdown`.
- **Fix**: Add missing aliases matching tsconfig paths.

### P2-11: `EventEmitter` Without Typed Events or `maxListeners`

- **File:Line**: `packages/monitoring/jobOptimizer.ts:64`
- **Category**: Architecture
- **Violation**: Default maxListeners=10. Untyped events allow typos. No `destroy()` method.
- **Fix**: Set `this.setMaxListeners(50)`, define typed event map, add `destroy()`.

### P2-12: `exportConfig.defaultFormat` Not Validated

- **File:Line**: `packages/config/jobs.ts:87`
- **Category**: Configuration
- **Violation**: Accepts any string from env var without validation.
- **Fix**: Validate against `['json', 'csv', 'xlsx']`.

---

## LOW (P3) — Style, nitpicks

### P3-1: Duplicated Count Query Logic

- **File:Line**: `apps/api/src/jobs/jobGuards.ts:56-67` and `115-131`
- **Violation**: `assertOrgCapacity` and `getOrgActiveJobCount` duplicate identical query+validation+NaN-check logic.
- **Fix**: Extract `getValidatedJobCount(db, orgId)` helper.

### P3-2: Custom Database Interfaces Defined Locally

- **File:Line**: `apps/api/src/jobs/jobGuards.ts:35-46`
- **Violation**: `Database`/`KnexQueryBuilder` interfaces duplicate what should come from `@database`.

### P3-3: Pipeline Mock Doesn't Match Redis Shape

- **File:Line**: `apps/api/tests/integration/job-processing.test.ts:30-31`
- **Violation**: Mock `exec()` returns `[]` but real ioredis returns `Array<[Error|null, unknown]>`.

### P3-4: Test Factory Return Types Are Implicit

- **File:Line**: `test/factories/job.ts:21`
- **Violation**: `createJob` returns anonymous object with no explicit type.

### P3-5: Hardcoded Redis URL in Integration Test

- **File:Line**: `apps/api/tests/integration/job-processing.test.ts:52`
- **Violation**: `new JobScheduler('redis://localhost:6379')` hardcodes URL.

### P3-6: `JobExecution.status` is Untyped String

- **File:Line**: `apps/api/src/jobs/jobGuards.ts:23`
- **Violation**: `status: string` allows any string instead of DB enum union.

---

## IMMEDIATE PRODUCTION INCIDENT RANKING

| Rank | Issue | Incident Type | Blast Radius | Likelihood |
|------|-------|---------------|--------------|------------|
| 1 | **P0-1**: TOCTOU race in `assertOrgCapacity` | Org runs unlimited jobs, starves all others | All orgs, all job processing | **Certain** under concurrent load |
| 2 | **P0-3**: Placeholder regex rejects "key" in JWT keys | App crash on startup after key rotation | Complete outage (0% availability) | ~0.01-0.1% per key rotation |
| 3 | **P0-2**: Revocation fail-open on Redis outage | Revoked/compromised tokens accepted | All auth endpoints, all users | **Certain** during any Redis outage |
| 4 | **P1-4**: Buyer role schema drift | All buyer-role users get 401/403 | All buyer users in affected code paths | **Certain** for buyer users |
| 5 | **P1-2**: Vitest tests under Jest | JWT regressions ship undetected | All authenticated endpoints | Depends on change frequency |
| 6 | **P1-3**: Array→Record type lie in batchSchedule | Batch jobs produce garbage coalescing | All batch-scheduled jobs | **Certain** when used |
| 7 | **P0-4**: `closeJwtRedis()` never called | Slow deployments, pod termination delays | K8s cluster, Redis | Every deployment |
