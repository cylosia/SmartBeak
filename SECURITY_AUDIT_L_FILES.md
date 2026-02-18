# Security Audit Report: Files Starting with "L"

**Date**: 2026-02-18
**Scope**: All source files with filenames starting with "l" (30 files)
**Methodology**: Hostile code review, dual-agent verification, line-by-line AST analysis
**Standard**: Financial-grade — bugs cost millions

---

## Executive Summary

30 files audited across 6 categories: core infrastructure, API routes, frontend pages, theme templates, test files, and security utilities. **46 verified findings**: 11 Critical (P0), 14 High (P1), 14 Medium (P2), 7 Low (P3). The most dangerous cluster involves the structured logger emitting logs without message or timestamp fields (total observability blackout), an OAuth flow missing its entire callback implementation, and multiple frontend pages with zero authentication.

---

## Files Audited

| # | File | Lines | Category |
|---|------|-------|----------|
| 1 | `packages/kernel/logger.ts` | 505 | Core Infrastructure |
| 2 | `packages/config/limits.ts` | 28 | Core Infrastructure |
| 3 | `packages/utils/lruCache.ts` | 248 | Core Infrastructure |
| 4 | `packages/security/logger.ts` | 132 | Core Infrastructure |
| 5 | `control-plane/api/routes/llm.ts` | 237 | API Route |
| 6 | `apps/api/src/auth/oauth/linkedin.ts` | 47 | API / OAuth |
| 7 | `apps/web/pages/api/diligence/links.ts` | 115 | API Endpoint |
| 8 | `apps/web/pages/login.tsx` | 12 | Frontend Page |
| 9 | `apps/web/pages/attribution/llm.tsx` | 28 | Frontend Page |
| 10 | `apps/web/pages/domains/[id]/lifecycle.tsx` | 13 | Frontend Page |
| 11 | `apps/web/pages/domains/[id]/links.tsx` | 71 | Frontend Page |
| 12 | `apps/web/pages/domains/[id]/email/lead-magnets.tsx` | 49 | Frontend Page |
| 13-17 | `themes/*/app/layout.tsx` (5 themes) | 15 each | Theme Template |
| 18-27 | `themes/*/templates/landing.tsx` + `location.tsx` (10 files) | 10 each | Theme Template |
| 28 | `test/benchmarks/lock-acquisition.bench.ts` | 164 | Test/Benchmark |
| 29 | `test/utils/logger-mock.ts` | 234 | Test Utility |
| 30 | `apps/api/tests/adapters/linkedin.adapter.spec.ts` | 10 | Test |

---

## P0 — Critical (Production Outage / Data Loss / Security Breach)

### P0-1: Structured Logger Emits Logs Without Message or Timestamp

**File**: `packages/kernel/logger.ts:161-186`
**Category**: Observability
**Verified**: YES — read line-by-line

The `consoleHandler` destructures `message` as `_message` and `timestamp` as `_timestamp` (underscore-prefixed = unused), then builds `logOutput` without including either field. Every structured log entry in production is missing both its human-readable message and its timestamp.

```typescript
// Line 161 — destructures as unused variables
const { timestamp: _timestamp, level, message: _message, service, ... } = entry;

// Lines 170-172 — logOutput never includes message or timestamp
const logOutput: Record<string, unknown> = {
  level: level.toUpperCase(),
};
// message and timestamp are NEVER added to logOutput
```

**Impact**: Complete observability blackout. Log aggregators (Datadog, Splunk, ELK) receive JSON entries with no message text and no timestamp. Incident response is impossible. Alert rules based on log message patterns never fire. This affects every service in the entire monorepo.

**Fix**: Add both fields to `logOutput`:
```typescript
const { timestamp, level, message, service, ... } = entry;
const logOutput: Record<string, unknown> = {
  timestamp,
  level: level.toUpperCase(),
  message,
};
```

**Blast Radius**: Every log line across every service. Complete observability failure.

---

### P0-2: OAuth Redirect Domain Allowlist Fails Open When Unconfigured

**File**: `apps/api/src/auth/oauth/linkedin.ts:24-30`
**Category**: Security
**Verified**: YES

When `OAUTH_ALLOWED_REDIRECT_DOMAINS` is empty or unset, the domain check is entirely skipped. Any `https://` URL is accepted as a redirect URI, enabling OAuth authorization code theft.

```typescript
// Line 24-25 — empty array skips the entire check
const allowedDomains = (process.env['OAUTH_ALLOWED_REDIRECT_DOMAINS'] || '').split(',').filter(Boolean);
if (allowedDomains.length > 0) {  // <-- SKIPPED when env var missing
```

**Impact**: Open redirect vulnerability. Attacker supplies `redirect_uri=https://evil.com/callback` and intercepts the LinkedIn authorization code. If `OAUTH_ALLOWED_REDIRECT_DOMAINS` is not set in any environment (common in staging, new deployments), all OAuth flows are vulnerable.

