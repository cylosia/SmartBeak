# Dead Code Audit Report

**Date:** 2026-02-17
**Methodology:** Static analysis via grep/glob across all 921 TypeScript source files. Conservative — only high-confidence findings are included.

---

## Summary

| Category | Items Found |
|----------|-------------|
| 1. Unused exports | 333 |
| 2. Unreferenced files | 172 |
| 3. Dead feature flags | 10 of 10 (all) |
| 4. Commented-out code blocks | 5 (1 security concern) |
| 5. Unused npm dependencies | 2 |
| 6. Unused config options | ~80 properties + 33 env vars |
| 7. Dead API endpoints | 52 across 21 route files |

---

## 1. Exported Functions/Classes That Nothing Imports

**333 confirmed unused exports** across the codebase. These are exported symbols never imported by any other file.

### Worst offenders (entire files are dead)

| File | Unused Exports | Description |
|------|---------------|-------------|
| `apps/api/src/utils/cache.ts` | 20 | Cache key utilities — never imported |
| `apps/api/src/utils/idempotency.ts` | 11 | Idempotency utilities — never imported |
| `apps/web/lib/bundle-analysis.ts` | 9 | Bundle analysis classes — never imported |
| `apps/api/src/utils/pagination.ts` | 9 | Cursor pagination — never imported |
| `packages/middleware/validation.ts` | 8 | Validation middleware — never imported |
| `packages/kernel/constants.ts` | 8 | Constants (`CIRCUIT_BREAKER`, `RETRY`, `RESOURCE_LIMITS`, `SIGNALS`, `CONTENT_STATUS`, `CONTENT_TYPE`, `JOB_STATUS`, `PUBLISHING_PLATFORM`) |
| `apps/web/hooks/use-performance.ts` | 8 | Performance hooks — no component uses them |
| `apps/web/hooks/use-api.ts` | 8 | API hooks (`useDomains`, `useThemes`, `useDomainTimeline`, `useLlmModels`, `useLlmPreferences`, `useUpdateLlmPreferences`, `useAffiliateOffers`, `useRoiRisk`) |
| `control-plane/services/jwt.ts` | 7 | JWT schemas and helpers |

### Adapter classes never instantiated

| File | Class |
|------|-------|
| `apps/api/src/adapters/email/AWeberAdapter.ts` | `AWeberAdapter` |
| `apps/api/src/adapters/email/ConstantContactAdapter.ts` | `ConstantContactAdapter` |
| `apps/api/src/adapters/email/MailchimpAdapter.ts` | `MailchimpAdapter` |
| `apps/api/src/adapters/images/StabilityImageAdapter.ts` | `StabilityImageAdapter` |
| `apps/api/src/adapters/images/CostEnforcedOpenAIImageAdapter.ts` | `CostEnforcedOpenAIImageAdapter` |
| `apps/api/src/adapters/vercel/VercelDirectUpload.ts` | `VercelDirectUploadAdapter` |
| `control-plane/adapters/affiliate/cj.ts` | `CJAdapter` |
| `control-plane/adapters/affiliate/impact.ts` | `ImpactAdapter` |

### Plugin registrations never called

| File | Function |
|------|----------|
| `plugins/media-plugin.ts` | `registerMediaPlugin` |
| `plugins/seo-plugin.ts` | `registerSeoPlugin` |
| `control-plane/services/notifications-hook.ts` | `registerNotificationsDomain` |
| `control-plane/services/publishing-hook.ts` | `registerPublishingDomain` |
| `control-plane/services/search-hook.ts` | `registerSearchDomain` |
| `control-plane/services/usage-events.ts` | `registerUsageEventHandlers` |

### Notable unused exports in control-plane/services

| File | Export |
|------|--------|
| `api-key-vault.ts` | `ApiKeyVault` class |
| `cost-metrics.ts` | `CostMetricsService` class |
| `dlq.ts` | `SafeDLQService` class |
| `domain-activity.ts` | `DomainActivityService` class |
| `publishing-status-cache.ts` | `PublishingStatusCache` class |
| `quota.ts` | `QuotaService` class |
| `usage-batcher.ts` | `UsageBatcher` class |
| `container.ts` | `resetContainer` function |
| `cache.ts` | `createCache` function |
| `rate-limit.ts` | `cleanupRateLimit` function |

