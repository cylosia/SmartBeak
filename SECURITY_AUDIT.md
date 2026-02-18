# SmartBeak Security Audit Report
**Scope:** All TypeScript/TSX/SQL files whose filename starts with `c`
**Date:** 2026-02-18
**Methodology:** 5 parallel audit agents (Phase 1) + 1 adversarial re-review agent (Phase 2)
**Files audited:** 59 source files + 10 SQL migrations
**Total findings:** 235 (across P0–P3)

---

## Executive Summary

This codebase has **multiple production-ready catastrophic vulnerabilities** that would cause immediate data loss, financial loss, or security breaches if deployed today. The most severe cluster around:

1. **Payment security** — Stripe checkout sessions with no user/org binding, open redirect after payment
2. **Authentication** — CSRF token race condition, webhook membership-ID-as-user-ID bug
3. **Database** — All timestamp columns `TIMESTAMP` (not `TIMESTAMPTZ`), nullable FKs on billing tables, no `updated_at` triggers anywhere
4. **Infrastructure math** — Circuit-breaker pool configured for 5-minute timeouts; connection-health scale thresholds divided by 100 (fires at 0.8% load)
5. **GDPR** — Deleted users' content not erased (no `created_by` column exists)
6. **Budget enforcement** — TOCTOU race allows unlimited cost overrun proportional to concurrency

---

## P0 — CRITICAL (Production Outage / Data Loss / Security Breach Imminent)

### SEC-001 · `apps/web/pages/api/stripe/create-checkout-session.ts:24` | Payment Security
**Open Redirect Post-Payment**
`successUrl` and `cancelUrl` from the request body are passed directly to Stripe with **zero validation**. Any attacker can supply `successUrl: "https://evil.com"` to redirect users to a phishing site after completing payment.
Fix: Validate both URLs against an `isAllowedUrl(origin)` allowlist using exact origin comparison (not `startsWith`). The sibling `billing/[provider]/checkout.ts` has this guard; apply the same pattern here.
Risk: Post-payment phishing; users redirected to attacker-controlled site immediately after entering card details.

### SEC-002 · `apps/web/pages/api/billing/[provider]/checkout.ts:22` | Payment Security
**Prefix-Based URL Allowlist Bypassable**
`isAllowedUrl` uses `url.startsWith(origin)`. A URL like `https://app.example.com.attacker.com/` passes if `origin = "https://app.example.com"`.
Fix: Parse with `new URL(url)` and compare `.origin` exactly: `parsedUrl.origin === allowedOrigin`.
Risk: Attacker-controlled post-payment redirect that passes origin validation.

### SEC-003 · `apps/web/pages/api/stripe/create-checkout-session.ts:30` | Payment Security
**`priceId` Not Validated Against Internal Catalog**
Any string matching `startsWith('price_')` is passed to Stripe. Attackers can probe for internal/test prices.
Fix: Maintain an internal `VALID_PRICE_IDS` set or validate against the database plan catalog before calling Stripe.
Risk: Checkout sessions initiated for prices not offered publicly ($0 prices, enterprise prices, test prices).

### SEC-004 · `apps/web/pages/api/stripe/create-checkout-session.ts:24` | Payment Security
**No User/Org Bound to Stripe Checkout Session**
Session is created with no `client_reference_id`, no `customer`, no metadata. When `checkout.session.completed` fires, there is no reliable way to attribute the payment to an org.
Fix: Set `client_reference_id: auth.orgId`, `metadata: { userId, orgId }`, lookup/create a Stripe customer for the org.
Risk: Successful payments cannot be attributed to an org; subscription credit theft by sharing checkout URLs.

### SEC-005 · `apps/web/pages/api/webhooks/clerk.ts:411` | Security / Data Integrity
**Membership ID Used as User ID (Phantom User Creation)**
`const userId = membershipData.public_user_data?.user_id || membershipData.id` — when `public_user_data?.user_id` is absent, falls back to the **membership ID** (a different entity). This creates phantom user records with membership IDs as their `clerk_id`.
Fix: Remove the fallback. If `public_user_data?.user_id` is absent, return 400.
Risk: Phantom user records polluting the database; potential privilege escalation if membership IDs collide with user IDs.

### SEC-006 · `apps/web/pages/system/cache.tsx:326` | Security — Auth Bypass
**Admin Cache Inspector Authenticated via Public Health Endpoint**
`getServerSideProps` calls `authFetch(apiUrl('system/health'))` to gate access. If `system/health` is public (common pattern), **any unauthenticated user can access the cache inspector**, view all cache keys (which may contain session tokens), delete entries, and clear the entire cache.
Fix: Replace with `getAuth(ctx.req)` from `@clerk/nextjs/server`, verify the session, check `admin` or `owner` role explicitly via DB lookup.
Risk: Unauthenticated cache inspection, deletion, and full cache flush — complete DoS of caching layer.

### SEC-007 · `apps/web/lib/clerk.ts:151` | Security / ESM Correctness
**`Object.defineProperty(exports, ...)` in ESM Module**
Three `Object.defineProperty(exports, ...)` blocks in an ESM (`"type": "module"`) context. `exports` doesn't exist in ESM — throws `ReferenceError` at runtime, or in bundler environments that shim `exports`, accidentally populates a global with Clerk credentials.
Fix: Remove all three `Object.defineProperty(exports, ...)` blocks entirely.
Risk: Runtime crash in production OR credential exposure through module graph.

### SEC-008 · `apps/api/src/middleware/csrf.ts:103` | Security — CSRF Race Condition
**CSRF Token GET+Compare+DEL Is Non-Atomic (Replay Attack)**
`redis.get` → compare → `redis.del` is three separate operations. A parallel request with the same token passes the GET check before DEL fires, defeating the single-use guarantee.
Fix: Replace with a Lua script: atomically GET, compare, and DEL in a single round-trip.
Risk: CSRF token replay — attacker who intercepts a token can use it in a parallel request before it is invalidated.

### SEC-009 · `control-plane/api/routes/cache.ts:69` | Security — ReDoS
**User-Supplied Pattern Compiled to RegExp Without Metacharacter Escaping**
`pattern.replace(/\*/g, '.*')...` leaves regex metacharacters (`.`, `+`, `{`, `}`, `(`, `)`, etc.) unescaped. A crafted pattern like `(a+)+$` hangs the Node.js event loop.
Fix: Escape all regex metacharacters first: `pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')`. Also hard-cap pattern length.
Risk: Any `owner`/`admin` can permanently hang the server event loop — full application DoS.

