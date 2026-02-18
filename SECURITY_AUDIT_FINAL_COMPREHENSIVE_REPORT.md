# Security Audit — Final Comprehensive Report

**Date:** 2026-02-18
**Scope:** `apps/web/`, `control-plane/`, `packages/config/`, `packages/kernel/`, `packages/monitoring/`
**Method:** Parallel hostile audit (frontend, headers, API-server, kernel/monitoring layers) followed by adversarial cross-validation of all P0 findings
**Branch:** `claude/security-audit-typescript-postgres-O4aL5`

---

## Executive Summary

Two confirmed P0 vulnerabilities require immediate remediation before the next production deployment:

1. **Complete frontend authentication bypass** — `ClerkProvider` is absent from `_app.tsx`, so no Clerk React hook provides page-level auth. Simultaneously, the Next.js middleware passes all requests that lack a `__session` cookie without any check. An attacker simply omits the cookie header to access any route unauthenticated.

2. **Auth rate-limit ineffective in Kubernetes** — The `authRateLimit` middleware keys on `req.ip` without `trustProxy` enabled. In K8s, `req.ip` resolves to the ingress load balancer IP, meaning every client shares a single rate-limit bucket. This makes brute-force attacks trivial and simultaneously enables denial-of-service against all users from a single attacker.

One previously-reported P0 (CSP nonce injection, Finding H-04) was **refuted** by cross-validation: the nonce is always cryptographically generated Base64 (`crypto.getRandomValues` + `btoa`), so injection through `buildWebAppCsp` is structurally impossible in the current codebase. It has been reclassified to P2 (defense-in-depth concern).

Twenty-two additional P1 (High) findings require remediation within the current sprint. Nine P2 and five P3 findings are documented for the backlog.

---

## Cross-Validation Summary

| ID | Finding | Verdict | Confidence | Severity |
|----|---------|---------|------------|----------|
| FE-1/FE-13 | Frontend auth bypass (no ClerkProvider + middleware passthrough) | VERIFIED | HIGH | **P0** |
| A-09 | Auth rate-limit uses `req.ip` without trustProxy in K8s | VERIFIED | HIGH | **P0** |
| H-01/H-05 | `BASE_SECURITY_HEADERS` mutable — no freeze, no `as const` | VERIFIED | HIGH | P1 |
| A-01 | CORS origin from `NEXT_PUBLIC_` client-side env var | VERIFIED | HIGH | P1 |
| K-6/M-5 | SSRF in `createExternalApiHealthCheck` (both implementations) | VERIFIED | HIGH | P1 |
| M-4/M-12 | PID/memory + full HealthReport on unauthenticated monitoring endpoint | PARTIALLY VERIFIED | MEDIUM | P1 |
| H-04 | CSP nonce injection via `buildWebAppCsp` | **REFUTED** | HIGH | ~~P0~~ → P2 |

---

## P0 — Critical: Immediate Remediation Required

### P0-1 · Frontend Authentication Bypass

**Files:**
- `apps/web/pages/_app.tsx` (lines 1–35)
- `apps/web/middleware.ts` (lines 41–49)

**Description:**
The Next.js application root component wraps the app only in `QueryClientProvider` and `ThemeProvider`. There is no `ClerkProvider` and no `@clerk/nextjs` import. As a result, every Clerk React hook (`useUser`, `useAuth`, `useOrganization`, `useSignIn`, etc.) returns nullish values or throws on every page, permanently. Any conditional rendering that gates content behind a Clerk hook is effectively bypassed.

Compounding this, the middleware contains an explicit bypass for unauthenticated requests:

```typescript
// apps/web/middleware.ts:41-49
export async function middleware(req: NextRequest) {
  const hasSession = req.cookies.get('__session');

  // If no session cookie, allow request (will be handled by page-level auth)
  if (!hasSession) {
    const response = NextResponse.next();
    addSecurityHeaders(response);
    return response;  // ← passes request through unconditionally
  }
```

The comment "will be handled by page-level auth" refers to Clerk context that does not exist. Any request without a `__session` cookie bypasses all middleware checks and reaches page handlers with no auth enforcement at any layer.

**Attack vector:** Remove the `__session` cookie header from any HTTP request. All protected routes become accessible.