### Unused domain layer exports

| File | Export |
|------|--------|
| `domains/authors/application/AuthorsService.ts` | `AuthorsService` class |
| `domains/content/application/handlers/SaveRevision.ts` | `SaveRevision` class |
| `domains/publishing/domain/entities/PublishAttempt.ts` | `PublishAttempt` class |

> Full list: 333 exports across `apps/api` (117), `apps/web` (52), `control-plane` (66), `packages` (72), `domains` (14), `plugins` (2). See agent output for the complete table.

---

## 2. Files That Nothing References

**172 orphaned files** — TypeScript source files that no other file imports.

### Largest clusters

| Area | Count | Notes |
|------|-------|-------|
| `control-plane/services/` | 41 | Standalone service modules never wired in |
| `apps/api/src/routes/` | 19 | Route handlers never registered (control-plane uses its own routes) |
| `apps/api/src/seo/` | 9 | SEO analysis modules |
| `apps/api/src/domain/` | 8 | Domain entities/logic |
| `apps/api/src/email/` | 7 | Email feature modules |
| `apps/api/src/adapters/` | 7 | Adapter implementations |
| `apps/api/src/canaries/` | 6 | Health-check canaries |
| `apps/api/src/ai/prompts/` | 6 | AI prompt templates |
| `apps/api/src/analytics/` | 5 | Analytics modules |
| `apps/api/src/billing/` | 5 | Billing logic |
| `control-plane/adapters/` | 5 | Keyword and affiliate adapters |
| `apps/web/` | 9 | Frontend libs/components |
| `control-plane/api/` | 12 | Duplicated/superseded API files |
| `domains/` | 6 | Domain entities and handlers |
| `packages/` | 5 | Shared library files |
| `plugins/` | 4 | Plugin entry points |

### Key observations

- **All 19 files in `apps/api/src/routes/`** are orphaned. The control-plane has its own route implementations in `control-plane/api/routes/`. The `apps-api-routes.ts` registry pattern exists but `registerRouteModule()` is never called.
- **41 service files in `control-plane/services/`** are never imported. These include standalone advisors, hooks, queue routing, and metric services.
- **Duplicated files exist**: `packages/database/redis-cluster.ts` (dead) vs `packages/kernel/redis-cluster.ts` (alive); `packages/kernel/validation/assertNever.ts` (dead) vs same function in `types.ts` (alive); several `control-plane/api/*.ts` files duplicated by `control-plane/api/routes/*.ts`.

---

## 3. Feature Flags That Are Permanently On or Off

**All 10 feature flags are dead.** None gates any production behavior.

| Flag | Env Var | Default | Status |
|------|---------|---------|--------|
| `enableAI` | `ENABLE_AI` | `false` | Dead — only referenced in logging, never gates code |
| `enableSocialPublishing` | `ENABLE_SOCIAL_PUBLISHING` | `false` | Dead — zero production references |
| `enableEmailMarketing` | `ENABLE_EMAIL_MARKETING` | `false` | Dead — zero production references |
| `enableAnalytics` | `ENABLE_ANALYTICS` | `false` | Dead — zero production references |
| `enableAffiliate` | `ENABLE_AFFILIATE` | `false` | Dead — zero production references |
| `enableExperimental` | `ENABLE_EXPERIMENTAL` | `false` | Dead — only referenced in logging |
| `enableBeta` | `NEXT_PUBLIC_ENABLE_BETA` | `false` | Dead — zero references, not even in tests |
| `enableChat` | `NEXT_PUBLIC_ENABLE_CHAT` | `false` | Dead — zero references, not even in tests |
| `enableCircuitBreaker` | `ENABLE_CIRCUIT_BREAKER` | `true` | Dead — nothing checks this before applying circuit breaking |
| `enableRateLimiting` | `ENABLE_RATE_LIMITING` | `true` | Dead — nothing checks this before applying rate limits |

The helper functions `isFeatureEnabled()`, `getEnabledFeatures()`, and `validateFeatureFlags()` are also never called in production code.