**Fix**: Fail closed:
```typescript
if (allowedDomains.length === 0) {
  throw new Error('OAUTH_ALLOWED_REDIRECT_DOMAINS must be configured');
}
```

**Blast Radius**: All OAuth flows in any environment where the env var is not explicitly configured.

---

### P0-3: Incomplete OAuth Flow — No Token Exchange, No Callback Handler

**File**: `apps/api/src/auth/oauth/linkedin.ts` (entire file, 47 lines)
**Category**: Security / Architecture
**Verified**: YES — file is only URL generation

The file contains only `getLinkedInAuthUrl()`. There is no `exchangeCodeForToken()`, no callback handler, and no server-side state storage. Steps 3 and 4 of the OAuth authorization code flow (verify state, exchange code) are entirely missing.

**Impact**: Either (a) the OAuth flow is broken and cannot complete, or (b) the callback handling exists elsewhere without the same validation, potentially accepting any code/state pair.

**Fix**: Implement the complete flow:
```typescript
export async function exchangeLinkedInCode(
  code: string, state: string, storedState: string,
  clientId: string, clientSecret: string, redirectUri: string
): Promise<LinkedInTokenResponse> {
  if (!timingSafeEqual(Buffer.from(state), Buffer.from(storedState))) {
    throw new AuthError('State mismatch - CSRF detected');
  }
  // POST to https://www.linkedin.com/oauth/v2/accessToken
}
```

**Blast Radius**: LinkedIn integration completely broken or insecure.

---

### P0-4: Subdomain Matching Allows Redirect Bypass via Subdomain Takeover

**File**: `apps/api/src/auth/oauth/linkedin.ts:27`
**Category**: Security
**Verified**: YES

The domain check uses `redirectHost.endsWith('.' + d.trim())`. If the allowed domain is `example.com`, then any subdomain `*.example.com` matches — including abandoned subdomains vulnerable to takeover.

```typescript
if (!allowedDomains.some(d => redirectHost === d.trim() || redirectHost.endsWith('.' + d.trim()))) {
```

**Impact**: Subdomain takeover on any `*.alloweddomain.com` subdomain bypasses the redirect restriction, enabling authorization code interception.

**Fix**: Exact match only:
```typescript
if (!allowedDomains.some(d => redirectHost === d.trim())) {
```

**Blast Radius**: Any OAuth flow where a subdomain of an allowed domain is takeable.

---

### P0-5: No Auth on Destructive Actions Page

**File**: `apps/web/pages/domains/[id]/lifecycle.tsx` (entire file, 13 lines)
**Category**: Security
**Verified**: YES

No `getServerSideProps`, no authentication, no authorization. The `[id]` route parameter is completely unused. Destructive buttons ("Archive Domain", "Transfer Domain") have no `onClick` handlers — but the page is accessible to anyone.

```typescript
export default function DomainLifecycle() {
  return (
    <AppShell>
      <h1>Domain Lifecycle</h1>
      <p>Archive or transfer this domain. These actions are irreversible.</p>
      <button>Archive Domain</button>    // No onClick, no auth
      <button>Transfer Domain</button>   // No onClick, no auth
    </AppShell>
  );
}
// NO getServerSideProps — no auth check
```

**Impact**: Any unauthenticated user can access `/domains/anything/lifecycle`. While buttons lack handlers today, adding them without auth would be an immediate P0 security breach.

**Fix**: Add `getServerSideProps` with auth:
```typescript
export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const auth = await requireServerAuth(ctx);
  if (!auth) return { redirect: { destination: '/login', permanent: false } };
  // verify domain ownership
  return { props: { domainId: ctx.params?.id } };
};
```

**Blast Radius**: Domain lifecycle operations accessible without authentication.

---

### P0-6: LLM Attribution Page — Unvalidated API Response, No Error Handling

**File**: `apps/web/pages/attribution/llm.tsx:23-27`
**Category**: Type Safety / Security
**Verified**: YES

`getServerSideProps` calls `authFetch()` then `res.json()` with zero error handling. The response is typed as `any` and passed directly to the component. If the API returns an error, non-JSON, or malicious data, the page either crashes (500) or renders attacker-controlled content.

```typescript
export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const res = await authFetch(apiUrl('attribution/llm'), { ctx });
  const rows = await res.json();  // any — no validation, no error check
  return { props: { rows } };     // raw any passed to component
};
```

**Impact**: (a) Unhandled exception if API is down or returns non-JSON → 500 error page. (b) Type confusion: `rows` could be `{ error: "..." }` instead of `LlmAttributionRow[]`. (c) The component renders `<pre>{JSON.stringify(rows, null, 2)}</pre>` which is safe against XSS, but any future refactor rendering fields directly would be vulnerable.