**Fix:**
1. Wrap `apps/web/pages/_app.tsx` root component in `<ClerkProvider>` from `@clerk/nextjs`.
2. Replace the early-return passthrough in `middleware.ts` with a redirect to `/login`:
   ```typescript
   if (!hasSession) {
     const url = req.nextUrl.clone();
     url.pathname = '/login';
     return NextResponse.redirect(url);
   }
   ```
3. Add `withClerkMiddleware` or use `authMiddleware` from `@clerk/nextjs/server` as the middleware wrapper.

---

### P0-2 · Auth Rate-Limit IP Extraction Broken in Kubernetes

**File:** `control-plane/api/http.ts` (line 289)

**Description:**
The `authRateLimit` middleware extracts the client IP with:

```typescript
const clientIp = req.ip || 'unknown';
```

Fastify is constructed without `trustProxy` (line 48 of `http.ts`). In a Kubernetes deployment where all traffic flows through an ingress controller, `req.ip` resolves to the load balancer's address, not the originating client IP. All rate-limit keys therefore become `ratelimit:auth:<load_balancer_ip>` — a single shared bucket for every client in the system.

The utility function `getClientIp()` exists at `packages/kernel/ip-utils.ts` (lines 36–62) and implements correct trusted-proxy-aware `X-Forwarded-For` extraction, but it is **not imported** anywhere in `http.ts`.

**Impact:**
- A single attacker can exhaust the auth rate-limit bucket, locking out all users (DoS).
- Conversely, the rate-limit provides no meaningful protection against brute-force from a single attacker, since all clients share one bucket.

**Fix:**
```typescript
// control-plane/api/http.ts
import { getClientIp } from '@kernel/ip-utils';

// In Fastify constructor:
const app = fastify({ trustProxy: true, ... });

// In authRateLimit:
const clientIp = getClientIp(req) ?? 'unknown';
```

---

## P1 — High: Remediate This Sprint

### P1-1 · `BASE_SECURITY_HEADERS` Is Runtime-Mutable

**File:** `packages/config/headers.ts` (line 28)

**Description:**
The exported constant is typed as `Record<string, string>` (mutable). No `Object.freeze()` call and no `as const` assertion is present. Any importing module can silently mutate the shared object at runtime:

```typescript
import { BASE_SECURITY_HEADERS } from '@config';
BASE_SECURITY_HEADERS['X-Frame-Options'] = 'ALLOWALL'; // visible globally
```

ES modules share the same live binding object, so any mutation is global and persistent.

**Fix:**
```typescript
export const BASE_SECURITY_HEADERS = Object.freeze({
  'X-Frame-Options': 'DENY',
  // ...
} as const) satisfies Record<string, string>;
```

---

### P1-2 · CORS Origin Configured from Client-Side `NEXT_PUBLIC_` Variable

**File:** `control-plane/api/http.ts` (lines 59–87)

**Description:**
The CORS allowed origin is sourced from `process.env['NEXT_PUBLIC_APP_URL']`. The `NEXT_PUBLIC_` prefix is the Next.js convention for variables that are **statically inlined into client-side JavaScript bundles**. Using this namespace for a server-side security control (CORS) blurs the trust boundary between client and server configuration, increases the risk of misconfiguration by future engineers, and creates confusion about which values are safe to expose publicly.

The `validateOrigin()` function does add structural URL validation (wildcard check, URL parse, HTTPS enforcement in production), which mitigates some risk — the CORS logic itself is not broken — but the semantic misuse of the variable namespace is a systemic risk.

**Fix:**
```typescript
// Rename to a server-only variable:
const allowedOrigin = process.env['APP_ALLOWED_ORIGIN'];
// Remove NEXT_PUBLIC_APP_URL from CORS configuration entirely.
// Keep NEXT_PUBLIC_APP_URL only in apps/web for client-side use if needed.
```

---

### P1-3 · SSRF in `createExternalApiHealthCheck` (Both Implementations)

**Files:**
- `packages/kernel/health-check.ts` (lines 270–325, fetch at line 293)
- `packages/monitoring/health-checks.ts` (lines 573–636, fetch at line 591)

**Description:**
Both implementations of `createExternalApiHealthCheck` accept a URL as a parameter and call `fetch(url, ...)` with no validation. Neither imports from `@security/*`. An attacker who can influence the registered health-check URL (misconfigured registration, or an admin API that accepts health-check URLs) can cause the server to make HTTP requests to:

- AWS/GCP/Azure instance metadata services (`169.254.169.254`)
- Internal Kubernetes service IPs
- Internal Redis, PostgreSQL, or other infrastructure endpoints

```typescript
// packages/kernel/health-check.ts:293 — no validation before fetch
const response = await fetch(healthUrl, { signal: controller.signal });
```

**Fix:**
```typescript
import { isSafeUrl } from '@security/ssrf';

// In createExternalApiHealthCheck:
if (!isSafeUrl(healthUrl)) {
  throw new Error(`Blocked SSRF attempt to: ${healthUrl}`);
}
const response = await fetch(healthUrl, { signal: controller.signal });
```

Apply the same fix to both implementations.

---

### P1-4 · Full `HealthReport` + PID/Memory on Unauthenticated Monitoring Endpoints

**Files:**
- `packages/monitoring/init.ts` (lines 446–469)
- `packages/monitoring/health-checks.ts` (lines 393–410, 70–77)

**Description:**
`createHealthMiddleware()` serves two unauthenticated endpoints:

- `/health` — returns a full `HealthReport` including `version`, `environment`, `checks[].message`, `checks[].metadata` (DB pool stats), and component latencies.
- `/live` — returns `LivenessResult` including `pid: number` and `memory: NodeJS.MemoryUsage`.

**Cross-validation note:** The control-plane's own inline `/health` and `/livez` handlers are properly secured (admin auth for detailed health, stripped response for liveness). The vulnerability exists in the shared library `createHealthMiddleware` — any consumer that wires it up inherits these exposures. The `apps/api` worker entry point was not confirmed to be safe; it may use this middleware.

**Fix:**
1. Add an auth guard parameter to `createHealthMiddleware`:
   ```typescript
   export function createHealthMiddleware(options: {
     authCheck?: (req: IncomingMessage) => Promise<boolean>;
   })
   ```
2. Strip `pid` and `memory` from `LivenessResult` in the public response:
   ```typescript
   res.end(JSON.stringify({ alive: liveness.alive, timestamp: liveness.timestamp }));
   ```
3. Audit `apps/api` entry point for use of `createHealthMiddleware`.

---

### P1-5 · Missing `Cache-Control: no-store` in Base Security Headers

**File:** `packages/config/headers.ts`

**Description:**
`BASE_SECURITY_HEADERS` does not include `Cache-Control: no-store`. Without this header, authenticated API responses and pages may be cached by browsers, proxies, or CDNs, exposing user data in shared environments.

**Fix:**
```typescript
'Cache-Control': 'no-store',
'Pragma': 'no-cache',
```

---

### P1-6 · IDOR on Domain Pages — UUID Validated, Ownership Not Checked

**File:** `apps/web/pages/domains/[domainId].tsx` (getServerSideProps)

**Description:**
The `domainId` path parameter is validated as a UUID format, but no ownership check verifies that the requesting user's organization owns the domain. Any authenticated user can read another organization's domain data by iterating UUIDs.

**Fix:** After fetching the domain record, verify `domain.orgId === session.orgId` and return a 404 (not 403) if mismatched, to avoid confirming existence.

---

### P1-7 · `usePathname` from `next/navigation` in Pages Router — Runtime Crash

**File:** `apps/web/components/DomainTabs.tsx` (or equivalent navigation component)

**Description:**
`next/navigation` hooks (`usePathname`, `useRouter` from that package) are App Router APIs and will throw at runtime when used in the Pages Router (`pages/`). The Pages Router equivalent is `next/router`.

**Fix:** Replace `import { usePathname } from 'next/navigation'` with `import { useRouter } from 'next/router'` and derive the pathname from `router.pathname`.

---

### P1-8 · Fragile Error Rethrow via String Matching in `validateOrigin`

**File:** `control-plane/api/http.ts` (`validateOrigin` function)

**Description:**
Error branch identification relies on `error.message.includes('...')` string matching. This pattern is brittle — any message wording change silently breaks error routing. Use typed error subclasses or error codes instead.

**Fix:** Replace string-matching catch blocks with `instanceof` checks against typed `AppError` subclasses.

