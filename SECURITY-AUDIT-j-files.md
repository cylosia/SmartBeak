# Security Audit Report: Files Starting With "j"

**Date**: 2026-02-20
**Scope**: All files where filename starts with "j" (12 files, ~2,800 LOC)
**Method**: Hostile code review with 6 parallel audit agents + cross-verification
**Standard**: Financial-grade (bugs cost millions)

---

## Executive Summary

**134 raw findings** across 6 parallel audits were deduplicated to **68 unique findings**:
- **P0 (Critical)**: 3 findings -- production outage, security breach imminent
- **P1 (High)**: 25 findings -- bugs under load, security vulnerabilities
- **P2 (Medium)**: 28 findings -- technical debt, performance degradation
- **P3 (Low)**: 12 findings -- style, maintainability

The most dangerous cluster is in the JWT subsystem where **three independent agents** confirmed that `refreshToken()` bypasses the revocation system, meaning revoked tokens can be refreshed into new valid tokens.

---

## Files Audited

| File | Lines | Primary Concern |
|------|-------|----------------|
| `packages/security/jwt.ts` | 519 | JWT verification, key management |
| `control-plane/services/jwt.ts` | 670 | JWT signing, revocation, Redis |
| `packages/kernel/validation/jsonb.ts` | 176 | JSONB size validation |
| `packages/monitoring/jobOptimizer.ts` | 504 | Job coalescing, scheduling |
| `apps/api/src/jobs/jobGuards.ts` | 157 | Org capacity enforcement |
| `apps/web/pages/system/jobs.tsx` | 32 | Admin jobs page |
| `packages/config/jobs.ts` | 119 | Job queue configuration |
| `jest.config.ts` | 190 | Test configuration |
| `test/factories/job.ts` | 138 | Test factories |
| `packages/security/__tests__/jwt.test.ts` | 521 | JWT tests |
| `control-plane/services/__tests__/jwt-signing.test.ts` | 101 | Signing tests |
| `apps/api/tests/integration/job-processing.test.ts` | 348 | Integration tests |

---

## P0 -- Critical (3 findings)

### C1. `refreshToken()` Bypasses Revocation -- Complete Revocation System Defeat
**Verified by: 3 independent agents**

- **File**: `control-plane/services/jwt.ts:605`
- **Category**: Security
- **Violation**: `refreshToken()` is synchronous and calls `jwt.verify()` directly instead of the async `verifyToken()` which includes the Redis revocation check. A revoked token can be refreshed to obtain a brand-new valid token with a new `jti` not in the revocation list.
- **Attack chain**: (1) Admin revokes user's token via `revokeToken(jti)` -> (2) User calls refresh endpoint with revoked token -> (3) `refreshToken()` only checks signature (valid) -> (4) New valid token returned -> (5) Revocation defeated.
- **Fix**: Make `refreshToken()` async and call `verifyToken()` (which includes revocation check) instead of raw `jwt.verify()`:
  ```typescript
  export async function refreshToken(token: string): Promise<string> {
    const claims = await verifyToken(token); // includes revocation check
    return signToken({ sub: claims.sub, role: claims.role, orgId: claims.orgId });
  }
  ```
- **Blast radius**: Every revoked user can regain access. The entire revocation infrastructure (`revokeToken`, `revokeAllUserTokens`, Redis revocation lists) becomes security theater.

### C2. `isRevoked: undefined as unknown as boolean` -- Type-Lie Defeats Revocation Reporting
**Verified by: 2 independent agents**

- **File**: `control-plane/services/jwt.ts:583`
- **Category**: Security / Type
- **Violation**: `isRevoked: undefined as unknown as boolean` casts `undefined` to `boolean`. The `TokenInfo` interface declares `isRevoked: boolean`. Any consumer checking `if (!info.isRevoked)` evaluates `!undefined === true`, treating the token as **not revoked**. The P2-7 "fix" comment claims to address this but `undefined` is falsy just like the old `false` value -- the fix is a no-op.
- **Fix**: Change `TokenInfo.isRevoked` to `boolean | undefined` or remove the field from `getTokenInfo()` entirely (it cannot determine revocation without Redis).
- **Blast radius**: Any future caller of `getTokenInfo()` that checks `isRevoked` will trust revoked tokens as valid.

### C3. Malicious `toJSON()` Enables Arbitrary Code Execution During `JSON.stringify`