**Fix**:
```typescript
export const getServerSideProps: GetServerSideProps = async (ctx) => {
  try {
    const res = await authFetch(apiUrl('attribution/llm'), { ctx });
    if (!res.ok) return { props: { rows: [], error: 'Failed to load' } };
    const data: unknown = await res.json();
    const rows = z.array(LlmAttributionRowSchema).parse(data);
    return { props: { rows } };
  } catch {
    return { props: { rows: [], error: 'Failed to load' } };
  }
};
```

**Blast Radius**: LLM attribution page crashes or renders garbage on any API failure.

---

### P0-7: Frontend Links Page — No Auth, Hardcoded Mock Data, Undefined domainId

**File**: `apps/web/pages/domains/[id]/links.tsx:60-70`
**Category**: Security / Data Integrity
**Verified**: YES

`getServerSideProps` has no authentication, returns hardcoded mock data, and passes `domainId` without validating it's defined (it could be `undefined` from `params?.['id']`).

```typescript
export const getServerSideProps: GetServerSideProps = async ({ params }) => {
  const domainId = params?.['id'];  // Could be undefined
  return {
    props: {
      domainId,  // undefined passed to component → renders "undefined" in UI
      internal: { orphans: 3, hubs: 5, broken: 2 },      // hardcoded
      external: { editorial: 42, affiliate: 18, broken: 4 } // hardcoded
    }
  };
};
```

**Impact**: (a) Any unauthenticated visitor sees domain link data. (b) The data is fake, misleading users about actual link health. (c) `domainId` can be `undefined`, violating the `LinksProps` interface which declares `domainId: string`.

**Fix**: Add auth, validate ID, fetch real data:
```typescript
export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const auth = await requireServerAuth(ctx);
  if (!auth) return { redirect: { destination: '/login', permanent: false } };
  const domainId = ctx.params?.['id'];
  if (typeof domainId !== 'string') return { notFound: true };
  // Fetch real data from API
};
```

**Blast Radius**: Link health dashboard shows fake data to anyone, including unauthenticated users.

---

### P0-8: Lead Magnets Page — No Authorization Check (IDOR)

**File**: `apps/web/pages/domains/[id]/email/lead-magnets.tsx:42-48`
**Category**: Security
**Verified**: YES

`getServerSideProps` only validates that `id` is a string. No authentication, no authorization, no domain ownership check. Any user who guesses a domain ID can view lead magnets.

```typescript
export async function getServerSideProps({ params }: GetServerSidePropsContext) {
  const id = params?.['id'];
  if (typeof id !== 'string') {
    return { notFound: true };
  }
  return { props: { domainId: id } };  // No auth check
}
```

**Impact**: Unauthenticated access to domain-scoped lead magnet data. In a financial context, this exposes subscriber acquisition strategy to competitors.

**Fix**: Add `requireServerAuth()` and domain ownership verification.

**Blast Radius**: All lead magnet data for all domains accessible to anyone.

---

### P0-9: LinkedIn Test Makes Real HTTP Requests to LinkedIn API

**File**: `apps/api/tests/adapters/linkedin.adapter.spec.ts:4-9`
**Category**: Testing / Security
**Verified**: YES — file is only 10 lines, no mocks

The test instantiates `LinkedInAdapter` with a hardcoded token `'token'` and calls `createCompanyPost()` with no fetch mock. This sends real HTTP requests to LinkedIn's API in CI.

```typescript
test('LinkedIn adapter creates company post', async () => {
  const adapter = new LinkedInAdapter('token');
  const res = await adapter.createCompanyPost('org123', { text: 'Hello' }) as { status: string; id: string };
  expect(res.status).toBe('created');
});
```

**Impact**: (a) CI makes outbound requests to `api.linkedin.com` — may post content, trigger rate limits, or leak the test environment's IP. (b) The `as { status: string; id: string }` cast means the assertion passes even if `res` is `undefined` or a different shape (TypeScript won't catch it). (c) If LinkedIn returns an error, the test fails nondeterministically.

**Fix**: Mock the HTTP layer:
```typescript
vi.mock('node-fetch');
const mockFetch = vi.mocked(fetch);
mockFetch.mockResolvedValue(new Response(JSON.stringify({ status: 'created', id: '123' })));
```

**Blast Radius**: CI reliability; potential unintended LinkedIn API calls from test environments.

---

### P0-10: Logger JSON.stringify Crash on Circular References

**File**: `packages/kernel/logger.ts:186`
**Category**: Resilience
**Verified**: YES

`JSON.stringify(logOutput)` has no circular reference protection. If `metadata` contains circular references (common with `Error` objects, HTTP request/response objects, or ORM entities with back-references), this throws `TypeError: Converting circular structure to JSON`, crashing the log pipeline.

```typescript
logFn(JSON.stringify(logOutput));  // No safe-stringify, no try/catch
```

**Impact**: A single log call with circular metadata crashes the entire logging pipeline. If this happens in a request handler, the request fails with an unhandled exception. If it happens in a background job, the worker crashes.