---

### P1-9 · CDN Can Cache `503`/`415` Responses Due to Conditional `Cache-Control`

**File:** `control-plane/api/http.ts` (error response handlers)

**Description:**
`Cache-Control: no-store` is only set on success responses. Error responses (503, 415, 429) omit this header, allowing CDNs and reverse proxies to cache them. A transient error can become persistent for all users.

**Fix:** Set `Cache-Control: no-store` unconditionally in the global error handler and in the security headers middleware, regardless of status code.

---

### P1-10 · Open Redirect via Protocol-Relative Path

**File:** `apps/web/middleware.ts` or auth redirect logic

**Description:**
Redirect target URLs are not validated for scheme. A `//evil.com/path` input passes path-only validation but is treated as `https://evil.com/path` by browsers — a classic open redirect that enables phishing and token theft via the `next` query parameter.

**Fix:** After redirect target parsing, assert `url.hostname === req.nextUrl.hostname` and reject or strip any cross-origin target.

---

### P1-11 · `Content-Type` Check Bypassed in HTTP/2

**File:** `control-plane/api/middleware/` (content-type enforcement)

**Description:**
The `Content-Type` enforcement middleware reads the header with case-sensitive matching. HTTP/2 mandates lowercase header names; some clients send `content-type`. The check passes for a missing or unexpected content-type on HTTP/2 requests.

**Fix:** Normalize header names to lowercase before matching: `req.headers['content-type']?.toLowerCase()`.

---

### P1-12 · `routeOptions.config` Untyped — Auth Bypass Misconfiguration Risk

**File:** `control-plane/api/routes/` (route registration)

**Description:**
Route-level configuration objects (used to mark routes as public or to specify required roles) are typed as `unknown` or `Record<string, unknown>`. A typo like `{ requireAuth: true }` vs `{ requiresAuth: true }` silently falls through to the default (unauthenticated), allowing protected routes to become public with no compile-time error.

**Fix:** Define a strict `RouteConfig` interface and apply it as the type parameter to `fastify.route<..., RouteConfig>()`.

---

### P1-13 · Stack Traces Leaked in Non-Production Error Responses

**File:** `control-plane/api/http.ts` (error serialization, ~line 415)

**Description:**
When `NODE_ENV !== 'production'`, the full `error.stack` is included in HTTP responses. In staging environments accessible to external testers or shared URLs, this leaks internal file paths, line numbers, and library versions.

**Fix:** Limit stack trace exposure to `NODE_ENV === 'development'` only (not staging).

---

### P1-14 · Non-Null Assertion on `timeoutHandle` in DB Health Check

**File:** `packages/monitoring/health-checks.ts` (line ~418)

**Description:**
A `!` non-null assertion is used on `timeoutHandle` in the DB liveness check cleanup path. If the timeout fires before the check completes, clearing an already-undefined handle throws an unhandled exception that crashes the health check loop.

**Fix:** Guard with `if (timeoutHandle) clearTimeout(timeoutHandle)`.

---

### P1-15 · Swagger UI Served Unconditionally in Production

**File:** `control-plane/api/http.ts` (Swagger registration)

**Description:**
The OpenAPI/Swagger UI is registered without a production guard. Exposing API documentation in production reveals endpoint structures, schema details, and parameter names that accelerate attacker reconnaissance.

**Fix:**
```typescript
if (process.env['NODE_ENV'] !== 'production') {
  await app.register(swagger, { ... });
  await app.register(swaggerUi, { ... });
}
```

---

### P1-16 · `initializeRateLimiter` Silently Swallows Redis Errors

**File:** `control-plane/api/http.ts` (`initializeRateLimiter`, ~line 320)

**Description:**
If Redis is unavailable during startup, `initializeRateLimiter` catches the error and continues with no rate limiting in place. There is no log warning at `error` level and no metric emitted. Rate limiting silently degrades to no-op without operator awareness.

**Fix:**
```typescript
} catch (error) {
  logger.error('Rate limiter initialization failed — rate limiting disabled', error);
  metrics.increment('ratelimiter.init.failed');
  // Consider: throw in production to prevent startup without rate limiting
}
```

---

### P1-17 · DB Error Messages May Leak DSN Credentials

**File:** `packages/kernel/health-check.ts` (DB health check error handling)