The database-backed `FlagService` (`control-plane/services/flags.ts`) has the same problem: flags can be set/listed via admin API, but no production code reads `FlagService.isEnabled()` to gate behavior.

### Risk

`enableCircuitBreaker` and `enableRateLimiting` give a **false sense of control** — operators might believe they can disable these features by toggling the flags, but nothing would actually change.

---

## 4. Commented-Out Code Blocks

5 instances found, all in `apps/web/`. All were introduced in the initial file-creation commits (4–5 days ago) by cylosia. Pattern: a shared-package import is commented out and replaced with a local inline stub.

| # | File | Lines | What's Commented Out | Severity |
|---|------|-------|---------------------|----------|
| 1 | `apps/web/pages/api/stripe/portal.ts` | 8–9 | `@security/logger` → identity no-op for `sanitizeForLogging` | **HIGH — sensitive data not sanitized in Stripe error path** |
| 2 | `apps/web/lib/db.ts` | 11–17 | `@kernel/logger` → no-op logger (all DB shutdown logs silenced) | Medium |
| 3 | `apps/web/lib/shutdown.ts` | 18–24 | `@kernel/logger` → no-op logger (shutdown errors invisible) | Medium |
| 4 | `apps/web/lib/auth.ts` | 5–15 | `@security/jwt` types → local re-declaration (upstream now fixed) | Medium — type drift |
| 5 | `apps/web/lib/providers.ts` | 7–10 | `@config` `getOptionalEnv` → trivial stub | Low |

### Highest priority

**`apps/web/pages/api/stripe/portal.ts:8-9`** — `sanitizeForLogging` is replaced with `(obj) => obj` (identity function). This means Stripe error messages can leak API keys or customer PII into logs.

---

## 5. Unused npm Dependencies

| Package | Location | Type | Confidence |
|---------|----------|------|------------|
| `@testing-library/jest-dom` | root `package.json` | devDependency | 95% — no imports, no custom matchers used (`toBeInTheDocument()` etc.) |
| `knex` | `apps/web/package.json` | dependency | 95% — web app uses `pg` directly; `knex` is used elsewhere but has its own declarations |

---

## 6. Config Options That Aren't Read Anywhere

### Entire dead config modules

| Module | File | Properties | Notes |
|--------|------|-----------|-------|
| `storage.ts` | `packages/config/storage.ts` | ~20 env vars, 8 functions | Never imported by any file. Not re-exported from `@config`. |
| `exportConfig` | `packages/config/jobs.ts:83-90` | 3 properties | Re-exported but never consumed |
| `resourceLimits` | `packages/config/limits.ts` | 6 properties | No code accesses any property |
| `abuseGuardConfig` | `packages/config/security.ts:135-144` | 4 properties | Only in tests |

### Partially dead config objects

| Config Object | Dead Properties | Alive Properties |
|--------------|----------------|-----------------|
| `securityConfig` | `bcryptRounds`, `jwtExpirySeconds`, `jwtClockToleranceSeconds`, `jwtMaxAgeSeconds`, `maxFailedLogins`, `lockoutDurationMinutes`, `maxRateLimitStoreSize`, `rateLimitCleanupIntervalMs` (8) | `rateLimitWindowMs`, `rateLimitMaxRequests` (2) |
| `jobConfig` | `maxRetryDelayMs`, `highPriorityTimeoutMs`, `exportTimeoutMs`, `publishingTimeoutMs` (4) | Other properties alive |
| `publishingConfig` | `maxScheduledPerUser`, `defaultTimeoutMs`, `maxRetries` (3) | Other properties alive |
| `dbConfig` | `poolSize`, `statementTimeoutMs`, `connectionTimeoutMs` (3) | `queryTimeoutMs` (1) |
| `cacheConfig` | `defaultTtlSeconds`, `abortControllerCacheMax`, `abortControllerCacheTtlMs`, `circuitBreakerCacheTtlMs` (4) | Other properties alive |
| `envConfig` | `version`, `buildTimestamp`, `gitCommit` (3) | Other properties alive |

### Dead re-export file

`apps/web/lib/config.ts` re-exports `featureFlags`, `isFeatureEnabled`, `apiConfig`, `securityConfig`, and `getEnvVar` from `@config`, but no file in `apps/web/` imports from it.