- **File**: `packages/kernel/validation/jsonb.ts:24`, `:96`, `:129`
- **Category**: Security
- **Violation**: `JSON.stringify(data)` invokes any `toJSON()` method on the input. Since `data` is `unknown`, an attacker controlling input (via deserialized payloads with prototype pollution) can execute arbitrary synchronous JS during serialization -- making HTTP calls, reading `process.env`, writing files, or causing infinite loops that bypass the size check.
- **Fix**: Use `structuredClone(data)` before serialization (strips methods), or validate that objects don't have a `toJSON` function property.
- **Blast radius**: Arbitrary code execution within the API process. Data exfiltration of secrets. CPU/memory DoS.

---

## P1 -- High (25 findings)

### H1. `boundOrgId` Not Enforced on API Backend -- Token Binding Bypass
**Verified by: 2 independent agents**

- **File**: `packages/security/jwt.ts:461` (`getAuthContext`)
- **Category**: Security
- **Violation**: Tokens are signed with `boundOrgId: orgId` but `getAuthContext()` and `requireAuthContext()` completely ignore this field. Only `apps/web/lib/auth.ts` checks it. All Fastify API routes using the security package's auth functions skip the binding check.
- **Fix**: Add `boundOrgId` validation in `getAuthContext()`:
  ```typescript
  if (claims.boundOrgId && !constantTimeCompare(claims.boundOrgId, claims.orgId)) {
    return null;
  }
  ```
- **Blast radius**: A token issued for Org A can be used against Org B's API endpoints if the orgId claim is manipulated.

### H2. `buyer` Role Missing from Authorization Hierarchy
**Verified by: 2 independent agents**

- **File**: `packages/security/auth.ts:328-333`
- **Category**: Security
- **Violation**: `roleHierarchy` maps `viewer:1, editor:2, admin:3, owner:4` but has no `buyer` entry. `hasRequiredRole('buyer', 'viewer')` evaluates `(roleHierarchy['buyer'] ?? 0) >= 1` = `false`. Buyer-role tokens pass JWT verification but fail every authorization gate. Additionally, `apps/web/lib/auth.ts:166` `mapRole()` throws on `buyer`, causing 500 errors.
- **Fix**: Add `buyer: 0` to `roleHierarchy` in all three locations that define it.
- **Blast radius**: All buyer-role users are silently locked out of the entire application.

### H3. Key Rotation Asymmetry -- Control-Plane Signs with Stale Keys
**Verified by: 3 independent agents**

- **File**: `control-plane/services/jwt.ts:277` vs `packages/security/jwt.ts:266-289`
- **Category**: Security / Architecture
- **Violation**: The verification module reloads keys every 60s via `getCurrentKeys()`. The signing module uses `const KEYS = getKeys()` loaded once at module init. After key rotation, the control-plane signs with stale keys that the verification module no longer accepts.
- **Fix**: Replace static `KEYS` with a `getCurrentKeys()` function that reloads on interval, or import key management from the security package.
- **Blast radius**: After key rotation during rolling deploys, all newly issued tokens fail verification until old processes restart -- complete auth outage.

### H4. Redis Pipeline Fail-Open on Null Return
**Verified by: 1 agent**

- **File**: `control-plane/services/jwt.ts:447-449`
- **Category**: Security
- **Violation**: If `pipeline.exec()` returns `null` (connection lost mid-pipeline), the destructured `[jtiRevoked, userRevoked]` are both `undefined`. Optional chaining `?.[1]` returns `undefined`, and `undefined === 1` is `false`. The function returns `false` (not revoked) -- a fail-open on partial Redis failure.
- **Fix**: Validate pipeline result is non-null and check per-command error tuples:
  ```typescript
  const results = await pipeline.exec();
  if (!results || results.length < 2) throw new AuthError('Revocation check failed', '...');
  if (results[0]![0] || results[1]![0]) throw new AuthError('Revocation check failed', '...');
  ```
- **Blast radius**: During partial Redis failures, revoked tokens are silently accepted.

### H5. No Token Size Validation -- DoS via Oversized Tokens

- **File**: `packages/security/jwt.ts:336`
- **Category**: Security / Performance
- **Violation**: No upper bound on token string length. A 10MB `Authorization: Bearer <huge string>` passes through regex matching, base64 decode, and `jwt.verify()`, causing memory/CPU spikes.
- **Fix**: Add `if (token.length > 8192) throw new TokenInvalidError('Token exceeds maximum length');` as the first check in `verifyToken`.