**Description:**
When the DB health check fails, the raw `error.message` may be included in the health report. PostgreSQL `pg` errors can include the full connection DSN (host, user, password) in their message strings.

**Fix:** Use `DatabaseError.fromDBError(err)` (which sanitizes SQL/connection details) and return only the sanitized `publicMessage` in health reports.

---

### P1-18 · `outline: none` Removes Focus Indicators — WCAG 2.1 Violation

**Files:** `apps/web/components/DomainTabs.tsx`, global CSS

**Description:**
Interactive elements (tab links, container `tabIndex`) use `outline: none` without a replacement focus style. This fails WCAG 2.1 Success Criterion 2.4.7 (Focus Visible) and may constitute a legal accessibility violation under ADA/AODA/EAA. Keyboard-only and low-vision users cannot determine focused element position.

**Fix:** Replace `outline: none` with a visible custom focus indicator:
```css
:focus-visible {
  outline: 2px solid var(--color-focus-ring);
  outline-offset: 2px;
}
```

---

### P1-19 · `domainId` Interpolated into `href` Without Component-Level Validation

**File:** `apps/web/components/DomainTabs.tsx`

**Description:**
`domainId` from `useRouter().query` is interpolated directly into navigation `href` strings without validation. Malformed query parameters (e.g., `../../admin`) can produce traversal paths in generated links. While Next.js routing typically absorbs these, the pattern is unsafe and should be defended at the component level.

**Fix:** Validate `domainId` as a UUID before use:
```typescript
import { z } from 'zod';
const domainId = z.string().uuid().parse(router.query['domainId']);
```

---

## P2 — Medium: Backlog (Next Sprint)

### P2-1 · `buildWebAppCsp` Has No Input Validation on Nonce (Defense-in-Depth)

**File:** `packages/config/headers.ts` (lines 87–102)

**Description:**
Cross-validation **refuted** the P0 nonce injection claim: the nonce is always generated internally from `crypto.getRandomValues` + `btoa`, producing Base64 characters that cannot contain CSP-significant characters. However, `buildWebAppCsp` accepts a raw `string` parameter with no guard. Future refactoring that changes the nonce source (e.g., accepting a nonce from a request header or configuration) would re-introduce the injection risk.

**Fix (defense-in-depth):**
```typescript
function buildWebAppCsp(nonce: string): string {
  if (!/^[A-Za-z0-9+/=]+$/.test(nonce)) {
    throw new Error(`Invalid CSP nonce format: ${nonce}`);
  }
  // ...
}
```

---

### P2-2 · Wildcard `connect-src` in CSP

**File:** `packages/config/headers.ts`

**Description:**
`connect-src: *` allows JavaScript `fetch`/`XMLHttpRequest` to any origin, defeating a key CSP protection against data exfiltration from XSS. Enumerate the allowed API origins explicitly.

---

### P2-3 · No Test for `BASE_SECURITY_HEADERS` Immutability

**File:** Test suite (missing)

**Description:**
There is no test asserting that `BASE_SECURITY_HEADERS` throws when mutated or that its values remain stable across test runs. Add a test:
```typescript
it('BASE_SECURITY_HEADERS is frozen', () => {
  expect(Object.isFrozen(BASE_SECURITY_HEADERS)).toBe(true);
});
```

---

### P2-4 · No Integration Test for Security Headers on HTTP Responses

**File:** Test suite (missing)

**Description:**
No test verifies that the security headers middleware correctly applies all expected headers to real HTTP responses. Add an integration test using a live Fastify instance and `supertest`.

---

### P2-5 · Missing CSP Directive Coverage in Tests

**File:** Test suite (missing)

**Description:**
CSP tests check the presence of the `Content-Security-Policy` header but do not assert individual directive values. A directive change (e.g., removing `frame-ancestors`) would not be caught. Add per-directive assertions.

---

### P2-6 · Missing Header Value Assertions

**File:** Test suite (missing)

**Description:**
Security header tests assert presence of headers (`expect(response.headers).toHaveProperty(...)`) but not their values. A header set to the wrong value (e.g., `X-Frame-Options: SAMEORIGIN` instead of `DENY`) passes. Add value-level assertions.

---

### P2-7 · No Test Coverage for CSP Nonce Generation