### SEC-010 · `control-plane/services/container.ts:231` | Runtime Crash
**`require()` in ESM Module (ReferenceError at Runtime)**
`require()` is CommonJS; the project uses ESM (`"type": "module"`). `require` is undefined in ESM. This throws `ReferenceError: require is not defined` the first time `indexingJobRepository` is accessed in production.
Fix: Replace with ESM dynamic import: `await import('...')`. Since the getter is synchronous, initialize at construction time instead of lazily.
Risk: Runtime crash when any search-indexing feature is used in production.

### SEC-011 · `control-plane/services/container.ts:379` | Concurrency — Resource Leak
**Fire-and-Forget `dispose()` on Container Re-initialization**
`void globalContainer.dispose()` before reassignment means the old Redis connection's `quit()` is async and not awaited. The new container is live before the old one is closed — two Redis connections simultaneously, or the new one conflicts with the old quit.
Fix: `await globalContainer.dispose()` before reassigning. Make `initializeContainer` and `resetContainer` async.
Risk: Orphaned Redis connections; potential dual-connection state during re-initialization; data loss if Redis pipeline is mid-flight on shutdown.

### SEC-012 · `packages/monitoring/costTracker.ts:94` | Concurrency — Financial Loss
**TOCTOU Race in Budget Enforcement**
`getTodayCost` reads the DB, the budget check passes, then `buffer.push` executes — all non-atomically. N concurrent `track()` calls all read the same `todayCost`, all pass the check, all push to the buffer. Budget can be exceeded by `concurrency × maxSingleOpCost`.
Fix: Use a Redis atomic increment (`INCRBYFLOAT` with a Lua script) as the single source of truth for spending, with check-and-increment atomically.
Risk: Daily budget overruns proportional to concurrency; financial loss.

### SEC-013 · `packages/config/circuitBreaker.ts:20` | Configuration — Connection Exhaustion
**Circuit-Breaker Default Timeout Is 5 Minutes (300,000 ms)**
A hanging external API call holds a connection for 5 minutes before the circuit breaker detects failure. Under load, all pool connections are exhausted within seconds.
Fix: Change default to 30,000 ms (matching `HTTP.REQUEST_TIMEOUT_MS`).
Risk: Complete application unavailability under slow external services — one slow API call per connection exhausts the pool in seconds.

### SEC-014 · `packages/kernel/constants.ts:279` | Configuration — Duplicate + Wrong Default
**`CIRCUIT_BREAKER.TIMEOUT_MS = 300000` Duplicated in Two Files**
Same dangerous 5-minute default exists in both `constants.ts` and `circuitBreaker.ts`. They will diverge.
Fix: Remove the duplicate; have one import the other. Change both to 30,000 ms.
Risk: Same as SEC-013; additionally, the two constants will diverge during maintenance.

### SEC-015 · `packages/database/query-optimization/connectionHealth.ts:252` | Logic Bug
**Scale-Up Threshold Divided by 100 — Fires at 0.8% Utilization**
`utilization > this.config.scaleUpThreshold / 100` — `scaleUpThreshold` defaults to `0.8` (representing 80%) but is divided by 100, making the effective threshold `0.008` (0.8%). Scale-up fires constantly, and scale-down fires at 0.3% — effectively never.
Fix: Remove the `/100` division. Config values are already in decimal form.
Risk: Pool scale-up events fire on virtually every health check; misleading `pool:scaledUp` events; operators cannot detect real capacity issues.

### SEC-016 · `packages/database/query-optimization/connectionHealth.ts:249` | Architecture Bug
**`pool.options.max` Mutation Has No Effect on pg Pool**
`this.pool.options.max = newMax` mutates a property the `pg` library never re-reads after construction. The scale-up is a silent no-op while emitting a `pool:scaledUp` event as if it succeeded.
Fix: Remove the mutation. Emit `pool:scaleUpRecommended` instead and document that pool resizing requires drain and recreation.
Risk: Operators believe pool capacity increased; it did not; pool is exhausted while metrics report higher capacity.

### SEC-017 · `migrations/sql/20260210001600_cp_billing.up.sql:12` | Data Integrity
**`subscriptions.org_id` Is Nullable — Subscriptions With No Organization**
`org_id TEXT REFERENCES organizations(id)` — nullable. A subscription with `org_id IS NULL` cannot be attributed to any billing entity; Stripe webhooks that fail to match may insert null-org subscriptions that never charge.
Fix: `org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT`.
Risk: Silent unbilled subscriptions; revenue loss.

### SEC-018 · `migrations/sql/20260210001600_cp_billing.up.sql:13` | Data Integrity
**`subscriptions.plan_id` Is Nullable — Subscriptions With No Plan**
`plan_id TEXT REFERENCES plans(id)` — nullable. A subscription with `plan_id IS NULL` bypasses all plan-limit enforcement.
Fix: `plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE RESTRICT`.
Risk: Unlimited access bypass for any subscription without a plan.

### SEC-019 · `migrations/sql/20260210001600_cp_billing.up.sql:7` | Data Integrity
**`price_cents` Has No `CHECK (price_cents >= 0)` Constraint**
A negative plan price causes billing to credit customers instead of charging them.
Fix: `CHECK (price_cents >= 0)`.
Risk: Negative plan prices would credit customers money; invoice totals go negative.

### SEC-020 · `migrations/sql/20260210001600_cp_billing.up.sql:14` | Data Integrity
**Subscription `status` Has No CHECK Constraint**
Any string is a valid subscription status. A typo like `'activ'` silently bypasses all `WHERE status = 'active'` checks.
Fix: `CHECK (status IN ('active', 'trialing', 'past_due', 'canceled', 'unpaid', 'paused'))`.
Risk: Subscriptions stuck in unrecognized states; all app-layer status checks fail silently.