**Fix**:
```typescript
import { safeStringify } from '@utils/safe-stringify';
logFn(safeStringify(logOutput));
```
Or wrap in try/catch:
```typescript
try {
  logFn(JSON.stringify(logOutput));
} catch {
  logFn(JSON.stringify({ level: logOutput['level'], message: '[LOG_SERIALIZATION_ERROR]' }));
}
```

**Blast Radius**: Any service logging an object with circular references crashes.

---

### P0-11: LLM Models Endpoint Fails Open — Returns 200 + Empty Data on DB Failure

**File**: `control-plane/api/routes/llm.ts:98-101`
**Category**: Security / Resilience
**Verified**: YES

When the database query fails, the endpoint catches the error and returns an empty array with HTTP 200. This is a fail-open pattern: if the DB is down, the API appears healthy but returns no models, causing downstream systems to silently degrade.

```typescript
} catch (dbError) {
  logger.error('[llm/models] Database error', dbError instanceof Error ? dbError : new Error(String(dbError)));
  models = [];  // Fail open: returns empty list with 200 OK
}
```

**Impact**: Health checks pass, monitoring shows no errors, but the LLM model selection is broken. Users see an empty model list and cannot generate content. Budget enforcement on the preferences endpoint (line 168-170) also fails open, returning `monthly: 500` default.

**Fix**: Return 503:
```typescript
} catch (dbError) {
  logger.error('[llm/models] Database error', ...);
  return errors.serviceUnavailable(res, 'Database temporarily unavailable');
}
```

**Blast Radius**: All LLM-dependent features silently broken when DB is unavailable; budget enforcement bypassed.

---

## P1 — High (Likely Bugs Under Load / Security Vulnerabilities)

### P1-1: Missing Transaction ROLLBACK Before Connection Release

**File**: `apps/web/pages/api/diligence/links.ts:106-107`
**Category**: SQL
**Verified**: YES

The `finally` block releases the client without `ROLLBACK`. If any query between `BEGIN` (line 50) and `COMMIT` (line 87) throws, the connection is returned to the pool in an aborted transaction state.

```typescript
} finally {
  client.release();  // NO ROLLBACK — aborted transaction pollutes pool
}
```

**Fix**:
```typescript
} catch (err) {
  await client.query('ROLLBACK').catch(e =>
    logger.error('Rollback failed', e instanceof Error ? e : undefined));
  throw err;
} finally {
  client.release();
}
```

**Risk**: Connection pool pollution under error conditions; cascading failures as polluted connections return errors to subsequent requests.

---

### P1-2: Authorization Bypass — Membership Check Missing Active Status and Role

**File**: `apps/web/pages/api/diligence/links.ts:10-13`
**Category**: Security
**Verified**: YES

The `verifyDomainOwnership` query joins `memberships` but doesn't check `m.status = 'active'` or role requirements. Suspended users and viewers can access financial diligence data.

```sql
SELECT 1 FROM domain_registry dr
JOIN memberships m ON m.org_id = dr.org_id
WHERE dr.domain_id = $1 AND m.user_id = $2 AND dr.org_id = $3
-- Missing: AND m.status = 'active' AND m.role IN ('owner', 'admin', 'editor')
```

**Fix**: Add status and role filters:
```sql
AND m.status = 'active' AND m.role IN ('owner', 'admin', 'editor')
```

**Risk**: Revoked/suspended users retain access to financial diligence data.

---

### P1-3: O(N*M) Correlated Subquery in Link Statistics

**File**: `apps/web/pages/api/diligence/links.ts:55-57`
**Category**: Performance / SQL
**Verified**: YES

Correlated `NOT EXISTS` subquery inside `COUNT(DISTINCT CASE WHEN...)` executes for every row in `pages`, scanning `links` each time.

```sql
COUNT(DISTINCT CASE WHEN NOT EXISTS (
  SELECT 1 FROM links l2 WHERE l2.source_id = p["id"]
) THEN p["id"] END) as orphan_pages,
```

**Fix**: Rewrite with LEFT JOIN anti-pattern:
```sql
COUNT(DISTINCT CASE WHEN l.source_id IS NULL THEN p.id END) as orphan_pages
-- with LEFT JOIN links l ON l.source_id = p.id already present
```

**Risk**: Query degrades from milliseconds to seconds/minutes as data grows. Potential request timeouts.

---

### P1-4: Missing SQL Indexes for Query Patterns

**File**: `apps/web/pages/api/diligence/links.ts:53-85`
**Category**: SQL / Performance
**Verified**: By inspection — no migration creates these indexes

Required indexes not verified to exist:
- `pages(domain_id)` — for `WHERE p.domain_id = $1`
- `links(source_id)` — for JOINs and subquery
- `links(source_id) WHERE is_external = true` — partial index for external stats
- `links(id) WHERE broken = true` — partial index for broken link counts

