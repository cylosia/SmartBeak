# SmartBeak Code Review

**Date:** 2026-02-17
**Reviewer:** Claude Code
**Branch:** `claude/code-review-Xjrv2`
**Scope:** Full codebase review following previous rounds (CODE_REVIEW.md, CODE_REVIEW2.md) and fixes in PR #169

---

## Executive Summary

The codebase has made clear progress through several rounds of review and targeted fixes (PRs #151–#169). The architecture is sound — DDD layering, Zod validation, structured logging, and parameterized SQL are consistently applied across active code. However, several issues that were identified in prior reviews remain unresolved or have introduced new regressions, and the TypeScript compilation failure affecting ~3,886 locations is a blocker that prevents reliable static analysis and CI/CD.

**Priority classification:**

| Severity | Count | Examples |
|----------|-------|---------|
| P0 — Blocker | 2 | TS compilation failure, swallowed rollback errors |
| P1 — High | 4 | Unhandled rejections in diligence routes, disabled Stripe log sanitization, auth ordering violation, `require()` in ESM |
| P2 — Medium | 4 | Unsafe `AuthContext` casts, OTel version mismatch, missing billing unit tests, confusing rate-limit API |
| P3 — Low | 3 | Discontinued `fernet` dependency, ESLint 8 EOL, dead orphaned services |

---

## P0 — Blockers

### P0-1: TypeScript compilation fails across ~3,886 locations

**Root cause:** `apps/api/` and several packages lack `"types": ["node"]` in their `tsconfig.json`, so Node.js built-in modules (`crypto`, `Buffer`, `process`, `NodeJS` namespace) are unresolvable. Additionally, optional peer packages (`node-fetch`, `googleapis`, `@google-analytics/data`, `abort-controller`, `nodemailer`, `@aws-sdk/client-ses`) are declared as imports but not installed in all workspaces.

**Representative errors (non-plugin):**

```
apps/api/src/adapters/gbp/GbpAdapter.ts: Cannot find name 'Buffer', 'process'
apps/api/src/adapters/ga/GaAdapter.ts:   Cannot find module '@google-analytics/data'
packages/shutdown/index.ts:              Cannot find name 'process'
packages/types/notifications.ts:        Cannot find name 'Buffer'
packages/utils/fetchWithRetry.ts:       Cannot find module 'crypto', Cannot find namespace 'NodeJS'
```

**Impact:** `npm run type-check` exits non-zero. CI/CD cannot gate on type safety. Developers run with false confidence when testing locally if the check is skipped. Static analysis tools see type holes that allow silent `any`-typed operations.

**Fix:** In `apps/api/tsconfig.json` and affected `packages/*/tsconfig.json`, add `"node"` to `compilerOptions.types`. For optional dependencies imported unconditionally, either install them as devDependencies where needed or guard the import with `declare module` shims so the build succeeds without them installed.

---

### P0-2: Rollback failure silently swallowed in `publishing-create-job.ts`

**File:** `control-plane/services/publishing-create-job.ts:85–93`

```typescript
} catch (error) {
  try {
    await client.query('ROLLBACK');
  } catch (rollbackError) {
    // Rollback error - already in error handling, cannot recover
  }
  throw error;
}
```

**Problem:** When `ROLLBACK` fails (lost connection, lock timeout, network partition), the `rollbackError` is entirely discarded. The connection is then returned to the pool via `finally { client.release() }` in a potentially open-transaction state. The next consumer of that connection may execute queries against uncommitted state.

More operationally: when a publish job fails at scale, operators have no signal that cleanup also failed. Tables can remain locked, blocking all subsequent writes — a cascade failure that appears as unrelated timeouts.

**Fix:**

```typescript
} catch (rollbackError) {
  logger.error('ROLLBACK failed — connection may be in bad state', rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError)));
  // Destroy the client so it is removed from the pool, not recycled
  client.release(true); // passing `true` destroys the client
  throw error; // re-throw original error
}
```

Note that `client.release(true)` signals `node-postgres` to destroy the connection rather than return it to the pool, preventing state corruption. Move this call out of the `finally` block (or set a flag so the `finally` knows the client was already released).

---

## P1 — High

### P1-1: Unhandled rejection in `diligence` routes crashes the process

**File:** `control-plane/api/routes/diligence.ts:20–24` (and the equivalent `affiliate-revenue` handler at ~:93)

```typescript
app.get('/diligence/:token/overview', async (req, res) => {
  // OUTSIDE try block:
  const { token } = TokenParamSchema.parse(req.params);  // ZodError → unhandled rejection
  await rateLimit('diligence', 30);                       // Redis error → unhandled rejection

  try {
    // ... DB queries
  } catch (error) {
    logger.error('Diligence overview error', ...);
    return errors.internal(res, 'Failed to fetch diligence overview');
  }
});
```

Both calls precede the `try` block. If:
- `req.params.token` fails the regex or length constraint → `ZodError` is thrown outside the catch → Fastify's global error handler returns a 500 with a raw stack trace (in dev) or an empty body (in prod).
- Redis is unavailable when `rateLimit()` is called → unhandled rejection.

**Fix:** Either move both calls inside the `try` block, or use `.safeParse()` and respond explicitly:

```typescript
app.get('/diligence/:token/overview', async (req, res) => {
  try {
    const parseResult = TokenParamSchema.safeParse(req.params);
    if (!parseResult.success) {
      return errors.badRequest(res, 'Invalid token format');
    }
    const { token } = parseResult.data;
    await rateLimit('diligence', 30);
    // ... rest of handler
  } catch (error) {
    logger.error('Diligence overview error', error instanceof Error ? error : new Error(String(error)));
    return errors.internal(res, 'Failed to fetch diligence overview');
  }
});
```

The same pattern applies to the `affiliate-revenue`, `traffic`, `content-quality`, and any other diligence handlers using `.parse()` outside a try block.

---

### P1-2: Stripe log sanitization disabled — PII/secrets leak into logs

**File:** `apps/web/pages/api/stripe/portal.ts:6–8`

```typescript
// import { sanitizeForLogging } from '@security/logger';
const sanitizeForLogging = (obj: unknown): unknown => obj;
```

`sanitizeForLogging` has been replaced with an identity function. This means Stripe error objects — which can contain customer email addresses, partial card data, Stripe customer IDs, and occasionally API key fragments in error messages — are written verbatim to the structured logger.

The logger auto-redacts known field names (tokens, passwords), but Stripe error objects surface these values under non-standard keys (`charge`, `customer`, `payment_intent`, `raw`, etc.) that the redaction rules do not cover.

**Fix:** Restore the real import:

```typescript
import { sanitizeForLogging } from '@security/logger';
```

If the import was disabled because `@security/logger` is not yet exporting `sanitizeForLogging`, add the export rather than leaving a no-op in place.

---

### P1-3: Auth ordering violation in billing routes contradicts stated architecture contract

**File:** `control-plane/api/routes/billing.ts:22–25`
**CLAUDE.md:** "Rate limiting runs before auth checks"

```typescript
const ctx = getAuthContext(req);
requireRole(ctx, ['owner']);
await rateLimit('billing', 20);   // rate limit AFTER auth
```

The project's own architecture documentation specifies that rate limiting runs first. The intent is to prevent unauthenticated/malformed requests from bypassing the rate limiter by exploiting the auth check path. When auth runs first:
1. An attacker can probe the auth system (timing oracle) without consuming their rate limit budget.
2. Auth middleware failures do not trigger rate limiting, so repeated auth failures are free.

**Fix:** Reorder to rate-limit first:

```typescript
await rateLimit('billing', 20);
const ctx = getAuthContext(req);
requireRole(ctx, ['owner']);
```

Verify that `getAuthContext` properly handles the case where no auth context exists (throws `AuthError`), and that the error propagates correctly through the catch block — which it already does since the catch returns `errors.internal(res)`.

---

### P1-4: CommonJS `require()` in an ESM-only codebase breaks module guarantees

**File:** `control-plane/services/container.ts:234`

```typescript
const { PostgresIndexingJobRepository } = require('../../domains/search/infra/persistence/PostgresIndexingJobRepository');
```

The project is ESM-only (`"type": "module"` in `package.json`). Using dynamic `require()` bypasses TypeScript module resolution, tree-shaking, and the monorepo's path alias system. It works at runtime only because Node.js CJS/ESM interop allows it under specific conditions, but this is fragile: it breaks with `--experimental-require-module` changes, breaks bundlers, and prevents the type checker from validating the import.

The comment indicates this was a workaround for a circular dependency. The correct fix is to break the cycle by extracting the shared interface (`IndexingJobRepository`) to `packages/types/` or a dedicated domain port file, then importing the interface from there. Both the concrete implementation and `container.ts` import from the neutral package — no cycle.

**Interim fix until the circular dep is properly resolved:** Use dynamic `import()` (which is ESM-native) instead:

```typescript
const { PostgresIndexingJobRepository } = await import('../../domains/search/infra/persistence/PostgresIndexingJobRepository.js');
```

---

## P2 — Medium

### P2-1: Unsafe `as AuthContext` cast in `publishing.ts` (5 handlers)

**File:** `control-plane/api/routes/publishing.ts:27, 42, 63, 78, 107`

```typescript
const ctx = req.auth as AuthContext;
```

This cast bypasses the null/undefined check that exists in `getAuthContext()`. If the auth middleware does not set `req.auth` (e.g., middleware is misconfigured, or the route is registered before the auth plugin), `ctx` is `undefined` at runtime while TypeScript believes it is `AuthContext`. Subsequent `ctx.userId`, `ctx.orgId`, `ctx.roles` accesses throw `TypeError: Cannot read properties of undefined`.

The pattern `getAuthContext(req)` is already used correctly in `billing.ts`, `analytics.ts`, and `timeline.ts`. Standardize.

**Fix:**

```typescript
// Replace all 5 instances:
const ctx = req.auth as AuthContext;
// With:
const ctx = getAuthContext(req);
```

`getAuthContext` is defined in `control-plane/api/types.ts` and throws `AuthError` if the context is absent, which is caught by the surrounding try/catch and returns `errors.internal(res)`. Consider whether it should return `errors.unauthorized(res)` instead — an `AuthError` should produce 401, not 500.

---

### P2-2: OpenTelemetry instrumentation/SDK version mismatch

**File:** `package.json`

| Package | Installed | Expected by instrumentation |
|---------|-----------|----------------------------|
| `@opentelemetry/core` | `1.30.1` | `~1.22.0` (peer dep of `@0.49.1` instrumentation) |
| `@opentelemetry/instrumentation` | `0.49.1` | — |
| `@opentelemetry/instrumentation-http` | `0.49.1` | — |
| `@opentelemetry/instrumentation-pg` | `0.39.1` | — |

When multiple OTel packages resolve different versions of `@opentelemetry/core`, two separate module instances exist in the same process. Span context propagation uses module-level globals; with two instances, spans started in one version cannot be found by the other. The result is: traces appear as disconnected root spans rather than a unified tree, making distributed tracing effectively unusable.

**Fix:** Upgrade instrumentation packages to the `0.57.x` series, which aligns with `@opentelemetry/core@1.30.x`:

```json
"@opentelemetry/instrumentation": "0.57.2",
"@opentelemetry/instrumentation-fastify": "0.41.0",
"@opentelemetry/instrumentation-http": "0.57.2",
"@opentelemetry/instrumentation-ioredis": "0.47.0",
"@opentelemetry/instrumentation-pg": "0.50.0"
```

---

### P2-3: No unit tests for `control-plane/services/billing.ts` (416 lines, financial logic)

The billing service handles plan assignment, idempotency deduplication, subscription cancellation, and usage tracking — all with direct database mutations. It uses serializable transactions and idempotency keys, which are correct, but these invariants are untested.

The existing `apps/api/src/billing/__tests__/stripe.test.ts` and `paddle-webhook.test.ts` test a **different billing implementation** in `apps/api/` (the BullMQ worker app), not `control-plane/services/billing.ts`.

**Missing test scenarios in `control-plane/services/billing.ts`:**

1. Double-call with the same idempotency key returns the cached result without a second DB write.
2. A failed `assignPlan` (e.g., DB error mid-transaction) rolls back correctly and leaves no partial state.
3. `cancelPlan` with an already-cancelled plan does not produce a duplicate audit entry.
4. Concurrent `assignPlan` calls for the same org under serializable isolation — only one succeeds.
5. Corrupted idempotency records (malformed JSON) are detected and cleared, allowing retry.

**Location:** Create `control-plane/services/__tests__/billing.test.ts`.

---

### P2-4: `rateLimit()` overload API is ambiguous and deprecated-but-still-used

**File:** `control-plane/services/rate-limit.ts`

The function is marked `@deprecated` in JSDoc but is still imported by 39+ route and service files. There are two call signatures dispatched via `arguments.length` inspection, which is a fragile pattern in TypeScript (all overloads are in the same function body, making the type narrowing implicit).

More practically: callers pass `'content'`, `'billing'`, `'diligence'` as the first argument but the function documentation does not define what these namespaces mean for configuration purposes. Changing rate limits requires finding every call site.

**Fix (two-phase):**
1. Add explicit configuration constants mapping each namespace to its `{ max, windowMs }` values.
2. Replace the deprecated function with a typed alternative (e.g., `rateLimitNamed('billing')`) to make the migration auditable.

---

## P3 — Low

### P3-1: `fernet@0.3.3` transitively depends on discontinued `crypto-js`

`fernet` uses `crypto-js` for AES encryption. `crypto-js` was officially discontinued after `4.2.0` (CVE-2023-46233 patched in that version, but no future maintenance). Node.js has had `crypto.createCipheriv` / `createDecipheriv` with AES-GCM support since v10.

**Fix:** Audit where `fernet` is used in the codebase, then replace with a thin wrapper around Node.js `crypto`:

```typescript
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

function encrypt(plaintext: string, key: Buffer): { iv: string; ciphertext: string } {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { iv: iv.toString('hex'), ciphertext: encrypted.toString('hex') };
}
```

---

### P3-2: ESLint 8 is end-of-life (EOL: October 2024)

**File:** `package.json` — `"eslint": "8.57.1"`

ESLint 8 receives no further bug fixes, security patches, or rule updates. The lockfile marks it as deprecated. ESLint 9 with flat config (`eslint.config.js`) is the current stable release.

**Fix:** Upgrade to ESLint 9 and `@typescript-eslint` v8. The migration from `.eslintrc.cjs` to `eslint.config.js` (flat config) is a one-time effort. The ESLint migration guide and `@typescript-eslint/eslint-plugin` v8 migration guide cover the breaking changes.

---

### P3-3: 41 services in `control-plane/services/` appear to be orphaned

Prior dead-code removal (PR #158) removed 122 files but focused on clearly unreferenced modules. A secondary review suggests several services in `control-plane/services/` are defined but never registered with the Fastify application or injected via `container.ts`.

Orphaned services still accumulate maintenance cost: they are type-checked, linted, and reviewed. More importantly, when they contain bugs or outdated logic, developers may not notice because the code path is never exercised.

**Recommendation:** Run a dependency graph analysis (e.g., `madge --circular --extensions ts control-plane/`) to identify services not reachable from the main entry point (`control-plane/server.ts`), then either wire them in or delete them.

---

## Positive Observations

The following patterns are implemented correctly and should be preserved:

- **Parameterized SQL everywhere** — No string interpolation found in query parameters across reviewed files.
- **Structured logging** — `getLogger()` is used consistently; `console.log` is absent from production code.
- **Zod validation on all routes** — `safeParse` with explicit error responses is the dominant pattern in newer route files (`billing.ts`, `seo.ts`).
- **`FOR UPDATE` locking in membership service** — Prevents the last-owner TOCTOU race condition. This was correctly applied in the recent PR.
- **Facebook adapter production guard** — `container.ts` now throws `ServiceUnavailableError` in production when `FACEBOOK_PAGE_TOKEN` is absent, which is correct.
- **Idempotency key design in billing** — Deterministic key generation from `(orgId, operation, planId)` combined with Redis-backed idempotency checks is the right approach.
- **`DatabaseError.fromDBError()`** — Correctly sanitizes PostgreSQL error details before they reach HTTP responses.

---

## Recommended Fix Order

1. **P0-1 (TS compilation):** Add `"types": ["node"]` to `apps/api/tsconfig.json` and the affected `packages/*/tsconfig.json` files. Install `@types/node` where missing.
2. **P0-2 (rollback logging):** Add `logger.error(rollbackError)` in `publishing-create-job.ts` and call `client.release(true)` on rollback failure.
3. **P1-1 (diligence unhandled rejection):** Wrap `TokenParamSchema.safeParse()` and `rateLimit()` inside the try block in all diligence route handlers.
4. **P1-2 (Stripe sanitization):** Restore `sanitizeForLogging` import in `apps/web/pages/api/stripe/portal.ts`.
5. **P1-3 (auth ordering):** Move `rateLimit()` calls before `getAuthContext()` / `requireRole()` in `billing.ts`.
6. **P1-4 (require in ESM):** Replace `require()` in `container.ts` with dynamic `import()` or a proper interface extraction.
7. **P2-1 (unsafe casts):** Replace `req.auth as AuthContext` with `getAuthContext(req)` in `publishing.ts`.
8. **P2-2 (OTel):** Align instrumentation packages to `0.57.x`.
9. **P2-3 (billing tests):** Add unit tests for `control-plane/services/billing.ts`.
10. **P3-1 (fernet):** Replace with native `crypto` AES-GCM.
11. **P3-2 (ESLint):** Upgrade to ESLint 9.