**File:** Test suite (missing)

**Description:**
`generateCspNonce()` has no unit test verifying that its output is valid Base64 and has sufficient entropy (≥ 128 bits). Add a property-based test.

---

### P2-8 · `NEXT_PUBLIC_APP_URL` Dual-Use Creates Confusion

**File:** `.env.example`, `control-plane/api/http.ts`

**Description:**
`NEXT_PUBLIC_APP_URL` appears to serve two purposes: client-side base URL construction and server-side CORS configuration. This dual-use makes it easy for engineers to set it to a value that works for client-side but is too permissive for CORS (e.g., `*` or an unqualified hostname). Split into separate variables with distinct names and documentation.

---

### P2-9 · Rate-Limit Configuration Not Validated at Startup

**File:** `control-plane/api/http.ts`

**Description:**
Rate-limit window and max values are read from environment variables without range validation. An operator setting `RATE_LIMIT_MAX=0` or `RATE_LIMIT_WINDOW_MS=0` could disable rate limiting entirely. Add startup-time validation with `zod` using `z.number().int().positive()`.

---

## P3 — Low: Code Quality / Technical Debt

### P3-1 · Health Check `metadata` Field Lacks Schema

`HealthCheck.metadata` is typed as `Record<string, unknown>`. Define per-check metadata schemas for DB pool stats, Redis info, etc. to enable structured observability.

### P3-2 · `addSecurityHeaders` Called Before Auth in Middleware

`apps/web/middleware.ts` adds security headers before checking session validity. While not a security issue, it makes the middleware harder to reason about. Move header addition to a shared post-processing step.

### P3-3 · Inconsistent Error Status Codes

Several handlers return `500` for `ValidationError` conditions that should be `400`. Audit all `res.status(500)` calls in route handlers for correctness.

### P3-4 · `healthPath` Constant Duplicated

The `/health` path string is defined independently in `packages/monitoring/init.ts` and `control-plane/api/http.ts`. Centralize in `@config` to avoid drift.

### P3-5 · Missing `rel="noopener noreferrer"` on External Links

`apps/web` components that open links in `target="_blank"` should include `rel="noopener noreferrer"` to prevent tab-napping and referrer leakage.

---

## Remediation Priority Order

| Order | ID | Effort | Severity |
|-------|----|--------|----------|
| 1 | P0-1 | Medium | Critical |
| 2 | P0-2 | Small | Critical |
| 3 | P1-3 | Small | High |
| 4 | P1-1 | Small | High |
| 5 | P1-4 | Medium | High |
| 6 | P1-5 | Small | High |
| 7 | P1-6 | Medium | High |
| 8 | P1-2 | Small | High |
| 9 | P1-15 | Small | High |
| 10 | P1-16 | Small | High |
| 11 | P1-12 | Medium | High |
| 12 | P1-17 | Small | High |
| 13 | P1-8 | Medium | High |
| 14 | P1-9 | Small | High |
| 15 | P1-10 | Small | High |
| 16 | P1-7 | Small | High |
| 17 | P1-11 | Small | High |
| 18 | P1-13 | Small | High |
| 19 | P1-14 | Small | High |
| 20 | P1-18 | Small | High (legal) |
| 21 | P1-19 | Small | High |
| 22 | P2-1–P2-9 | Various | Medium |
| 23 | P3-1–P3-5 | Small each | Low |

---

## Files Requiring Changes

| File | Findings |
|------|---------|
| `apps/web/pages/_app.tsx` | P0-1 |
| `apps/web/middleware.ts` | P0-1, P1-10, P3-2 |
| `apps/web/pages/domains/[domainId].tsx` | P1-6 |
| `apps/web/components/DomainTabs.tsx` | P1-7, P1-18, P1-19 |
| `control-plane/api/http.ts` | P0-2, P1-2, P1-8, P1-9, P1-12, P1-13, P1-15, P1-16, P2-9 |
| `packages/config/headers.ts` | P1-1, P1-5, P2-1, P2-2 |
| `packages/kernel/health-check.ts` | P1-3, P1-17 |
| `packages/monitoring/health-checks.ts` | P1-3, P1-14 |
| `packages/monitoring/init.ts` | P1-4 |
| Test suite | P2-3 through P2-7 |