**Fix**: Create migration:
```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pages_domain_id ON pages(domain_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_links_source_id ON links(source_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_links_source_external ON links(source_id) WHERE is_external = true;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_links_broken ON links(id) WHERE broken = true;
```

**Risk**: Full sequential scans on large tables; query timeouts under load.

---

### P1-5: Preferences UPSERT Overwrites Entire JSONB Instead of Merging

**File**: `control-plane/api/routes/llm.ts:208-213`
**Category**: Data Integrity
**Verified**: YES

The `POST /llm/preferences` UPSERT writes `JSON.stringify(updates)` as the entire `preferences` column. Partial update (e.g., only `costLimits`) erases all other preferences.

```typescript
await pool.query(
  `INSERT INTO org_llm_prefs (org_id, preferences, updated_at)
  VALUES ($1, $2, NOW())
  ON CONFLICT (org_id) DO UPDATE SET preferences = $2, updated_at = NOW()`,
  [ctx.orgId, JSON.stringify(updates)]
);
```

**Fix**: Use PostgreSQL JSONB merge:
```sql
ON CONFLICT (org_id) DO UPDATE SET
  preferences = org_llm_prefs.preferences || $2::jsonb,
  updated_at = NOW()
```

**Risk**: Users changing cost limits accidentally reset model preferences. Data loss on every partial update.

---

### P1-6: GET Preferences Fails Open — Returns Default Budget on DB Failure

**File**: `control-plane/api/routes/llm.ts:168-170`
**Category**: Security
**Verified**: YES

If the database is down, the preferences endpoint catches the error and returns hardcoded defaults including `monthly: 500`. This means budget enforcement is bypassed.

```typescript
} catch (dbError) {
  logger.error('[llm/preferences] Database error, using defaults', ...);
  // Falls through to return `defaults` with monthly: 500
}
```

**Fix**: Return 503 instead of defaults on DB failure.

**Risk**: Budget enforcement completely bypassed during database outages.

---

### P1-7: OAuth State Not Cryptographically Tied to Session

**File**: `apps/api/src/auth/oauth/linkedin.ts:12-18`
**Category**: Security
**Verified**: YES

`validateState()` only checks format (32+ alphanumeric chars). Any attacker-crafted string passes. No server-side storage, no session binding.

```typescript
function validateState(state: string): boolean {
  if (!state || state.length < 32) return false;
  return /^[a-zA-Z0-9_-]+$/.test(state);
}
```

**Fix**: State must be generated server-side via `crypto.randomBytes(32).toString('hex')`, stored in session/DB with TTL, and verified on callback with `timingSafeEqual`.

**Risk**: CSRF on OAuth flow. Attacker crafts state parameter that passes validation.

---

### P1-8: LRU Cache TTL Disabled When ttlMs = 0

**File**: `packages/utils/lruCache.ts:45`
**Category**: Type Safety / Logic
**Verified**: YES

TTL check uses `this.ttlMs &&` which is falsy when `ttlMs === 0`. Setting `ttlMs: 0` (intending "expire immediately") actually disables TTL entirely.

```typescript
if (this.ttlMs && now - entry.timestamp > this.ttlMs) {
```

**Fix**: Use explicit comparison:
```typescript
if (this.ttlMs !== undefined && now - entry.timestamp > this.ttlMs) {
```

**Risk**: Cache entries persist forever when `ttlMs: 0` is passed, opposite of intended behavior.

---

### P1-9: LRU Cache Uses Sliding Window TTL — Entries Never Expire If Accessed

**File**: `packages/utils/lruCache.ts:50-53`
**Category**: Architecture
**Verified**: YES

`get()` updates `timestamp` to `Date.now()` on every access. Frequently-accessed entries never expire, defeating TTL's purpose for stale data eviction.

```typescript
const updatedEntry: CacheEntry<V> = {
  value: entry.value,
  timestamp: now,  // Reset TTL on every read
};
```

**Fix**: If absolute TTL is intended, preserve original timestamp:
```typescript
// Move to end for LRU ordering, but keep original timestamp
this.cache.delete(key);
this.cache.set(key, entry);  // Don't update timestamp
```

**Risk**: Stale data served indefinitely for hot keys. In financial contexts, stale pricing/budget data.

---

### P1-10: Unsafe `as LogLevel` Cast Before Validation

**File**: `packages/kernel/logger.ts:107`
**Category**: Type Safety
**Verified**: YES

`process.env['LOG_LEVEL']?.toLowerCase()` is cast to `LogLevel` on the same expression, before `validLevels.includes()` checks it.

```typescript
const envLevel = process.env['LOG_LEVEL']?.toLowerCase() as LogLevel;
```

**Fix**: Cast after validation:
```typescript
const raw = process.env['LOG_LEVEL']?.toLowerCase();
const validLevels: LogLevel[] = ['debug', 'info', 'warn', 'error', 'fatal'];
if (raw && validLevels.includes(raw as LogLevel)) {
  return raw as LogLevel;
}
```