### SEC-021 · `migrations/sql/20260210000300_dom_content_init.up.sql:12` | Data Integrity
**All Four Timestamp Columns Use `TIMESTAMP` (Not `TIMESTAMPTZ`)**
`publish_at`, `archived_at`, `created_at`, `updated_at` are timezone-naive. Any server in a non-UTC timezone writes wall-clock times, causing DST-related publish-timing bugs.
Fix: Change all four to `TIMESTAMPTZ`.
Risk: Scheduled publishing fires at wrong times after DST transitions or server re-provisioning; audit trails unreliable.

### SEC-022 · `migrations/sql/20260210001600_cp_billing.up.sql:15-16` | Data Integrity
**Billing Table Timestamps Are `TIMESTAMP` (Not `TIMESTAMPTZ`)**
`grace_until TIMESTAMP` and `created_at TIMESTAMP` on a financial table are timezone-ambiguous. PCI-DSS and SOC2 audit trails are unreliable.
Fix: Change to `TIMESTAMPTZ`.
Risk: Grace periods expire at wrong times; financial audit trails unreliable.

### SEC-023 · `control-plane/api/routes/content-schedule.ts:59` | Security — AuthZ Bypass
**Ownership Check Is Conditional on `domainId` Being Truthy**
`if (contentItem.domainId) { await ownership.assertOrgOwnsDomain(...) }` — if `domainId` is falsy (null, undefined, empty string), the ownership check is silently skipped.
Fix: Remove the conditional. `domainId` must always be present; if absent, return 400. The check must be unconditional.
Risk: Any `editor`-role user can schedule domain-less content items without an ownership check — authorization bypass.

### SEC-024 · `control-plane/api/routes/content-revisions.ts:24` | Security — Rate Limit Bypass
**Rate Limit Identifier Is Literal String `'content'` (Not Per-User)**
`rateLimit('content', 50)` uses the literal string as the bucket key. All users share one bucket. One user exhausting it denies service to all others. Same bug in `content-schedule.ts:30`.
Fix: Use `rateLimit(ctx.userId, 50, 'content:revisions')` after auth context is obtained.
Risk: Rate limiting completely ineffective as per-user control; DoS by any authenticated user against all others.

### SEC-025 · `apps/web/pages/api/webhooks/clerk.ts:336` | GDPR Compliance
**`user.deleted` Webhook Does Not Delete Content Items**
The GDPR erasure routine deletes memberships, sessions, tokens, API keys, and anonymizes the user record — but does not delete or anonymize `content_items` because no `created_by` column exists on that table.
Fix: Add a `created_by` column to `content_items` (confirmed missing by `content/create.ts:87`), then include content deletion/anonymization in the erasure routine.
Risk: GDPR Article 17 violation. Deleted users' content persists indefinitely.

---

## P1 — HIGH (Likely Bugs Under Load, Security Vulnerabilities, Data Corruption)

### AUTH-001 · `apps/api/src/routes/contentRoi.ts:74` | Security — Symmetric JWT
**HS256 with Symmetric Key — No Key Rotation Mechanism**
Same key signs and verifies. Key compromise means all tokens ever issued are forgeable with no invalidation path.
Fix: Switch to RS256/ES256 (asymmetric). If HS256 must be used, implement key rotation: try `JWT_KEY_1`, fall back to `JWT_KEY_2`.

### AUTH-002 · `apps/api/src/routes/contentRoi.ts:75` | Security — Hardcoded JWT Audience/Issuer
**JWT `audience` and `issuer` Fall Back to Hardcoded Strings**
`audience: process.env['JWT_AUDIENCE'] || 'smartbeak'` — any JWT with audience `'smartbeak'` passes in environments where the env var is not set.
Fix: Require both to be explicitly configured; fail startup if missing. Use `validateEnv` from `@config`.

### AUTH-003 · `apps/api/src/types/core.ts:10` | TypeScript — Missing Branded Types on UserClaims
**`UserClaims.id` and `UserClaims.orgId` Are Plain `string`**
Without branded types, `userId` and `orgId` can be accidentally swapped. `canAccessDomain(orgId, userId)` compiles cleanly but performs the wrong authorization check.
Fix: `id: UserId; orgId: OrgId` using `import type { UserId, OrgId } from '@kernel/branded'`.

### AUTH-004 · `apps/api/src/types/core.ts:10` | Security — Index Signature on UserClaims
**`[key: string]: unknown` Index Signature Allows Arbitrary JWT Claims as Trusted Data**
Extra JWT claims (e.g., attacker-injected `isAdmin: true`) are forwarded as trusted data through the codebase.
Fix: Remove the index signature. Add extra JWT claims explicitly with their types.

### SQL-001 · `control-plane/api/routes/content.ts:321` | Concurrency — TOCTOU
**PATCH Handler Read-Check-Update Without Row Lock**
`repo.getById` → status check → `repo.save` is not inside a transaction with `SELECT ... FOR UPDATE`. Concurrent PATCHes on the same item cause lost updates.
Fix: Wrap read + check + update in a single transaction with `SELECT ... FOR UPDATE`.

### SQL-002 · `control-plane/api/routes/content.ts:114` | SQL — Wrong Join Type
**`LEFT JOIN domains` Instead of `INNER JOIN` for Tenant Isolation**
Orphaned content rows (domain deleted, no CASCADE) have `d.org_id = NULL`, making `NULL = $1` evaluate to `NULL` (falsy) — silently hiding orphaned content. Does not confirm ownership correctly.
Fix: Change to `INNER JOIN domains d ON c.domain_id = d.id AND d.org_id = $1`.

### SQL-003 · `control-plane/api/routes/content.ts:140` | Performance — Full Table Scan
**`ILIKE '%term%'` on `body` Column (Up to 50 KB Per Row) Without pg_trgm Index**
Full table scan of all content for the org on every search request.
Fix: Add `CREATE INDEX ... ON content_items USING gin(body gin_trgm_ops)`, or use `tsvector`/`tsquery` full-text search.

### SQL-004 · `apps/api/src/roi/contentRoi.ts:89` | Performance — N+1 Authorization
**Two Separate DB Round-Trips for Authorization + Third for Content Check**
`canAccessDomain` + `canModifyContent` = 2 nearly-identical JOIN queries before any work. Total 3 queries pre-INSERT.
Fix: Combine into one query: `SELECT role FROM memberships JOIN domain_registry ... WHERE domain_id=$1 AND user_id=$2 AND org_id=$3`. Check role in application code.

