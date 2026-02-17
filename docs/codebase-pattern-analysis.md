# Codebase Pattern Analysis

Audit of recurring patterns across the SmartBeak codebase. Each inconsistency is classified as **legacy**, **different developer style**, or **deliberate exception**.

---

## 1. Error Handling

### Canonical Pattern

Exception-based. A well-designed `AppError` hierarchy in `packages/errors/index.ts`:

- **Base class**: `AppError` (line 128) with `code`, `statusCode`, `details`, `requestId`
- **Subclasses**: `ValidationError`(400), `AuthError`(401), `ForbiddenError`(403), `NotFoundError`(404), `DatabaseError`(500), `RateLimitError`(429), `ConflictError`(409), `ServiceUnavailableError`(503), `PayloadTooLargeError`(413)
- **Error codes**: `ErrorCodes` constant (~60 machine-readable codes)
- **Catch typing**: `catch (error: unknown)` + `getErrorMessage(error)`
- **Route responses**: `errors.badRequest(res)`, `errors.notFound(res)`, etc. from `packages/errors/responses.ts`
- **Client sanitization**: `sanitizeErrorForClient()` strips internals in production
- **No result/Either types** anywhere. Purely exception-based.

### Inconsistencies

| Location | Issue | Classification |
|----------|-------|---------------|
| `control-plane/services/ai-advisory-recorder.ts:53-87` | 15+ `throw new Error(...)` for input validation instead of `ValidationError` | **Different developer style** -- hand-rolled validation with raw errors, predates Zod adoption |
| `control-plane/services/shard-deployment.ts:78-271` | 10+ `throw new Error(...)` including `'Shard not found'` (should be `NotFoundError`) | **Different developer style** |
| `control-plane/services/onboarding.ts:36-139` | 5 raw `Error` throws for validation | **Different developer style** |
| `control-plane/services/region-queue.ts:8,11` | Raw `Error` for invalid region | **Different developer style** |
| `control-plane/services/billing.ts:77` | `throw new Error('Database pool is required')` | **Different developer style** |
| `domains/content/infra/persistence/PostgresContentRepository.ts:22,34` | Raw `Error` for invalid enum values | **Legacy** -- written before `@errors` had `ValidationError` |
| `domains/notifications/infra/persistence/PostgresNotificationRepository.ts:63` | Raw `Error` for empty ID | **Legacy** |
| `packages/kernel/outbox/OutboxRelay.ts:145,182,187` | `catch (err)` without `: unknown` type | **Legacy** -- predates strict catch typing rule |
| `packages/shutdown/index.ts:96` | `catch (err)` untyped, casts as `Error` | **Legacy** |
| `apps/web/lib/auth.ts:110` | `catch (err)` untyped, manual instanceof check | **Legacy** |

**Summary**: The `@errors` package is solid. ~40 instances of raw `Error` throws concentrated in control-plane services that do manual validation instead of using `ValidationError` or Zod. Older infrastructure code predates the `catch (err: unknown)` convention.

---

## 2. Data Access

### Canonical Pattern

**Raw parameterized SQL + repository pattern.** No ORM.

- **Repositories** in `domains/*/infra/persistence/Postgres*Repository.ts` accept a `Pool` and optional `PoolClient` for transactions
- All SQL uses `$1, $2, ...` parameter placeholders (no string interpolation)
- **Transaction pattern**: `pool.connect()` then `BEGIN` then `SET LOCAL statement_timeout` then work then `COMMIT`, with `ROLLBACK` on error (including rollback error logging) and `client.release()` in `finally`
- Batch operations use `UNNEST` arrays for single-roundtrip bulk inserts
- Migrations: raw SQL pairs (`*.up.sql` / `*.down.sql`) with `IF EXISTS` guards

### Inconsistencies

| Location | Issue | Classification |
|----------|-------|---------------|
| `control-plane/services/billing.ts:170-200` | Direct pool queries in service, no repository | **Deliberate exception** -- billing is cross-cutting, touches multiple tables |
| `control-plane/api/routes/domains.ts:100-118` | Inline SQL in route handler | **Different developer style** -- should go through a repository |
| `control-plane/api/routes/diligence.ts:28-48` | Direct pool queries in route | **Deliberate exception** -- public token-based endpoint, different access pattern |
| `control-plane/services/ai-advisory-recorder.ts:89-109` | Direct `pool.query` INSERT, no repository | **Different developer style** -- standalone function, not DDD-wrapped |
| Pagination safety | Repos use `Math.min/max` clamping; routes use reject-if-exceeded | **Different developer style** -- not harmful but inconsistent |

**Summary**: Domain code follows the repository pattern cleanly. Control-plane services bypass repositories and run SQL directly -- partly deliberate (cross-cutting concerns), partly style drift.

---

## 3. Auth

### Canonical Pattern

- **Clerk** for frontend (Next.js) user auth
- **JWT** for control-plane API auth (`control-plane/services/jwt.ts`)
- Auth middleware runs as Fastify `onRequest` hook (`control-plane/api/http.ts:288-325`)
- Safe accessor: `getAuthContext(req)` from `control-plane/api/types.ts:32` (throws if missing)
- Role-based access: `requireRole(ctx, ['owner', 'admin'])` from `control-plane/services/auth.ts`
- Rate limiting runs **before** auth on auth endpoints (brute-force protection)
- Role hierarchy defined numerically in `packages/security/auth.ts:327-332`

### Inconsistencies