### H6. Zod Validation Error Details Leak Schema Structure to Clients

- **File**: `packages/security/jwt.ts:306` and `:447`
- **Category**: Security
- **Violation**: `verifyJwtClaims` throws `TokenInvalidError('Invalid claims: ${result.error.message}')`. Zod errors contain field names, types, and enum values (e.g., `"Expected 'admin' | 'editor' | 'viewer' | 'owner' | 'buyer'"`). `extractAndVerifyToken` returns `error.message` directly to callers.
- **Fix**: Return generic `'Token claims validation failed'` to callers; log details server-side.

### H7. Hardcoded JWT Audience/Issuer Defaults Unsafe in Production

- **File**: `packages/security/jwt.ts:111-112`
- **Category**: Security
- **Violation**: `process.env['JWT_AUDIENCE'] || 'smartbeak'` uses well-known defaults when env vars are missing. An attacker who knows the defaults (published in source code) can craft tokens matching a misconfigured production deployment.
- **Fix**: Require env vars explicitly or log a startup warning and validate in production config.

### H8. TOCTOU Race in `assertOrgCapacity` -- Advisory Lock Released Before INSERT

- **File**: `apps/api/src/jobs/jobGuards.ts:89-118`
- **Category**: Concurrency
- **Violation**: The advisory lock is released when the transaction commits, but the caller's INSERT happens *after* the function returns. Two concurrent requests can both pass the capacity check.
- **Fix**: Accept a transaction handle so the caller's INSERT runs inside the locked transaction.

### H9. `hashtext()` Int4 Collisions Cause Cross-Org Lock Contention

- **File**: `apps/api/src/jobs/jobGuards.ts:96`
- **Category**: Performance / Concurrency
- **Violation**: `hashtext()` returns int4 (~4.3B values). Hash collisions between different orgIds cause cross-org lock contention.
- **Fix**: Use `pg_advisory_xact_lock(key1, key2)` with two int4 values for 64-bit key space.

### H10. No Bounds on `maxRetries` / `retryDelayMs` -- Infinite Loops Possible

- **File**: `packages/config/jobs.ts:18,21`
- **Category**: Configuration Safety
- **Violation**: `maxRetries` and `retryDelayMs` accept arbitrary integers from env vars. `maxRetries=999999999` causes infinite retry loops; `retryDelayMs=0` causes CPU spin.
- **Fix**: Add `{ min: 0, max: 20 }` and `{ min: 100, max: 60000 }` bounds respectively.

### H11. Auth Gate on `jobs.tsx` Uses Unvalidated HTTP Success

- **File**: `apps/web/pages/system/jobs.tsx:26`
- **Category**: Authorization
- **Violation**: The auth check calls `admin/cache/stats` and uses HTTP success/failure as the sole authorization signal. A CDN/proxy returning 200 for all requests would grant unauthorized access.
- **Fix**: Validate the response body against an expected schema.

### H12. `reloadKeys()` Exception in `getCurrentKeys()` Crashes All Auth

- **File**: `packages/security/jwt.ts:274`
- **Category**: Resilience
- **Violation**: `reloadKeys()` is called synchronously inside `getCurrentKeys()`. If `getKeys()` throws (misconfigured env var during rotation), every auth request fails for 60 seconds.
- **Fix**: Wrap `reloadKeys()` in try-catch, keep existing keys, log error, prevent retry storm.

### H13. `getKeys()` Allows Zero Keys in Verification Module

- **File**: `packages/security/jwt.ts:221`
- **Category**: Resilience
- **Violation**: Unlike the signing module which requires both keys, the verification module returns `[]` if both keys are empty. This creates a 60-second auth outage window during key rotation.
- **Fix**: Require at least one key at init time.

### H14. `KEYS[0]!` Non-Null Assertion -- Runtime Crash if Empty

- **File**: `control-plane/services/jwt.ts:369`
- **Category**: Security
- **Violation**: `KEYS[0]!` uses non-null assertion. If `KEYS` is empty, `jwt.sign(payload, undefined)` signs with `"undefined"` string as secret, producing trivially forgeable tokens.
- **Fix**: Declare `KEYS` as `readonly [string, string]` tuple type.

### H15. Unsafe `as UserRole` Cast in `refreshToken()`