### Env vars in `.env.example` never read by any code (33 vars)

`LINKEDIN_REDIRECT_URI`, `TIKTOK_REDIRECT_URI`, `NEXT_PUBLIC_CACHE_VERSION`, `NEXT_PUBLIC_CACHE_PREFIX`, `NEXT_PUBLIC_CACHE_DEFAULT_TTL_SECONDS`, `NEXT_PUBLIC_CACHE_MAX_KEY_LENGTH`, `NEXT_PUBLIC_API_TIMEOUT_MS`, `NEXT_PUBLIC_API_RATE_LIMIT_PER_MINUTE`, `NEXT_PUBLIC_API_MAX_REQUEST_SIZE`, `NEXT_PUBLIC_PAGINATION_DEFAULT_LIMIT`, `NEXT_PUBLIC_PAGINATION_MAX_LIMIT`, `NEXT_PUBLIC_JWT_CLOCK_TOLERANCE_SECONDS`, `NEXT_PUBLIC_JWT_MAX_AGE_SECONDS`, `ABUSE_MAX_CONTENT_SIZE`, `ABUSE_REGEX_TIMEOUT_MS`, `ABUSE_CONTENT_WARNING_THRESHOLD`, `ABUSE_CONTENT_HIGH_THRESHOLD`, `ABUSE_CONTENT_CRITICAL_THRESHOLD`, `ABUSE_WARNING_RISK_SCORE`, `ABUSE_HIGH_RISK_SCORE`, `ABUSE_CRITICAL_RISK_SCORE`, `ABUSE_HIGH_RISK_THRESHOLD`, `ABUSE_CRITICAL_RISK_THRESHOLD`, `ABUSE_ALLOWED_OVERRIDE_ROLES`, `EXPORT_MAX_DOWNLOAD_SIZE`, `EXPORT_MAX_CSV_ROWS`, `EXPORT_CSV_BATCH_SIZE`, `EXPORT_MARKDOWN_BATCH_SIZE`, `EXPORT_MARKDOWN_MAX_ITEMS`, `EXPORT_LOCAL_EXPIRY_DAYS`, `EXPORT_DOWNLOAD_EXPIRY_DAYS`, `EXPORT_MARKDOWN_SNIPPET_LENGTH`, `PUBLISHING_DEFAULT_BACKOFF_MS`, `PUBLISHING_MAX_DELAY_MS`

### Env var name mismatches (`.env.example` vs code)

These are silently ignored — the `.env.example` name does not match what the code actually reads:

| `.env.example` Name | Code Actually Reads | File |
|---------------------|---------------------|------|
| `REDIS_WAIT_TIMEOUT_MS` | `REDIS_WAIT_FOR_CONNECTION_MS` | `packages/config/cache.ts:67` |
| `CONTENT_IDEA_DEFAULT_MAX` | `CONTENT_IDEA_DEFAULT_MAX_IDEAS` | `packages/config/jobs.ts:59` |
| `CONTENT_IDEA_AI_RESET_TIMEOUT_MS` | `CONTENT_IDEA_AI_RESET_MS` | `packages/config/jobs.ts:77` |
| `PUBLISHING_CB_FAILURE_THRESHOLD` | `PUBLISHING_CIRCUIT_FAILURE_THRESHOLD` | `packages/config/jobs.ts:107` |
| `PUBLISHING_CB_RESET_TIMEOUT_MS` | `PUBLISHING_CIRCUIT_RESET_MS` | `packages/config/jobs.ts:109` |
| `PUBLISHING_CB_HALF_OPEN_MAX_CALLS` | `PUBLISHING_CIRCUIT_HALF_OPEN_MAX` | `packages/config/jobs.ts:111` |

---

## 7. API Endpoints With No Callers

**52 dead endpoints** across 21 route files. No frontend code, tests, or other services call them.

### Tier A: Route files not registered (completely unreachable)

| File | Endpoints | Method + Path |
|------|-----------|---------------|
| `shard-deploy.ts` | 3 | `POST /deploy`, `GET /:siteId/versions`, `POST /:siteId/rollback` |
| `content-list.ts` | 1 | `GET /content` (explicitly removed: "C3-FIX: duplicate conflict") |