**Risk**: TypeScript treats invalid strings as `LogLevel` type, hiding bugs in downstream code.

---

### P1-11: Module-Level Logger Functions Missing `shouldLog()` Guard

**File**: `packages/kernel/logger.ts:300-303`
**Category**: Performance / Observability
**Verified**: YES

The module-level `info()` and `warn()` functions lack `shouldLog()` guards, unlike `debug()` (line 289). They always create log entries and dispatch to handlers regardless of configured log level.

```typescript
// Line 289 — debug has the guard
export function debug(message: string, ...): void {
  if (shouldLog('debug')) { ... }
}

// Line 300 — info MISSING the guard
export function info(message: string, ...): void {
  const entry = createLogEntry('info', message, metadata);
  getHandlers().forEach(h => h(entry));  // Always runs
}
```

Note: The `Logger` class methods (lines 419-473) correctly include `shouldLog()` guards. Only the module-level exports are affected.

**Fix**: Add `shouldLog()` to `info()`, `warn()`:
```typescript
export function info(message: string, metadata?: Record<string, unknown>): void {
  if (shouldLog('info')) {
    const entry = createLogEntry('info', message, metadata);
    getHandlers().forEach(h => h(entry));
  }
}
```

**Risk**: Log level configuration doesn't work for module-level log functions; performance overhead from unnecessary log creation.

---

### P1-12: requireRole() Throws 403 But Outer Catch Returns 500

**File**: `control-plane/api/routes/llm.ts:77,105-108`
**Category**: Architecture
**Verified**: YES

`requireRole()` throws a `RoleAccessError` (403) but the outer `catch` block catches all errors and returns `errors.internal()` (500).

```typescript
requireRole(ctx, ['owner', 'admin', 'editor', 'viewer']);  // Throws 403
// ...
} catch (error) {
  return errors.internal(res, 'Failed to fetch LLM models');  // Always 500
}
```

**Fix**: Catch `RoleAccessError` specifically:
```typescript
} catch (error) {
  if (error instanceof RoleAccessError) {
    return errors.forbidden(res, error.message);
  }
  return errors.internal(res, 'Failed to fetch LLM models');
}
```

**Risk**: Forbidden access appears as 500 in monitoring; clients cannot distinguish auth failure from server error.

---

### P1-13: Lock Benchmark Mock Doesn't Match Production Redis Lua Semantics

**File**: `test/benchmarks/lock-acquisition.bench.ts:35-55`
**Category**: Testing
**Verified**: YES

The mock `eval` doesn't simulate `NX` semantics, `PX` TTL expiration, or atomicity guarantees. The mock's `set` checks `mockRedisStore.has(key)` but doesn't implement TTL-based expiration, meaning lock contention and timeout behavior isn't tested.

```typescript
eval: vi.fn().mockImplementation(async (_script: string, numKeys: number, ...args: string[]) => {
  // No TTL simulation, no PX semantics, no atomicity
  if (mockRedisStore.has(lockKey)) return -1;
  mockRedisStore.set(lockKey, lockValue);
```

**Risk**: Benchmarks pass with flying colors but production lock behavior differs. Deadlocks and lock-expiration races not caught.

---

### P1-14: DOMPurify Hook Accumulation on Concurrent Calls

**File**: `themes/sanitize.ts:56-65`
**Category**: Security / Performance
**Verified**: YES

`DOMPurify.addHook('afterSanitizeAttributes', ...)` is called on every `sanitizeHtml()` invocation. If `removeAllHooks()` at line 65 fails or two calls race, hooks accumulate and fire multiply.

```typescript
DOMPurify.addHook('afterSanitizeAttributes', (node) => { ... });
const result = DOMPurify.sanitize(html, config);
DOMPurify.removeAllHooks();  // Race: if sanitizeHtml called concurrently
```

**Fix**: Register the hook once at module level:
```typescript
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && node.getAttribute('target') === '_blank') {
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

export function sanitizeHtml(html: string | undefined | null, options: SanitizeOptions = {}): string {
  if (!html || typeof html !== 'string') return '';
  return DOMPurify.sanitize(html, config);
}
```

**Risk**: Memory leak from accumulated hooks; performance degradation; potential race condition where one call's `removeAllHooks()` clears another call's hook before it fires.

---

## P2 — Medium (Technical Debt / Performance Degradation)

### P2-1: Rate Limiting Before Authentication

**File**: `apps/web/pages/api/diligence/links.ts:28-31`
**Category**: Security
**Verified**: YES — rate limit at line 28, auth at line 31

Unauthenticated users burn the IP-based rate limit budget for legitimate users on the same network.

**Fix**: Move `requireAuth()` before `rateLimit()`.

---

### P2-2: Error Matching via String Comparison Instead of instanceof

**File**: `apps/web/pages/api/diligence/links.ts:110`
**Category**: Type Safety
**Verified**: YES

```typescript
if (error instanceof Error && error.name === 'AuthError') return;
```