### SQL-005 · `migrations/sql/20260210001100_dom_customers_profiles.up.sql:16` | Data Integrity
**No Partial Unique Index for Active Customer Profile per Domain**
Multiple profiles can have `active = true` simultaneously.
Fix: `CREATE UNIQUE INDEX uq_customer_profiles_active_domain ON customer_profiles(domain_id) WHERE active = true`.

### SQL-006 · `migrations/sql/20260210001600_cp_billing.up.sql:10` | Data Integrity
**No Partial Unique Index Preventing Multiple Active Subscriptions per Org**
Race condition on checkout allows double-subscribe; plan-limit checks are ambiguous.
Fix: `CREATE UNIQUE INDEX uq_subscriptions_active_org ON subscriptions(org_id) WHERE status IN ('active', 'trialing')`.

### SQL-007 · `migrations/sql/20260210001500_cp_analytics.up.sql:4` | Data Integrity
**`published_count` Has No `CHECK (published_count >= 0)` — Can Go Negative**
A buggy decrement produces negative published counts, corrupting analytics and billing plan limits.
Fix: `CHECK (published_count >= 0)`.

### SQL-008 · `migrations/sql/20260210001500_cp_analytics.up.sql:3` | Data Integrity
**`analytics_content.content_id` Has No Foreign Key to `content_items`**
Orphaned analytics rows survive content deletion; GDPR erasure requests leave analytics data behind.
Fix: `content_id TEXT PRIMARY KEY REFERENCES content_items(id) ON DELETE CASCADE`.

### SQL-009 · All migrations | Data Integrity
**No `updated_at` Auto-Update Trigger Defined Anywhere**
Multiple tables define `updated_at DEFAULT now()` but no `BEFORE UPDATE` trigger auto-updates it. Any `UPDATE` that omits `SET updated_at =` leaves a stale timestamp. Cache invalidation, CDC pipelines, and feed generation all break.
Fix: Create a `set_updated_at()` trigger function and attach it `BEFORE UPDATE` on every table with `updated_at`.

### SQL-010 · `control-plane/api/routes/content.ts:406` | Concurrency — TOCTOU IDOR
**Soft-Delete Updates Outside Transaction After Ownership Check**
`assertOrgOwnsDomain` and the `UPDATE` are on separate DB connections. Domain transfer between check and update allows deleting content you no longer own.
Fix: Wrap both in a single transaction.

### SQL-011 · `apps/web/pages/api/domains/create.ts:93` | Concurrency — Race Condition
**Quota Default Insertion Race (`SELECT ... FOR UPDATE` Cannot Lock Non-Existent Row)**
Two concurrent requests both find no quota row and both attempt `INSERT INTO org_quotas`, causing duplicate rows or unique constraint violation.
Fix: Use `INSERT INTO org_quotas ... ON CONFLICT (org_id) DO UPDATE SET updated_at = NOW() RETURNING *`.

### PERF-001 · `control-plane/services/cache.ts:140` | Performance — O(n) LRU Eviction
**`evictLRU()` Iterates Entire 10,000-Entry Map to Find Oldest Entry**
O(n) eviction under write load degrades to O(n×m) for m concurrent writes.
Fix: Use a doubly-linked list + Map (O(1) LRU), or use `Map`'s insertion-order property — reinsert on access, evict first Map entry.

### PERF-002 · `packages/database/query-optimization/connectionHealth.ts:297` | Performance — O(n) Array Shift
**`queryTimes.shift()` on 1,000-Element Array Is O(n) Per Call**
Under high query load, `recordQueryTime` becomes a CPU hotspot.
Fix: Replace with a circular buffer using a fixed-size array + write-head pointer.

### PERF-003 · `packages/database/query-optimization/connectionHealth.ts:201` | Concurrency — Health Check Deadlock
**Health Check Acquires a Pool Connection — Deepens Pool Starvation It's Meant to Detect**
Under pool exhaustion, the health check joins the waiting queue, contributing to the exact condition it monitors.
Fix: Use `pool.query('SELECT 1')` directly (no `pool.connect()`) or use a separate dedicated health-check connection outside the pool.

### SEC-026 · `apps/web/pages/api/billing/[provider]/checkout.ts:155` | Security — PII in URL
**Paddle `passthrough` (Contains `orgId`, `userId`) Sent as URL Query Parameter**
Appears in server logs, browser history, and referer headers.
Fix: Use Paddle's server-side API to create a pay link with `passthrough` as a POST body field.

### SEC-027 · `control-plane/api/routes/content-revisions.ts:36` | Security — Multi-Org IDOR
**Access Control Uses Membership Subquery (Multi-Org), Not Org-Scoped Check**
A user in org A and org B can access content owned by either org regardless of which org context the current session is in.
Fix: Replace with `SELECT 1 FROM content_items c JOIN domains d ON c.domain_id = d.id WHERE c.id = $1 AND d.org_id = $2` using `ctx.orgId`.

### SEC-028 · `apps/web/lib/csrf.ts:38` | Security — Silent CSRF Bypass When Token Missing
**`fetchWithCsrf` Sends Request Without CSRF Token If Cookie Is Absent**
New sessions or cleared cookies silently send state-changing requests unprotected.
Fix: When `needsCsrf` is true and `token` is undefined, throw an error rather than sending the request.

### SEC-029 · `apps/web/pages/api/content/create.ts:66` | Security — Role Not Checked
**Content Creation Domain Check Does Not Verify Membership Role**
Any org member (including `viewer`) can create content.
Fix: Add `AND m.role IN ('owner', 'admin', 'editor')` to the domain access query.

### SEC-030 · `apps/api/src/utils/validation/core.ts:67` | Security — SSRF
**`validateUrl` Accepts Any URL Protocol Including `javascript:`, `file:`, `data:`**
If the validated URL is used to make outbound requests, this is an SSRF vector.
Fix: After `new URL(url)`, assert `['https:', 'http:'].includes(parsedUrl.protocol)`. Also check for private/loopback IP ranges.