- **File**: `control-plane/services/jwt.ts:635`
- **Category**: Type / Security
- **Violation**: `(verified['role'] || 'viewer') as UserRole` -- casts without validation. A token with `role: ""` is silently upgraded to `viewer`. A token with an unknown role bypasses Zod validation at this point.
- **Fix**: Validate with `UserRoleSchema.parse()` before accepting.

### H16. `getTokenInfo()` Returns Unverified Data in Authoritative-Looking Type

- **File**: `control-plane/services/jwt.ts:569`
- **Category**: Security
- **Violation**: Uses `jwt.decode()` (no signature verification) but returns `TokenInfo` with `role: UserRole` that looks authoritative. One misuse by a future developer = full auth bypass.
- **Fix**: Remove the function or rename to `unsafeDecodeTokenInfo` with prominent warning.

### H17. `AuthContext.roles` Typed as `string[]` Across 3+ Files
**Verified by: 2 agents**

- **Files**: `packages/security/jwt.ts:64`, `packages/security/auth.ts:352`, `packages/types/auth.ts:17`
- **Category**: Type
- **Violation**: `roles: string[]` allows any string as a role. No compile-time enforcement.
- **Fix**: Change to `roles: UserRole[]` in all definitions.

### H18. UserRoleSchema Defined in THREE Places -- Drift History

- **Files**: `packages/security/jwt.ts:38`, `control-plane/services/jwt.ts:52`, `packages/security/auth.ts:363`
- **Category**: Architecture
- **Violation**: Three independent copies of the same Zod enum. Historical P0-FIX comments document prior drift incidents.
- **Fix**: Single source of truth in `packages/security/jwt.ts`, import everywhere else.

### H19. `JwtClaims` Shape Mismatch -- Required vs Optional Fields

- **Files**: `packages/security/jwt.ts:40-52` vs `control-plane/services/jwt.ts:28-39`
- **Category**: Architecture / Security
- **Violation**: Verification schema has `jti/iat/exp` optional; signing interface has them required. The `as JwtClaims` cast at `control-plane/services/jwt.ts:516` masks this. If `jti` is absent, the revocation check at line 519 is silently skipped.
- **Fix**: Create shared type definitions. Remove the unsafe cast.

### H20. No Coverage Threshold for `packages/security/` (JWT Code)

- **File**: `jest.config.ts:140`
- **Category**: Test Quality
- **Violation**: Security-critical JWT code has no specific coverage threshold. Falls under 70% branches global minimum, far below the 90% applied to billing code.
- **Fix**: Add 90% threshold for `./packages/security/**/*.ts`.

### H21. No Test for Algorithm Confusion / PEM Key Rejection

- **File**: `packages/security/__tests__/jwt.test.ts` (missing)
- **Category**: Test Quality
- **Violation**: Production code has `rejectDisallowedAlgorithm()` and `isPemKey()` defenses but zero regression tests for RS256/ES256/PS256 attacks or PEM-formatted key rejection.
- **Fix**: Add explicit tests for each rejected algorithm and PEM format.

### H22. Unbounded Memory Per Entry in `pendingJobs` Map

- **File**: `packages/monitoring/jobOptimizer.ts:69`
- **Category**: Memory / DoS
- **Violation**: Map bounded to 10K entries but each stores `data: unknown` with no size limit. 10K entries x 1MB = 10GB potential memory usage.
- **Fix**: Add per-entry size limit (e.g., 64KB).

### H23. Fire-and-Forget Promises in `scheduleCoalesced` -- No Retry, Lost on Crash

- **File**: `packages/monitoring/jobOptimizer.ts:247`
- **Category**: Async / Reliability
- **Violation**: `setTimeout` callbacks create promises that are never awaited. Failed coalesced jobs stay in `pendingJobs` forever (no retry). Process crash loses all pending jobs.
- **Fix**: Track in-flight promises, add retry mechanism, persist critical jobs.

### H24. `flush()`/`destroy()` Cannot Cancel In-Flight Promises

- **File**: `packages/monitoring/jobOptimizer.ts:488`
- **Category**: Reliability
- **Violation**: `clearTimeout` only prevents unfired timers. Already-executing `schedule()` promises continue after `destroy()`, potentially interacting with a torn-down system.
- **Fix**: Track in-flight promises in a Set, `await Promise.allSettled()` during destroy.

### H25. Quadratic Performance in `truncateJSONB`