| Location | Issue | Classification |
|----------|-------|---------------|
| `control-plane/api/routes/seo.ts:42` | `req.auth as AuthContext` direct cast instead of `getAuthContext(req)` | **Legacy** -- written before helper existed |
| `control-plane/api/routes/search.ts:26` | Same direct cast | **Legacy** |
| `control-plane/api/routes/roi-risk.ts:22` | Same direct cast | **Legacy** |
| `control-plane/api/routes/publishing.ts:27,42,63,78,107` | 5 instances of direct cast | **Legacy** -- entire file predates the helper |
| Role checks: hierarchy vs array | `packages/security/auth.ts` uses numeric hierarchy; `control-plane/services/auth.ts` uses `.includes()` | **Deliberate exception** -- Next.js needs hierarchy (admin implies editor); API routes need explicit per-endpoint lists |

**Summary**: 19 route files use `getAuthContext(req)`, 4 route files use the legacy direct cast. The dual role-checking approach is intentional for different contexts.

---

## 4. Tests

### Canonical Pattern

| Type | Framework | Location |
|------|-----------|----------|
| Unit | Jest | `**/__tests__/*.test.ts` or co-located `*.test.ts` |
| Integration | Jest (serial) | `apps/api/tests/integration/` |
| Load/Chaos/Bench | Vitest | `test/load/`, `test/chaos/` |
| Visual regression | Playwright | `test/visual/` |
| Accessibility | Jest (jsdom) | co-located |

- `clearMocks: true` and `restoreMocks: true` globally
- Coverage: 70% branches / 80% lines globally, 90% for billing
- Naming: `describe()`/`it()` blocks, files named `*.test.ts`
- 124 test files, ~25k lines of test code

### Inconsistencies

| Location | Issue | Classification |
|----------|-------|---------------|
| 21 files use `.spec.ts` vs 99 using `.test.ts` | e.g., `apps/api/tests/publishing.spec.ts` | **Different developer style** -- cosmetic, both work |
| Some integration tests use Vitest, some Jest | `job-processing.test.ts` uses Vitest imports | **Deliberate exception** -- Vitest for tests needing ESM/worker isolation |
| `apps/api/tests/integration/webhook-processing.test.ts` | Manually saves/restores `process.env` | **Legacy** -- predates shared test setup |

**Summary**: Well-organized. The `.spec.ts` vs `.test.ts` split is cosmetic noise. The Jest/Vitest boundary is intentional.

---

## 5. Config

### Canonical Pattern

- **Centralized config package**: `packages/config/`
  - `env.ts`: typed accessors (`getEnvVar`, `parseBoolEnv`, `parseIntEnv`)
  - `schema.ts`: Zod validation of all env vars at startup
  - `features.ts`: feature flags with secure defaults (all `false`)
  - `environment.ts`: `isProduction()`, `isDevelopment()`, `isTest()`
  - `validation.ts`: `validateEnv()` for startup checks
- Import via `@config` alias

### Inconsistencies

| Location | Issue | Classification |
|----------|-------|---------------|
| `packages/errors/index.ts:170,299,422,579` | `process.env['NODE_ENV']` directly, 4 times | **Deliberate exception** -- `@errors` cannot import `@config` (circular dep) |
| `packages/kernel/logger.ts`, `redis.ts`, `redaction.ts`, `chaos.ts` | Direct `process.env['NODE_ENV']` | **Deliberate exception** -- `@kernel` is imported *by* `@config`, can't import it |
| `packages/database/redis-cluster.ts` | Direct `process.env['NODE_ENV']` | **Deliberate exception** -- lower-level package |
| `packages/monitoring/health-checks.ts` | `process.env['NODE_ENV']`, `process.env['MEMORY_LIMIT']` | **Deliberate exception** -- bootstrapped before config validation |
| `packages/monitoring/alerting.ts` | `process.env['SLACK_WEBHOOK_URL']` directly | **Different developer style** -- could use `@config` |
| `control-plane/services/storage.ts:18-22` | Direct env access for storage config | **Different developer style** -- should use `@config` |
| `apps/api/src/billing/stripe.ts:19-33` | Direct `process.env['STRIPE_SECRET_KEY']` | **Different developer style** -- should be in config |
| `apps/api/src/billing/paddle.ts` | Direct `process.env['PADDLE_API_KEY']` | **Different developer style** -- same |
| `packages/monitoring/resource-metrics.ts` | Uses `require()` instead of ESM `import` | **Legacy** -- ESM migration incomplete |
| Feature flags | `isFeatureEnabled()` not called in any route or service | **Likely gap** -- flags defined but not wired into any production gates |

**Summary**: Direct `process.env` in low-level packages (`@kernel`, `@errors`, `@database`) is a correct architectural decision to avoid circular deps. Direct access in higher-level code (`billing/`, `control-plane/services/`) is style drift. Feature flags are defined but appear unused in production code -- most actionable finding.

---

## Key Takeaways

| Area | Health | Top Action Item |
|------|--------|----------------|
| **Error handling** | Good | Migrate ~40 raw `Error` throws in control-plane services to `AppError` subclasses |
| **Data access** | Good | Control-plane services bypassing repositories is the biggest architectural inconsistency |
| **Auth** | Good | Update 4 route files from `req.auth as AuthContext` to `getAuthContext(req)` |
| **Tests** | Strong | Minor: standardize on `.test.ts` naming |
| **Config** | Good | Wire feature flags into actual production code gates; migrate billing env access to `@config` |