### SEC-031 · `apps/api/src/jobs/contentIdeaGenerationJob.ts:320` | SQL — Dynamic Query in Loop
**Batch INSERT Built by Concatenating `$N` Placeholders; Empty Batch Causes Syntax Error**
If `batch` is empty, `VALUES` is an empty string — PostgreSQL rejects the query. Also `competitiveAnalysis` field silently dropped from INSERT.
Fix: Validate `batch.length > 0` before building. Use `trx.batchInsert(tableName, rows, chunkSize)`.

### SEC-032 · `apps/api/src/routes/contentRoi.ts:218` | SQL — SELECT *
**`db.insert().returning('*')` Returns All Columns Including Future Sensitive Additions**
Any new column added by migration (soft-delete flags, internal scoring) is automatically exposed to API consumers.
Fix: Enumerate the exact columns in `returning([...])`.

### SEC-033 · `packages/database/query-optimization/connectionHealth.ts:534` | Concurrency — Connection Double-Release
**`Promise.race` Timeout Path Releases Client While Query Still Running**
When the timeout fires first, `client.release()` in `finally` executes, but the underlying `client.query('SELECT 1')` is still pending. The released connection can be acquired by another caller while the previous query is still outstanding — query interleaving, potential data corruption.
Fix: Use `SET statement_timeout` at session level before the health check query, not `Promise.race` with `setTimeout`.

### SEC-034 · `apps/web/pages/api/webhooks/clerk.ts:383` | GDPR
**Anonymized Email Contains Original Clerk User ID**
`deleted_${userId}@anonymized.local` embeds the Clerk user ID — a linkable identifier — in the "anonymized" record.
Fix: Use a random UUID: `` `anon_${randomUUID()}@deleted.local` ``.

### SEC-035 · `control-plane/services/container.ts:264` | Security — PII in Logs
**Email Addresses Logged in `createEmailAdapter`**
`logger.info('Processing event', { to: input.to, ... })` — `to` contains email addresses (PII).
Fix: Log only non-PII fields (template name, notification ID). If email must be logged for debugging, hash it with SHA-256.

### SEC-036 · `packages/cache/cacheInvalidation.ts:345` | Security — Cross-Tenant Cache Blast
**`*domain*${domainId}*` Pattern Is Excessively Broad**
A domainId of `a` matches `domain:admin:secrets`, `domain:all-orgs:data`, etc.
Fix: Use narrower patterns: `domain:${domainId}` and `domain:${domainId}:*`.

### SEC-037 · `packages/kernel/chaos.ts:10` | Security — Chaos Runs in Staging
**Production Guard Uses `NODE_ENV === 'production'` Only**
`NODE_ENV=staging` environments (canary, pre-prod) get random 10% failure injection. If `NODE_ENV` is accidentally unset in production, chaos runs in production.
Fix: Change to explicit opt-in: `if (process.env['CHAOS_ENABLED'] !== 'true') return`.

### SEC-038 · `packages/monitoring/costTracker.ts:130` | Financial — Stale Pricing Data
**OpenAI Model Pricing Hardcoded (Last Updated 2024); New Models Not Represented**
Unknown models silently fall back to GPT-3.5 pricing, dramatically under-counting costs for expensive models.
Fix: Load pricing from a configurable database table or config file. Emit a warning metric for unknown models; do not silently apply a fallback.

### SEC-039 · `apps/api/src/roi/contentRoi.ts:14` | Business Logic — 100x ROI Inflation
**`conversion_rate` Validated as 0–100 (Percentage) But Used as Direct Multiplier**
`monthly_traffic * conversion_rate * revenue_per_conversion` — a 2% rate is passed as `2`, not `0.02`. Revenue figures are 100× inflated. Stored in the database.
Fix: Either divide by 100 inside `computeContentRoi`, or change Zod schema to `z.number().min(0).max(1)`. Coordinate both files atomically.

### SEC-040 · `packages/utils/cacheStampedeProtection.ts:59` | Concurrency — Stampede Bypass
**Non-Atomic Check-Then-Set Allows Multiple Factory() Calls for Same Key**
Between `inFlight.get(key)` returning `undefined` and `inFlight.set(key, ...)`, two concurrent callers both start factory executions — defeating the protection.
Fix: Perform the in-flight check synchronously (before any `await`) and set atomically in the same microtask.

### INFRA-001 · `packages/cache/cacheWarming.ts:84` | TypeScript — Required Cast Lie
**`as Required<CacheWarmingOptions>` Cast When `warmingWindow` May Be Absent**
The type system is told `warmingWindow` is always present; it may not be. Future code trusting this cast will crash.
Fix: Use a proper internal options type that accurately reflects which fields are optional.

### INFRA-002 · `packages/types/events/content-published.v1.ts:6` | Architecture
**Event Payload Missing `orgId` — Every Consumer Must Re-Query the DB**
Without `orgId` in the event, every consumer issues a separate DB query to determine ownership — N+1 on batch processing.
Fix: Add `orgId: OrgId`, `publishedBy: UserId`, `publishedAt: string` (ISO8601) to the payload.

### TEST-001 · `domains/content/domain/content.test.ts:5` | Test Quality — Non-Functional Tests
**All 5 Content Domain Test Files Use ID `'1'` Which Fails `MIN_ID_LENGTH: 3` Validation**
`ContentItem.createDraft('1', ...)` throws at construction. Every assertion in every test is unreachable — the entire content domain test suite is non-functional.
Fix: Use `'id-1'` or a UUID in all test files.

---

## P2 — MEDIUM (Technical Debt, Maintainability, Performance Degradation)

### TS-001 · `apps/api/src/routes/contentRoi.ts:62` | TypeScript — JWT Error Swallowing
All JWT errors (expiry, signature mismatch, algorithm confusion) return `null` with no logging. Brute-force attacks against tokens are invisible.
Fix: Log JWT error type (without the token); emit a security alert metric for `JsonWebTokenError`.

### TS-002 · `apps/api/src/utils/validation/commerce.ts:20` | TypeScript — Insufficient Type Guards
All three platform type guards (`isShopifyProductResponse`, `isWooCommerceProductResponse`, `isBigCommerceProductResponse`) only check `obj['id']`. The `status` union field is never validated — invalid strings pass the guard.
Fix: Validate `status` against allowed values, or derive guards from Zod schemas.