- **File**: `packages/kernel/validation/jsonb.ts:149`
- **Category**: Performance / DoS
- **Violation**: For every non-string field, `JSON.stringify({ [key]: value })` is called inside a loop. An object with 1000 nested-object keys causes O(N * avg_value_size) serialization work.
- **Fix**: Serialize entire object once and subtract string contributions, or limit processed keys.

---

## P2 -- Medium (28 findings)

| # | File:Line | Category | Issue |
|---|-----------|----------|-------|
| M1 | `security/jwt.ts:62-63` | Type | `userId`/`orgId` are plain `string`, should be branded `UserId`/`OrgId` |
| M2 | `security/jwt.ts:40` | Security | `JwtClaimsSchema` not `.strict()` -- extra claims pass silently |
| M3 | `security/jwt.ts:93` | Security | `TokenExpiredError` leaks exact expiry timestamp |
| M4 | `security/jwt.ts:200` | Security | `rejectDisallowedAlgorithm` error leaks detected algorithm name |
| M5 | `security/jwt.ts:143` | Security | `constantTimeCompare` short-circuit in `&&` leaks length |
| M6 | `security/jwt.ts:266-267` | Architecture | Module-level `let` mutable state, untestable |
| M7 | `security/jwt.ts:349` | Security | "Constant-time" loop comment is misleading; not actually constant-time |
| M8 | `security/jwt.ts:40` | Security | No `nbf` (Not Before) claim support |
| M9 | `cp/jwt.ts:516` | Type | `as JwtClaims` unsafe cast masks optional/required mismatch |
| M10 | `cp/jwt.ts:541,570` | Type | `getTokenExpiration`/`getTokenInfo` use `jwt.decode()` with `as` casts |
| M11 | `cp/jwt.ts:624-632` | Security | `refreshToken()` timing side-channel reveals which key signed token |
| M12 | `cp/jwt.ts:637` | Type | `aud` cast ignores possible array type (JWT spec allows string[]) |
| M13 | `cp/jwt.ts:183` | Error | `parseMs()` returns silent 1-hour default on invalid input |
| M14 | `cp/jwt.ts:295-313` | Async | Redis lazy-init race: two concurrent calls create two connections |
| M15 | `cp/jwt.ts:625-631` | Error | `refreshToken()` catch blocks swallow original error details |
| M16 | `cp/jwt.ts:439,466` | Redis | Key injection: tokenId/userId with colons collide with namespace |
| M17 | `jobGuards.ts:101` | Data | `entity_id` semantically overloaded as org_id |
| M18 | `jobGuards.ts:42` | Type | Database interface uses `Record<string, unknown>` -- no column validation |
| M19 | `jobGuards.ts:113` | Semantic | `RateLimitError(msg, 0)` -- retryAfter:0 violates `.positive()` schema, causes retry storms |
| M20 | `jobGuards.ts:150` | Concurrency | `getOrgActiveJobCount` reads without advisory lock |
| M21 | `jobs.tsx:8` | AuthZ | No client-side route protection for admin page |
| M22 | `jobs.tsx:26` | Architecture | Auth piggybacking on unrelated `cache/stats` endpoint |
| M23 | `jobs.tsx:11-15` | Architecture | Hardcoded static job data -- no live data, no loading/error states |
| M24 | `jobs.ts:21,24` | Config | No validation that `retryDelayMs < maxRetryDelayMs` |
| M25 | `jobs.ts:27-36` | Config | No bounds on timeout values -- 0 causes instant job failure |
| M26 | `jobs.ts:88-93` | Type | IIFE returns `string` not union type -- type erasure |
| M27 | `jobOptimizer.ts:248` | Correctness | Coalesced jobs lose priority/delay options |
| M28 | `jobOptimizer.ts:403` | Performance | `markCompleted` iterates entire cache on every call (O(n)) |

---

## P3 -- Low (12 findings)