If match fails, `sendError(res, 500, ...)` sends a second response after `requireAuth()` already sent 401, causing `ERR_HTTP_HEADERS_SENT`.

**Fix**: Use `instanceof AuthError`.

---

### P2-3: IDOR Warning Log Missing User Context

**File**: `apps/web/pages/api/diligence/links.ts:41`
**Category**: Observability
**Verified**: YES

```typescript
getLogger('diligence').warn('IDOR attempt on diligence links', { domainId });
// Missing: userId, orgId, IP address
```

**Fix**: Include `auth.userId`, `auth['orgId']`, and `req.headers['x-forwarded-for']`.

---

### P2-4: Double Connection Checkout Per Request

**File**: `apps/web/pages/api/diligence/links.ts:8-17, 46-47`
**Category**: Performance
**Verified**: YES

`verifyDomainOwnership()` uses `pool.query()` (implicit checkout), then the handler uses `pool.connect()` (explicit checkout). Each request uses 2 pool connections.

**Fix**: Pass the acquired client to `verifyDomainOwnership()`.

---

### P2-5: AuthContext Uses Plain String Instead of Branded Types

**File**: `control-plane/api/routes/llm.ts:9` (via `control-plane/services/auth.ts`)
**Category**: Type Safety
**Verified**: YES — `AuthContext` has `userId: string`, `orgId: string`

**Fix**: Change to `userId: UserId`, `orgId: OrgId` from `@kernel/branded`.

---

### P2-6: Database Query Results Unvalidated (Implicit any)

**File**: `control-plane/api/routes/llm.ts:97`
**Category**: Type Safety
**Verified**: YES

`result.rows` from `pg.QueryResult` is `any[]`, silently cast to `LlmModel[]`.

**Fix**: Validate with Zod schema after query.

---

### P2-7: Model Name Fields Accept Any String

**File**: `control-plane/api/routes/llm.ts:46-47`
**Category**: Security / Validation
**Verified**: YES

`defaultModel` and `fallbackModel` accept any string with no pattern validation.

**Fix**: Add `.regex(/^[a-zA-Z0-9._-]+$/).max(100)`.

---

### P2-8: domainId Not Validated as UUID

**File**: `apps/web/pages/api/diligence/links.ts:34`
**Category**: Validation
**Verified**: YES

Only checks `typeof domainId !== 'string'`. No format validation.

**Fix**: Validate UUID format with regex or `@kernel/branded` utility.

---

### P2-9: Unnecessary Transaction on Read-Only Queries

**File**: `apps/web/pages/api/diligence/links.ts:50-87`
**Category**: Performance
**Verified**: YES

Three SELECT queries wrapped in `BEGIN/COMMIT` providing no benefit under `READ COMMITTED`.

**Fix**: Remove transaction or use `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`.

---

### P2-10: BoundedMap Constructor Bypasses Size Validation

**File**: `packages/utils/lruCache.ts:188-191`
**Category**: Type Safety
**Verified**: YES

`super(entries)` in the constructor calls `Map.set()`, not the overridden `BoundedMap.set()`. Initial entries bypass size checks entirely.

```typescript
constructor(maxSize: number, entries?: readonly (readonly [K, V])[] | null) {
  super(entries);  // Bypasses overridden set()
```

**Fix**: Use composition or validate size after `super()`:
```typescript
constructor(maxSize: number, entries?: readonly (readonly [K, V])[] | null) {
  super();
  this.maxSize = maxSize;
  if (entries) {
    for (const [k, v] of entries) this.set(k, v);  // Uses overridden set()
  }
}
```

---

### P2-11: process.once('beforeExit') Doesn't Fire on SIGTERM

**File**: `packages/kernel/logger.ts:219-228`
**Category**: Resource Management
**Verified**: YES

`beforeExit` only fires on graceful exits. Container orchestrators (K8s) send SIGTERM, which doesn't trigger `beforeExit`.

**Fix**: Also listen on `SIGTERM` and `SIGINT`:
```typescript
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => { /* cleanup handlers */ });
}
```

---

### P2-12: Dead Conditional in Console Handler

**File**: `packages/kernel/logger.ts:165-167`
**Category**: Architecture
**Verified**: YES

Both branches resolve to `console["error"]`:

```typescript
const logFn = level === 'error' || level === 'fatal' || level === 'warn'
  ? console["error"]
  : console["error"];  // Both branches identical
```

**Fix**: If all output should go to stderr (per the comment), simplify:
```typescript
const logFn = console["error"];
```

---

### P2-13: Theme Layouts Missing Viewport Meta Tag

**File**: All 5 `themes/*/app/layout.tsx`
**Category**: Accessibility / UX
**Verified**: YES — all 5 layouts identical structure

```typescript
<head><meta charSet="utf-8" /></head>
// Missing: <meta name="viewport" content="width=device-width, initial-scale=1" />
```