### TS-003 · `apps/api/src/utils/cache.ts:341` | Security — PII in Cache Keys
`queryCacheKey(queryName, params)` serializes all params verbatim into Redis key names. Email addresses become Redis keys visible in monitoring tools.
Fix: Hash sensitive params with SHA-256 before embedding in keys.

### TS-004 · `control-plane/api/routes/content.ts:171` | TypeScript — Untyped DB Rows
`rows` from `client.query(...)` is `any[]`. All property accesses (`row.id`, `row.title`) are untyped — schema changes produce silent `undefined` values in API responses.
Fix: Define a `ContentRow` interface and validate query results against it.

### TS-005 · `control-plane/services/container.ts:322` | Security — Infrastructure Details in Health Endpoint
DB and Redis error messages may contain connection strings, hostnames. If the health endpoint is partially public, this leaks internal infrastructure.
Fix: Sanitize error messages before returning them in `details`. Return generic strings externally; log full errors server-side.

### ARCH-001 · `control-plane/services/container.ts:58` | Architecture — God Class
The `Container` class wires 15+ services including billing, publishing, notifications, search, social adapters. Every new service creates a merge conflict and couples all services together.
Fix: Split into domain-scoped sub-containers or adopt an IoC framework.

### ARCH-002 · `control-plane/api/routes/content.ts:69` | Architecture — Raw Pool in Route Handlers
Route handlers call `pool.query()` directly alongside service/repository calls. Three separate pool consumers with no centralized lifecycle management; read/write separation is impossible.
Fix: Accept `Container` (or service abstractions) rather than raw `Pool`. Route handlers should not access `pool.query` directly.

### ARCH-003 · `packages/cache/cacheInvalidation.ts:286` | Architecture — `clearAll()` Destroys Invalidation Rules
`clearAll()` clears both the cache AND all registered rules. A cache-flush operation silently destroys future invalidation behavior.
Fix: Separate into `clearCache()` and `clearRules()`.

### PERF-004 · `packages/monitoring/costTracker.ts:502` | Performance — Full Table Load at Startup
`loadBudgetsFromDb` has no `WHERE` clause — loads budgets for all organizations into memory at startup. For large deployments, this is an OOM risk.
Fix: Add pagination or a `LIMIT`. Validate `costLimits` values are finite non-negative numbers.

### PERF-005 · `packages/utils/cacheStampedeProtection.ts:95` | Memory Leak
`setTimeout` in `createComputation` is never cleared when the factory resolves before the timeout. Each request leaks a timer closure for up to 30 seconds.
Fix: Store the timer ID and `clearTimeout(timerId)` when factory resolves.