| # | File:Line | Category | Issue |
|---|-----------|----------|-------|
| L1 | `security/jwt.ts:1` | Architecture | File exceeds 300-line guideline (519 lines) |
| L2 | `security/jwt.ts:375` | Type | Redundant `new Date()` wrapping |
| L3 | `security/jwt.ts:511` | Type | Unsafe `as Record<string, unknown>` cast in `logAuthEvent` |
| L4 | `cp/jwt.ts:367` | Type | Redundant double-cast `as Omit<> ... as object` |
| L5 | `cp/jwt.ts:1-670` | Architecture | File is 670 lines -- SRP violation |
| L6 | `jobGuards.ts:21` | Config | Hardcoded capacity limit (no env var, no per-org override) |
| L7 | `jobGuards.ts:16` | Info Disclosure | Zod error interpolated into exception |
| L8 | `jsonb.ts:136` | Data | Returns mutable reference for under-size data |
| L9 | `jsonb.ts:69` | Type | Non-null assertion on potentially undefined `error` |
| L10 | `jobOptimizer.ts:275` | Type | Dead array branch in `mergeData` masks upstream errors |
| L11 | `test/factories/job.ts:48` | Data | `priority \|\| 50` coerces `priority: 0` to 50 |
| L12 | Various test files | Test | Missing afterEach env cleanup, pervasive `any` usage, flaky timing tests |

---

## Immediate Production Incident Risk Ranking

If deployed today, these findings would cause incidents in this order:

| Rank | Finding | Trigger | Impact | Time to Incident |
|------|---------|---------|--------|-----------------|
| 1 | **C1** (refreshToken revocation bypass) | Any revoked user hits refresh endpoint | Revoked users regain access | Immediate on first revocation |
| 2 | **H3** (key rotation stale keys) | Key rotation event | All new tokens rejected, auth outage | Next key rotation |
| 3 | **H2** (buyer role missing from hierarchy) | First buyer-role user logs in | 500 errors or total access denial | First buyer signup |
| 4 | **H4** (Redis pipeline fail-open) | Partial Redis failure | Revoked tokens silently accepted | Next Redis blip |
| 5 | **H1** (boundOrgId not enforced on API) | Token theft + API access | Cross-tenant data access | Requires active attacker |
| 6 | **H8** (TOCTOU in assertOrgCapacity) | Concurrent job submissions | Org capacity limit exceeded | Sustained load |
| 7 | **H5** (no token size limit) | Attacker sends large tokens | API memory exhaustion / DoS | Active attack |
| 8 | **H10** (no maxRetries bounds) | Env var misconfiguration | Infinite retry loops, CPU exhaustion | Misconfiguration event |
| 9 | **C3** (toJSON() code execution) | Crafted payload with toJSON | Arbitrary code in API process | Requires prototype pollution vector |
| 10 | **H6** (Zod error schema leak) | Malformed JWT sent to any endpoint | Attacker learns role enum, schema | Reconnaissance phase |

---

## Cross-File Systemic Issues

### 1. Triple-Definition Anti-Pattern
`UserRole`, `JwtClaims`, `AuthContext`, and `roleHierarchy` are each defined in 3-6 files with no shared source of truth. Historical git comments document at least 4 prior incidents caused by drift.

### 2. Sync/Async `verifyToken` Naming Collision
`packages/security/jwt.ts` exports synchronous `verifyToken`. `control-plane/services/jwt.ts` exports async `verifyToken`. Importing the wrong one gives a `Promise` object where `JwtClaims` is expected -- which is truthy and passes auth checks.

### 3. Test Coverage Gaps in Security Code
Security defenses (PEM rejection, algorithm whitelisting, constant-time comparison edge cases) have zero regression test coverage. Any refactoring could silently remove them.

### 4. Configuration Drift Between Signing and Verification
The signing module requires both keys and crashes at import time. The verification module accepts zero keys and fails at request time. Key rotation strategies that work for one may break the other.

---

## Recommended Fix Priority

**Week 1 (Critical)**:
1. Fix C1: Make `refreshToken` async with revocation check
2. Fix H3: Add key reload to control-plane signing module
3. Fix H2: Add `buyer` to all `roleHierarchy` definitions
4. Fix H4: Validate Redis pipeline results, fail-closed

**Week 2 (High)**:
5. Fix H1: Enforce `boundOrgId` in `getAuthContext()`
6. Fix H5: Add token size limit
7. Fix H6: Sanitize error messages
8. Fix H8: Restructure `assertOrgCapacity` to hold lock through INSERT
9. Consolidate UserRole/JwtClaims/AuthContext to single source of truth

**Week 3 (Medium)**:
10. Add `.strict()` to JwtClaimsSchema
11. Add bounds to all job config values
12. Add 90% coverage threshold for `packages/security/`
13. Add algorithm confusion and PEM rejection tests
14. Fix `isRevoked` type-lie (C2)

---

*Report generated by 6 parallel audit agents with cross-verification. Findings confirmed by multiple agents are marked accordingly.*