**Fix**: Add viewport meta tag to all layouts.

---

### P2-14: SecureLogger Switch Missing Default Case

**File**: `packages/security/logger.ts:98-111`
**Category**: Type Safety
**Verified**: YES

```typescript
switch (level) {
  case 'debug': ...
  case 'info': ...
  case 'warn': ...
  case 'error': ...
  // No default — new log levels silently dropped
}
```

**Fix**: Add exhaustiveness check:
```typescript
default: {
  const _exhaustive: never = level;
  internalLogger.warn(`Unknown log level: ${level}`, entry);
}
```

---

## P3 — Low (Style / Nitpicks)

### P3-1: Login Page Hardcoded Sign-In Path
**File**: `apps/web/pages/login.tsx:8` — Hardcoded `/sign-in` path. If Clerk route changes, link breaks silently.

### P3-2: Lifecycle Page Static Text Without Confirmation
**File**: `apps/web/pages/domains/[id]/lifecycle.tsx:7` — "These actions are irreversible" without confirmation dialog on buttons.

### P3-3: imageGeneration Missing from Update Schema
**File**: `control-plane/api/routes/llm.ts:45-57` — `LlmPreferences` interface includes `imageGeneration` but `UpdatePreferencesSchema` omits it. Users cannot update image generation settings.

### P3-4: Logger Mock Uses console.log
**File**: `test/utils/logger-mock.ts:170-172` — `printLogs()` uses `console.log`, violating the "no console.log" codebase rule.

### P3-5: LRU Cache Size Includes Expired Entries
**File**: `packages/utils/lruCache.ts:124-126` — `size` getter returns `this.cache.size` including expired-but-not-yet-cleaned entries.

### P3-6: parseInt Without Safe Integer Validation
**File**: `apps/web/pages/api/diligence/links.ts:91-94` — `parseInt()` on aggregate results doesn't check `Number.MAX_SAFE_INTEGER`.

### P3-7: Missing Return Type Annotation
**File**: `apps/api/src/auth/oauth/linkedin.ts:35` — `getLinkedInAuthUrl` missing explicit `: string` return type.

---

## Immediate Production Incident Ranking

If this code were deployed today, these findings would cause incidents in order of likelihood and blast radius:

| Rank | Finding | Incident | Blast Radius | Time to Detect |
|------|---------|----------|--------------|----------------|
| 1 | **P0-1** (Logger missing message/timestamp) | All structured logs empty — incident response impossible | Every service, every log line | Hours (when first incident requires log analysis) |
| 2 | **P0-11** (LLM fail-open) | DB blip → empty model list → content generation silently fails for all orgs | All LLM-dependent features | Minutes to hours (depends on monitoring) |
| 3 | **P0-2 + P0-4** (OAuth redirect bypass) | Account takeover via LinkedIn OAuth | All users authenticating via LinkedIn | Never (unless pen-tested) |
| 4 | **P1-2** (AuthZ bypass on diligence) | Suspended users access financial data | Diligence data for all domains | Never (unless audited) |
| 5 | **P1-5** (JSONB overwrite) | First user update erases all other preferences | All orgs updating any LLM setting | Minutes (first user complaint) |
| 6 | **P0-7 + P0-8** (No auth on frontend pages) | Competitor scrapes link health and lead magnet data | All domains' strategic data | Never (unless audited) |
| 7 | **P1-1** (Missing ROLLBACK) | Pool exhaustion under error load → cascading 500s | All diligence API requests | Minutes (under error conditions) |
| 8 | **P1-3 + P1-4** (O(N*M) query, no indexes) | Slow queries → timeouts → 504s as data grows | Diligence link analysis | Weeks (as data volume increases) |
| 9 | **P0-10** (JSON.stringify circular ref) | Logging request/error objects crashes worker | Any service logging complex objects | Random (depends on logged data shape) |
| 10 | **P0-9** (Real HTTP in tests) | CI sends requests to LinkedIn API | CI reliability + external rate limits | Random (CI flakiness) |

---

## Summary Statistics

| Severity | Count | Categories |
|----------|-------|------------|
| **P0 Critical** | 11 | 5 Security, 3 Observability/Resilience, 2 Type Safety, 1 Testing |
| **P1 High** | 14 | 4 Security, 4 SQL/Performance, 3 Type Safety, 2 Architecture, 1 Testing |
| **P2 Medium** | 14 | 4 Type Safety, 3 Performance, 3 Security, 2 Architecture, 2 Observability |
| **P3 Low** | 7 | Style, completeness, defensive programming |
| **Total** | **46** | |

**Recommended Fix Order**: P0-1 (logger) → P0-2/P0-4 (OAuth) → P1-2 (AuthZ) → P1-5 (JSONB) → P0-11 (fail-open) → P0-5/P0-7/P0-8 (frontend auth) → P1-1 (ROLLBACK) → P1-3/P1-4 (SQL perf) → remaining P1 → P2 → P3.