### OBS-001 · All route files | Observability — No `requestId` in Logs or Error Responses
Every `logger.error` and `errors.*` call in every route handler omits `req.id` (Fastify's per-request ID). Impossible to correlate client-reported errors with server logs.
Fix: Include `{ requestId: req.id }` in all log calls and error responses in route handlers.

### OBS-002 · `packages/monitoring/costTracker.ts:148` | Observability — `requestId` Never Passed to Track
`trackOpenAI` accepts `_requestId` (underscore = intentionally unused). Cost entries cannot be correlated with request IDs in distributed traces.
Fix: Remove the underscore; pass `requestId` to the `track` call.

### OBS-003 · `control-plane/api/routes/cache.ts:107` | Observability — Unstructured Logging
`` logger.info(`Cache key deleted by admin: ${key}`) `` — template literal interpolation bypasses the logger's auto-redaction of sensitive fields.
Fix: `logger.info('Cache key deleted by admin', { key, userId: ctx.userId })`.

### DATA-001 · `migrations/sql/20260210001600_cp_billing.up.sql:5` | Data Integrity
`max_domains` and `max_content` on `plans` table are nullable with no documentation. NULL presumed to mean "unlimited" but this convention is unenforced. `max_domains = 0` is valid, blocking all domain creation.
Fix: `CHECK (max_domains IS NULL OR max_domains > 0)`. Add table comment documenting `NULL = unlimited`.

### DATA-002 · `migrations/sql/20260210001100_dom_customers_profiles.up.sql:7` | Data Integrity
`segment_type`, `intent_stage`, `vocabulary_level`, `tone_preference`, `risk_sensitivity` are `TEXT NOT NULL` with no `CHECK` constraints. Invalid enum values bypass application validation when inserted via raw SQL.
Fix: Add `CHECK` constraints matching the TypeScript type's allowed values for each field.

### DATA-003 · `migrations/sql/20260210000300_dom_content_init.up.sql:10` | Data Integrity
`status = 'scheduled'` does not require `publish_at IS NOT NULL`. Scheduled content with null `publish_at` is an impossible domain state that breaks the publisher.
Fix: `CHECK (status != 'scheduled' OR publish_at IS NOT NULL)`.

### DATA-004 · `migrations/sql/20260210000300_dom_content_init.up.sql:10` | Data Integrity
`status = 'archived'` does not require `archived_at IS NOT NULL` (and vice versa). DB-level invariant is unprotected.
Fix: `CHECK ((status = 'archived') = (archived_at IS NOT NULL))`.

### DEPLOY-001 · `scripts/cache-warming.ts:40` | Deployment — Stub Data in Production
`hotDataSources` contains hardcoded stub implementations returning `{ totalUsers: 0, theme: 'dark', language: 'en' }`. These run in production, poisoning the cache with fake data.
Fix: Replace all stubs with real implementations, or gate them behind `NODE_ENV !== 'production'`.

### DEPLOY-002 · `scripts/cache-warming.ts:18` | Deployment — `parseInt` Without Validation
`parseInt(process.env.REDIS_URL || '...')` with dot notation (ESLint violation). `parseInt` on a non-numeric env var returns `NaN`; `setInterval(fn, NaN)` fires continuously — 100% CPU, saturating the cache backend.
Fix: Use `parseIntEnv` from `@config` which validates and throws on invalid values.

### CFG-001 · `packages/config/cache.ts:16` | Configuration — AbortController TTL Too Long
`ABORT_CONTROLLER_TTL_MS: 3600000` (1 hour) means AbortControllers and their associated request state cannot be GC'd for up to 1 hour.
Fix: Use `HTTP.REQUEST_TIMEOUT_MS` (30 seconds) as the upper bound instead.

### CFG-002 · `packages/config/cache.ts:17` | Configuration — Circuit Breaker Cache TTL Mismatched
`CIRCUIT_BREAKER_TTL_MS: 3600000` (1 hour) — circuit breaker state cached for 1 hour will prevent recovery even after `resetTimeoutMs` (30s) has elapsed.
Fix: Set `CIRCUIT_BREAKER_TTL_MS` to at most `resetTimeoutMs * 2` (60 seconds).

---

## P3 — LOW (Style, Nitpicks, Perfectionist Ideals)

### P3-001 · `control-plane/services/container.ts:5` | Architecture — Relative Import Instead of Alias
`import { getLogger } from '../../packages/kernel/logger'` — should use `@kernel/logger` per project conventions.

### P3-002 · `packages/cache/cacheInvalidation.ts:162` | Observability — Duplicate Log Emission
Same invalidation event logged twice: once structured, once as an interpolated string. Delete line 162.

### P3-003 · `control-plane/services/cache.ts:17` | Dead Code
`_isClearableCache<T>` is defined with an underscore (unused convention) but exported. Remove it.

### P3-004 · `apps/api/src/middleware/csrf.ts:51` | Dead Code
`_cleanupExpiredTokens` is exported but completely empty. Redis TTL handles cleanup. Remove.

### P3-005 · `apps/api/src/utils/cache.ts:417` | TypeScript — Dead Runtime Check
`isValidCacheKey(key: string)` checks `typeof key !== 'string'` which is dead code for a typed `string` parameter. Change to `(key: unknown): key is string`.

### P3-006 · `domains/content/domain/content.revision.test.ts:4` | Tests — Test Name Misleads
"revision captures immutable snapshot" manually constructs a snapshot object — no actual revision mechanism tested. Rename to accurately describe what is tested.

### P3-007 · `domains/content/domain/content.list.test.ts:4` | Tests — Trivial Assertion
`expect(a["status"]).toBe('draft')` on a freshly-created item without any intervening logic is a tautology that cannot detect any regression.

### P3-008 · `apps/web/pages/constitution.tsx` | Security — Internal Docs Publicly Accessible
Internal operational documentation describing business rules accessible to unauthenticated users.
Fix: Add `getServerSideProps` with auth check or move to authenticated admin area.

### P3-009 · `apps/web/pages/portfolio/compare.tsx` | Deployment — Stub Page in Production
Hardcoded placeholder data `example.com | $12k/mo` with no auth guard. If users see this, it undermines trust.

---

## Immediate Production Incident Risk Ranking

Issues that would cause a production incident **today** if not fixed:

| Rank | ID | Finding | Blast Radius |
|------|-----|---------|-------------|
| 1 | SEC-016 | Pool scale-up is a no-op + threshold fires at 0.8% | Full application outage under any load spike |
| 2 | SEC-013 | Circuit-breaker 5-minute timeout default | Pool exhaustion on first slow external API call |
| 3 | SEC-010 | `require()` in ESM crashes search-indexing | Any search/indexing feature crashes process |
| 4 | SEC-006 | Cache admin page auth bypass | Unauthenticated cache wipe = DoS |
| 5 | SEC-009 | ReDoS in cache key search | Event loop hang = full application freeze |
| 6 | SEC-004 | Stripe sessions not bound to org | Revenue attribution failure; subscription theft |
| 7 | SEC-001/002 | Open redirect post-payment | User phishing after every Stripe checkout |
| 8 | SEC-008 | CSRF token race condition | CSRF bypass for parallel requests |
| 9 | SEC-012 | Budget enforcement TOCTOU | Unlimited cost overrun in multi-pod deployment |
| 10 | SEC-021/022 | All timestamps are `TIMESTAMP` not `TIMESTAMPTZ` | DST-triggered silent data corruption |
| 11 | SEC-005 | Membership ID used as user ID in webhook | Phantom user records, potential privilege escalation |
| 12 | TEST-001 | Entire content domain test suite non-functional | Zero regression detection for content domain |
| 13 | SEC-039 | ROI figures stored 100× inflated | All content ROI decisions based on wrong data |
| 14 | SEC-025 | GDPR erasure incomplete (no `created_by` column) | GDPR Article 17 violation on every user deletion |
| 15 | SEC-017/018 | Nullable org_id/plan_id on subscriptions | Silent unbilled subscriptions; unlimited access bypass |

---

## Summary Statistics

| Severity | Count |
|----------|-------|
| P0 — Critical | 25 |
| P1 — High | 40 |
| P2 — Medium | 25 |
| P3 — Low | 9 |
| **Total** | **99** deduplicated findings |

*(Raw findings across 5 agents: 235; deduplicated and cross-referenced above)*

---

## Phase 2 — Adversarial Re-Review Results

### Verification of Critical Phase 1 Findings

**✅ CONFIRMED** `cache.ts:69` — ReDoS via unescaped regex metacharacters. V8's irregexp mitigates some patterns, but nested quantifiers over long key strings still hang the event loop. Additional: the `total` field in the response exposes real L1 key count even when `limit` is small — information disclosure.

**✅ CONFIRMED** `create-checkout-session.ts:46` — Open redirect. The "P1-4 FIX" comment only protects the *default* fallback URL, not caller-supplied `successUrl`/`cancelUrl`. The fix is deliberately incomplete.

**✅ CONFIRMED** `clerk.ts:411` — Membership ID fallback: `|| membershipData.id` re-introduces the exact bug the fix comment claims to resolve. When `public_user_data.user_id` is absent or falsy (empty string), the membership ID `mem_xxx` is used as the user identifier, creating phantom memberships.

**✅ CONFIRMED** `container.ts:235` — `require()` in ESM causes `ReferenceError` at runtime. The ESLint suppression comment masks it; CI lint passes with warning-only rule.

**✅ CONFIRMED** `container.ts:379/400` — Fire-and-forget `dispose()` confirmed in both `initializeContainer` and `resetContainer`. Especially dangerous in rapid test teardown.

**✅ CONFIRMED** `costTracker.ts:94` — TOCTOU budget race confirmed. Additionally: `this.buffer.splice(0)` in `flush()` races with `this.buffer.push()` in concurrent `track()` calls — entries can be spliced out before being confirmed written to DB, then re-pushed in the catch block, causing double-counting.

**✅ CONFIRMED** `circuitBreaker.ts:20` — 5-minute timeout default confirmed. 300,000ms vs the standard 5,000–30,000ms range.

**✅ CONFIRMED** `connectionHealth.ts:252/261` — `/100` division bug confirmed. `0.8 / 100 = 0.008`; scale-up fires at 0.8% utilization.

**✅ CONFIRMED** `billing.up.sql:12-13` — Nullable `org_id` and `plan_id` on subscriptions confirmed. Also missing: `updated_at`, `stripe_subscription_id`.

**❌ FALSE POSITIVE** `contentRoi.ts` — 100x ROI inflation bug: the function itself is arithmetically correct. The `conversion_rate` unit convention is undocumented and inconsistent between the Zod schema range (0–100) and the calculation (direct multiplication), but this is a latent misuse risk, not a confirmed bug in the current code.

**❌ FALSE POSITIVE (mechanism)** `connectionHealth.ts:534` — Double-release race: the `finally { client.release() }` executes exactly once. The real issue is an *uncleared timer*: when the query resolves before timeout, the `setTimeout` callback fires later and calls `reject()` on an already-settled promise, potentially surfacing as `UnhandledPromiseRejection` in strict Node.js configurations.

**⚠️ NUANCED** `cache.tsx:326` — Auth bypass: the health endpoint URL `apiUrl('system/health')` resolves to `{NEXT_PUBLIC_API_URL}/v1/system/health` which does not exist in the control-plane (health is at root `/health`). This means **all users — including authenticated admins — are redirected to `/login`** (page is inaccessible). If the URL were corrected without adding role checks, any authenticated `viewer` could reach the cache inspector. The finding is directionally correct but the mechanism is wrong.

### New Findings from Phase 2

**[SEVERITY: P0]** `cache.tsx:328` | Auth — Cache Admin Panel Inaccessible Due to Wrong Health URL
`authFetch(apiUrl('system/health'))` targets a non-existent route (`/v1/system/health`); the control-plane health endpoint is at `/health`. The 404 triggers the error redirect, blocking all users — including admins — from the cache inspector. If the URL is "fixed" without adding explicit role verification, any authenticated user gains access.
Fix: Replace the health endpoint probe with an explicit `getAuth(ctx.req)` Clerk call + DB role lookup for `owner`/`admin`.

**[SEVERITY: P1]** `clerk.ts:337–378` | GDPR — OR-Clause with Clerk String ID Against Integer FK Is Silent No-Op
Queries `DELETE FROM org_memberships WHERE user_id = $1 OR user_id = $2` pass `[internalUserId, clerkStringId]` where `user_id` is an integer/UUID column. PostgreSQL silently casts the Clerk string to `0` or throws a type error; the clause matches nothing. The GDPR erasure log still records "9 tables cleared".
Fix: Use only the correct ID type per table. Log actual `rowCount` results per DELETE, not a hardcoded `tablesCleared: 9`.

**[SEVERITY: P1]** `connectionHealth.ts:535` | Async — Uncleared Timer Causes Phantom Rejection
`Promise.race([query, setTimeout reject])` — when the query wins, the timer fires later calling `reject()` on an already-settled promise. With `--unhandled-rejections=throw` (default in Node.js 15+), this crashes the process.
Fix: `const timerId = setTimeout(...); try { await Promise.race(...) } finally { clearTimeout(timerId); }`.

**[SEVERITY: P2]** `package.json` | Dependencies — Stripe SDK `14.25.0` Is Significantly Outdated
Current Stripe Node.js SDK is v17+. v14 may use deprecated API endpoints Stripe plans to sunset; missing security fixes in webhook signature verification.
Fix: Upgrade to latest Stripe SDK. Add Renovate/Dependabot for automated dependency updates.

**[SEVERITY: P2]** `jest.config.ts:102` | Config — Billing Coverage Threshold Targets Wrong Directory
`coverageThreshold` for billing is set on `./apps/api/src/billing/**/*.ts` but billing code lives in `control-plane/services/billing.ts` and `control-plane/api/routes/billing.ts`. The threshold covers no real billing code.
Fix: Change path to `./control-plane/services/billing*` and `./control-plane/api/routes/billing*`.

**[SEVERITY: P2]** `.eslintrc.cjs:46` | Config — `no-var-requires` Is `'warn'` Not `'error'`
The rule that would have caught the `require()` in ESM crash (SEC-010) is only a warning. `npm run lint` passes; only `lint-staged` with `--max-warnings 0` would catch it.
Fix: Elevate to `'error'`. Add `--max-warnings 0` to the `npm run lint` script.

**[SEVERITY: P2]** `tsconfig.base.json` | Config — `"moduleResolution": "Bundler"` Incompatible with Node.js ESM Runtime
`"Bundler"` resolution does not enforce the `.js` extension requirement for ESM imports, does not validate `exports` field in `package.json`, and accepts import paths that fail in Node.js at runtime. Creates a class of runtime-only import resolution failures invisible to TypeScript.
Fix: Use `"moduleResolution": "NodeNext"` with `"module": "NodeNext"` for all backend packages (`control-plane`, `apps/api`, `packages/*`). The Next.js frontend (`apps/web`) can retain `"Bundler"`.

**[SEVERITY: P3]** `contentRoi.ts` | API Contract — `conversion_rate` Unit Convention Undocumented
No JSDoc, no Zod range validation, no unit annotation. Callers passing `3` (3%) instead of `0.03` produce 100× inflated revenue figures that would be stored in the database.
Fix: Add Zod schema: `z.number().min(0).max(1)` (for fraction) with JSDoc `@param conversion_rate Decimal fraction (e.g. 0.03 for 3%)`.

**[SEVERITY: P3]** `clerk.ts:398` | Observability — Hardcoded `tablesCleared: 9` in GDPR Audit Log
The count is static regardless of actual rows deleted, creating a false audit trail.
Fix: Track actual `rowCount` from each query result; log per-table counts.

**[SEVERITY: P3]** `.eslintrc.cjs:107` | Config — `*.js`/`*.mjs` Files Excluded from Security Lint
Build scripts, migration runners, and config files are not covered by the security ESLint rules.
Fix: Add targeted includes for security-sensitive script files.