### Tier B: Registered but zero callers

| Route File | # | Dead Endpoints |
|-----------|---|----------------|
| `publishing.ts` | 5 | `GET/POST /publishing/targets`, `GET /publishing/jobs`, `GET /publishing/jobs/:id`, `POST /publishing/jobs/:id/retry` |
| `notifications-admin.ts` | 5 | `GET /admin/notifications`, `POST /admin/notifications/:id/retry`, `GET /admin/notifications/dlq`, `GET /admin/notifications/metrics`, `POST /admin/notifications/:id/cancel` |
| `orgs.ts` | 4 | `POST /orgs`, `GET /orgs/:id/members`, `POST /orgs/:id/invite`, `POST /orgs/:id/members` |
| `content.ts` (partial) | 3 | `PATCH /content/:id`, `POST /content/:id/publish`, `DELETE /content/:id` |
| `queues.ts` | 3 | `GET /admin/dlq`, `POST /admin/dlq/:id/retry`, `DELETE /admin/dlq/:id` |
| `billing.ts` | 2 | `POST /billing/subscribe`, `GET /billing/plan` |
| `media.ts` | 2 | `POST /media/upload-intent`, `POST /media/:id/complete` |
| `onboarding.ts` | 2 | `GET /onboarding`, `POST /onboarding/step/:step` |
| `guardrails.ts` (partial) | 2 | `POST /alerts`, `GET /alerts` |
| `publishing-create-job.ts` | 1 | `POST /publishing/jobs` |
| `publishing-preview.ts` | 1 | `GET /publishing/preview/facebook` |
| `planning.ts` | 1 | `GET /planning/overview` |
| `queue-metrics.ts` | 1 | `GET /admin/queues/metrics` |
| `media-lifecycle.ts` | 1 | `GET /admin/media/lifecycle` |
| `content-schedule.ts` | 1 | `POST /content/:id/schedule` |
| `content-revisions.ts` | 1 | `GET /content/:id/revisions` |
| `seo.ts` | 1 | `POST /seo/:id` |
| `billing-invoices.ts` (partial) | 1 | `GET /billing/invoices/export` |
| `domain-ownership.ts` | 1 | `POST /domains/:id/transfer` (frontend does this via Next.js API route directly) |
| `domains.ts` (partial) | 1 | `GET /domains/allowance` |
| `usage.ts` | 1 | `GET /usage` |
| `analytics.ts` | 1 | `GET /analytics/content/:id` |
| `search.ts` | 1 | `GET /search` |
| `notifications.ts` (partial) | 1 | `GET /notifications` |

---

## Recommended Cleanup Priority

### P0 — Security concern
- **`apps/web/pages/api/stripe/portal.ts:8-9`**: Restore `sanitizeForLogging` from `@security/logger`. The current no-op identity stub means Stripe errors can leak API keys and PII into logs.

### P1 — False safety guarantees
- **`enableCircuitBreaker` / `enableRateLimiting` flags**: Either wire them into the actual middleware or remove them. Operators currently have no real toggle.
- **6 env var name mismatches**: `.env.example` values are silently ignored because the code reads different variable names.

### P2 — Large dead code clusters (easy wins)
- **`apps/api/src/routes/`** (19 files): Entire directory of route handlers never registered.
- **`control-plane/services/`** (41 files): Standalone services never wired in.
- **`apps/api/src/utils/cache.ts`**, **`idempotency.ts`**, **`pagination.ts`**: Entirely dead utility files.
- **`packages/config/storage.ts`**: Entire config module never imported.
- **`apps/web/lib/bundle-analysis.ts`**: 9 exports, never imported.

### P3 — Cleanup at convenience
- 172 orphaned files across the codebase
- 333 unused exports
- 33 phantom env vars in `.env.example`
- 2 unused npm dependencies (`@testing-library/jest-dom`, `knex` in web)
- All 4 plugin entry points (`plugins/`) are orphaned
- Restore `@kernel/logger` in `apps/web/lib/db.ts` and `shutdown.ts` to recover observability
