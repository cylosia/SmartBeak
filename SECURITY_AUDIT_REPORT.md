# SmartBeak Security Audit Report

**Date:** 2026-02-12
**Scope:** Full codebase hostile-code-review (875 TypeScript files, 50+ SQL migrations)
**Stack:** TypeScript 5.4.5, Fastify 4.27, PostgreSQL (pg 8.11.5 + Knex 3.0), BullMQ, Redis, Next.js 14, Clerk, Stripe/Paddle
**Methodology:** Systematic file-by-file decomposition with adversarial re-review, verified by parallel subagent cross-examination

---

## Executive Summary

This audit uncovered **4 P0-Critical**, **13 P1-High**, **12 P2-Medium**, and **6 P3-Low** findings across security, database, architecture, and operational dimensions. The most severe finding is a **complete authentication bypass** where the Fastify API server's JWT verification delegates to an unimplemented stub function, causing all authenticated requests to fail. Three additional P0 findings involve broken SSRF validation that rejects all valid URLs and a JWT key source divergence creating inconsistent authentication across modules.

**Immediate production risk:** If the kernel auth stub is the active code path, the entire Fastify API is non-functional for authenticated users.

---

## P0 - CRITICAL (Production Outage / Security Breach Imminent)

### Finding 1: JWT Verification Delegates to Unimplemented Stub

**Severity:** P0-CRITICAL
**Category:** Security
**File:** `/home/user/SmartBeak/packages/kernel/auth.ts`
**Line:** 105:1
**Tag:** AUTH_BYPASS

**Violation:** The `verifyToken` function in `@kernel/auth` is a stub that always throws `TokenInvalidError('Token verification not implemented in kernel package')`. The Fastify API server's auth chain routes through this stub:

1. `http.ts:249` calls `authFromHeader(authHeader)` from `control-plane/services/auth.ts`
2. `control-plane/services/auth.ts:146` calls `verifyToken(token)` from `./jwt`
3. `control-plane/services/jwt.ts:444` dynamically imports `@kernel/auth` and calls `verifyTokenSync(token, options)`
4. `packages/kernel/auth.ts:108` **always throws**

**Evidence:**
```typescript
// packages/kernel/auth.ts:105-109
export function verifyToken(token: string, options: VerifyTokenOptions = {}): unknown {
  // This is a placeholder - actual implementation would verify JWT signature
  // and return decoded claims
  throw new TokenInvalidError('Token verification not implemented in kernel package. Use packages/security/auth.ts');
}
```

```typescript
// control-plane/services/jwt.ts:438-446
export async function verifyToken(token, aud, iss): Promise<JwtClaims> {
  const { verifyToken: verifyTokenSync } = await import('@kernel/auth');
  return verifyTokenSync(token, { audience: aud, issuer: iss }) as Promise<JwtClaims>;
}
```

**Fix:** Replace the dynamic import in `control-plane/services/jwt.ts:444` to import from `@security/jwt` instead of `@kernel/auth`:
```typescript
const { verifyToken: verifyTokenSync } = await import('@security/jwt');
```
Or implement the actual verification logic in `packages/kernel/auth.ts`.

**Risk if not fixed:** Every authenticated request to the Fastify API returns 401 Unauthorized. The entire API is non-functional for logged-in users.

**Blast radius:** ALL authenticated API endpoints (45+ route modules), ALL users. Complete service outage for the API layer.

---

### Finding 2: JWT Key Source Divergence Across Auth Modules

**Severity:** P0-CRITICAL
**Category:** Security
**File:** `/home/user/SmartBeak/packages/security/auth.ts`
**Line:** 384:5
**Tag:** AUTH_INCONSISTENCY

**Violation:** Three different auth modules use three different JWT key environment variables:

| Module | File | Line | Key Env Var | Audience | Issuer |
|--------|------|------|-------------|----------|--------|
| `@security/auth` | `packages/security/auth.ts` | 384 | `JWT_SECRET` | **None** | **None** |
| `@security/jwt` | `packages/security/jwt.ts` | 163-164 | `JWT_KEY_1` + `JWT_KEY_2` | `JWT_AUDIENCE` | `JWT_ISSUER` |
| `apps/web/lib/auth.ts` | `apps/web/lib/auth.ts` | 291 | `JWT_KEY_1` | `JWT_AUDIENCE` | `JWT_ISSUER` |

If `JWT_SECRET` != `JWT_KEY_1`, tokens signed by one module will not verify in another.

**Evidence:**
```typescript
// packages/security/auth.ts:384 - Uses JWT_SECRET
const secret = process.env['JWT_SECRET'];

// packages/security/jwt.ts:163 - Uses JWT_KEY_1/JWT_KEY_2
const key1 = process.env['JWT_KEY_1'];
const key2 = process.env['JWT_KEY_2'];

// apps/web/lib/auth.ts:291 - Uses JWT_KEY_1
const jwtKey = process.env['JWT_KEY_1'];
```

**Fix:** Consolidate all JWT verification to use `@security/jwt.verifyToken()` which uses `JWT_KEY_1`/`JWT_KEY_2` with proper audience/issuer validation. Remove the independent `verifyToken` from `packages/security/auth.ts`.

**Risk if not fixed:** Tokens signed with `JWT_KEY_1` fail verification in routes using `JWT_SECRET`, and vice versa. Users experience intermittent auth failures depending on which module processes their request.

**Blast radius:** All API routes using `@security/auth` (5 route files: exports, domainSaleReadiness, buyerSeoReport, contentRoi, buyerRoi), plus any future code importing from the wrong auth module.

---

### Finding 3: Missing Audience/Issuer Validation in `@security/auth`

**Severity:** P0-CRITICAL
**Category:** Security
**File:** `/home/user/SmartBeak/packages/security/auth.ts`
**Line:** 393:5
**Tag:** AUTHZ_BYPASS

**Violation:** `packages/security/auth.ts:verifyToken` calls `jwt.verify(token, secret, { algorithms: ['HS256'] })` with NO audience or issuer validation. If this HS256 key is shared with any other service (e.g., a staging environment, internal tool, or third-party integration), an attacker with a valid JWT from that service can authenticate to SmartBeak.

**Evidence:**
```typescript
// packages/security/auth.ts:393 - NO audience/issuer
return jwt.verify(token, secret, { algorithms: ['HS256'] }) as { ... };

// Compare: packages/security/jwt.ts:259-263 - HAS audience/issuer
const payload = jwt.verify(token, key, {
  audience: options.audience || DEFAULT_AUDIENCE,
  issuer: options.issuer || DEFAULT_ISSUER,
  algorithms: ['HS256'],
  clockTolerance: JWT_CLOCK_TOLERANCE,
});
```

**Fix:** Add audience and issuer validation to `packages/security/auth.ts:393`:
```typescript
return jwt.verify(token, secret, {
  algorithms: ['HS256'],
  audience: process.env['JWT_AUDIENCE'] || 'smartbeak',
  issuer: process.env['JWT_ISSUER'] || 'smartbeak-api',
  clockTolerance: 30,
}) as { ... };
```

**Risk if not fixed:** Cross-service token reuse attack. An attacker obtains a valid JWT from any service sharing the same HS256 key and uses it to authenticate as any user on SmartBeak.

**Blast radius:** All 5 route files importing from `@security/auth`, any user account can be impersonated.

---

### Finding 4: `extractSafeUrl` Rejects ALL Valid HTTP/HTTPS URLs

**Severity:** P0-CRITICAL
**Category:** Security
**File:** `/home/user/SmartBeak/packages/security/ssrf.ts`
**Line:** 360:5
**Tag:** FUNCTIONAL_BUG

**Violation:** The `extractSafeUrl` function includes `/\/\//g` (double-slash) as a "suspicious pattern." Every HTTP/HTTPS URL contains `://` which matches `//`. This causes the function to return `null` for ALL valid URLs, completely breaking URL validation for any caller.

**Evidence:**
```typescript
// ssrf.ts:355-366
const suspiciousPatterns = [
  /@/g,           // Credentials in URL
  /#.*@/g,       // Fragment with @
  /\\/g,         // Backslash
  /\.\./g,       // Path traversal
  /\/\//g,       // Double slash (protocol-relative) <-- MATCHES :// IN EVERY URL
];

for (const pattern of suspiciousPatterns) {
  if (pattern.test(cleaned)) {  // 'https://example.com' matches //
    return null;                 // ALL URLs rejected
  }
}
```

**Fix:** Remove or modify the double-slash pattern to only match protocol-relative URLs (those starting with `//`):
```typescript
/^\/\//g,  // Only match URLs starting with //
```
Or better, remove this pattern entirely since `validateUrl` already checks protocol.

**Risk if not fixed:** Any feature relying on `extractSafeUrl` for URL validation (webhook URLs, user-provided links) is completely non-functional. Currently exported from `packages/security/index.ts`.

**Blast radius:** Currently limited — `extractSafeUrl` is exported but not actively called in production routes (only tests). However, `validateUrl` (which `extractSafeUrl` calls) IS used by `WebPublishingAdapter`, `InstagramAdapter`, and `PinterestAdapter`, and has its own P1 port-blocking issue (Finding 5).

---

## P1 - HIGH (Likely Bugs Under Load / Security Vulnerabilities)

### Finding 5: SSRF Validation Blocks Standard HTTPS Port 443

**Severity:** P1-HIGH
**Category:** Security
**File:** `/home/user/SmartBeak/packages/security/ssrf.ts`
**Line:** 98:3 and 113:3
**Tag:** FUNCTIONAL_BUG

**Violation:** `BLOCKED_PORTS` includes port 80 (line 98) and port 443 (line 113). When `validateUrl` resolves a default port for an HTTPS URL without an explicit port, `parseInt(url.port, 10)` returns `NaN`, falling back to `443`. Then `isAllowedPort(443)` returns `false`, blocking the URL.

**Evidence:**
```typescript
// ssrf.ts:98,113
80, // HTTP (redirect to HTTPS instead)
443, // HTTPS (use explicit 443 if needed)

// ssrf.ts:312 - Default port resolution
const port = parseInt(url.port, 10) || (url.protocol === 'https:' ? 443 : 80);

// ssrf.ts:315 - Port check fails for 443
if (!isAllowedPort(port)) {  // isAllowedPort(443) → false
  return { allowed: false, reason: `Port not allowed: ${port}` };
}
```

**Callers affected:**
- `WebPublishingAdapter.ts:129,162` — Publishing to HTTPS URLs rejected
- `InstagramAdapter.ts:90` — Instagram image URL validation fails
- `PinterestAdapter.ts:93-94` — Pinterest link/image validation fails

**Fix:** Remove ports 80 and 443 from `BLOCKED_PORTS`:
```typescript
// Remove lines 98 and 113 from BLOCKED_PORTS array
```

**Risk if not fixed:** All publishing to standard HTTPS URLs fails. Content cannot be published to any website using standard HTTPS (port 443).

**Blast radius:** All publishing operations, all social media integrations using SSRF-validated URLs.

---

### Finding 6: `SET LOCAL statement_timeout` Before `BEGIN` Has No Effect

**Severity:** P1-HIGH
**Category:** SQL
**File:** `/home/user/SmartBeak/packages/database/transactions/index.ts`
**Line:** 77:5
**Tag:** TRANSACTION_BUG

**Violation:** `SET LOCAL statement_timeout = $1` is executed BEFORE `BEGIN ISOLATION LEVEL ...` on line 82. Per PostgreSQL documentation: "If SET LOCAL is used outside a transaction block, it issues a warning and otherwise has no effect." The `Promise.race` timeout on line 98 provides JavaScript-level protection but does NOT cancel the running PostgreSQL query.

**Evidence:**
```typescript
// transactions/index.ts:76-82
try {
  await client.query('SET LOCAL statement_timeout = $1', [timeoutMs]); // BEFORE BEGIN - no effect!
  const validatedIsolation = isolationLevel ? validateIsolationLevel(isolationLevel) : DEFAULT_ISOLATION_LEVEL;
  await client.query(`BEGIN ISOLATION LEVEL ${validatedIsolation}`);
```

**Fix:** Move `SET LOCAL` inside the transaction, after `BEGIN`:
```typescript
await client.query(`BEGIN ISOLATION LEVEL ${validatedIsolation}`);
await client.query('SET LOCAL statement_timeout = $1', [timeoutMs]); // Now inside transaction
```

**Risk if not fixed:** Long-running queries inside transactions have no PostgreSQL-level timeout. A complex query could hold locks indefinitely, blocking other transactions and causing connection pool exhaustion.

**Blast radius:** All code using `withTransaction()` — every transactional operation in the entire application.

---

### Finding 7: `releaseAllAdvisoryLocks` Uses Wrong Connection

**Severity:** P1-HIGH
**Category:** SQL
**File:** `/home/user/SmartBeak/packages/database/pool/index.ts`
**Line:** 87:1
**Tag:** RESOURCE_LEAK

**Violation:** `releaseAllAdvisoryLocks` acquires a NEW client from the pool to release advisory locks. However, advisory locks in PostgreSQL are session-scoped — they can only be released from the connection that acquired them. Using a different connection will silently fail (the `pg_advisory_unlock` call succeeds but returns `false`, not an error).

**Evidence:**
```typescript
// pool/index.ts (releaseAllAdvisoryLocks)
const pool = await getPool();
const client = await pool.connect(); // NEW client - NOT the one holding locks
try {
  for (const lockId of activeAdvisoryLocks) {
    await client.query('SELECT pg_advisory_unlock(hashtext($1))', [lockId]); // Silent no-op
  }
}
```

**Fix:** Track which connection acquired each lock, or use `pg_advisory_unlock_all()` on each connection before releasing it back to the pool. Alternatively, use session-level advisory locks that auto-release on disconnect.

**Risk if not fixed:** Advisory locks leak on process crash or abnormal shutdown. Accumulated leaked locks could block other processes trying to acquire the same locks.

**Blast radius:** All code paths using advisory locks (distributed lock coordination, migration runners).

---

### Finding 8: Audit `verifyIntegrity` Loads Entire Table Into Memory

**Severity:** P1-HIGH
**Category:** Performance
**File:** `/home/user/SmartBeak/packages/security/audit.ts`
**Line:** 463:3
**Tag:** MEMORY_EXHAUSTION

**Violation:** `verifyIntegrity()` executes `SELECT * FROM audit_logs ORDER BY timestamp` with no `LIMIT`. In a production system with millions of audit events, this will exhaust process memory and crash the Node.js server.

**Evidence:**
```typescript
// audit.ts:463-471
let query = 'SELECT * FROM audit_logs ORDER BY timestamp';
const params: any[] = [];

if (since) {
  query = 'SELECT * FROM audit_logs WHERE timestamp >= $1 ORDER BY timestamp';
  params.push(since);
}

const { rows } = await this.db.query(query, params); // Loads ALL rows into memory
```

**Fix:** Use cursor-based pagination with a batch size:
```typescript
const BATCH_SIZE = 1000;
let offset = 0;
while (true) {
  const { rows } = await this.db.query(
    `${query} LIMIT ${BATCH_SIZE} OFFSET $${params.length + 1}`,
    [...params, offset]
  );
  if (rows.length === 0) break;
  // Process batch...
  offset += BATCH_SIZE;
}
```

**Risk if not fixed:** Calling `verifyIntegrity()` on a production system with >100K audit events will OOM the process, crashing the server.

**Blast radius:** The audit integrity check endpoint and any automated audit verification jobs.

---

### Finding 9: IP Spoofing in Rate Limit Identifier

**Severity:** P1-HIGH
**Category:** Security
**File:** `/home/user/SmartBeak/apps/web/lib/auth.ts`
**Line:** 682:5
**Tag:** RATE_LIMIT_BYPASS

**Violation:** `getRateLimitIdentifier` uses `ips[ips.length - 1]` (last IP from `x-forwarded-for`) for rate limiting, while `getClientInfo` at line 113 uses `ips[0]` (first IP). The last IP in `x-forwarded-for` is typically a proxy IP shared by many clients. Multiple attackers behind different IPs converge to the same rate limit bucket (the proxy IP), enabling brute-force amplification where one attacker exhausts the rate limit for ALL users behind that proxy.

**Evidence:**
```typescript
// apps/web/lib/auth.ts:682 - Uses LAST IP (proxy)
const ips = forwarded.split(',').map(s => s.trim()).filter(Boolean);
ip = (ips.length > 0 ? ips[ips.length - 1] : ...) as string;

// apps/web/lib/auth.ts:113 - Uses FIRST IP (client)
const ips = forwarded.split(',').map(ip => ip.trim()).filter(Boolean);
const clientIp = ips[0] || req.socket?.remoteAddress || 'unknown';
```

**Fix:** Use `ips[0]` (first/client IP) consistently in `getRateLimitIdentifier`:
```typescript
ip = (ips.length > 0 ? ips[0] : req.socket?.remoteAddress || 'unknown') as string;
```

**Risk if not fixed:** Attacker can exhaust rate limits for all users behind a shared proxy (corporate networks, CDNs). Alternatively, attacker can bypass rate limiting by varying the `x-forwarded-for` header.

**Blast radius:** All Next.js API rate-limited endpoints.

---

### Finding 10: Health Check Endpoints Not Rate Limited

**Severity:** P1-HIGH
**Category:** Performance
**File:** `/home/user/SmartBeak/control-plane/api/http.ts`
**Line:** 392:1
**Tag:** DOS_VECTOR

**Violation:** The `/health` endpoint (line 392) performs three database queries (lines 458, 497-514) plus a Redis PING and INFO command (lines 481-484), but is marked as a public route (line 234: `req.url?.startsWith('/health')`) with no rate limiting. An attacker can flood this endpoint to exhaust database connections and Redis capacity.

**Evidence:**
```typescript
// http.ts:234 - Health endpoints are public (no auth required)
req.url?.startsWith('/health')

// http.ts:458 - DB query in health check
await client.query('SELECT 1');

// http.ts:497-514 - Three more DB queries
const stalledResult = await pool.query(`SELECT COUNT(*) FROM publishing_jobs WHERE ...`);
const failedResult = await pool.query(`SELECT COUNT(*) FROM publishing_jobs WHERE ...`);
const pendingResult = await pool.query(`SELECT COUNT(*) FROM publishing_jobs WHERE ...`);
```

**Fix:** Add rate limiting to health check endpoints:
```typescript
app.get('/health', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
```

**Risk if not fixed:** DoS attack via rapid health check requests exhausts the database connection pool, causing cascading failure for all API endpoints.

**Blast radius:** All API endpoints (connection pool exhaustion affects everything).

---

### Finding 11: Webhook Routes Auto-Public Without Signature Verification

**Severity:** P1-HIGH
**Category:** Security
**File:** `/home/user/SmartBeak/control-plane/api/http.ts`
**Line:** 235:1
**Tag:** AUTHZ_BYPASS

**Violation:** All URLs matching `/webhooks/*` are automatically marked as public routes (line 235), bypassing authentication entirely. This is correct for webhook endpoints, but only if each webhook handler individually verifies the webhook signature (Stripe `whsec_*`, Clerk webhook secret, etc.). Any webhook endpoint without signature verification is exposed to unauthenticated abuse.

**Evidence:**
```typescript
// http.ts:235 - All webhooks are public
req.url?.startsWith('/webhooks/')
```

**Fix:** Audit every webhook handler registered under `/webhooks/` to verify it validates the provider's webhook signature. Add a middleware layer that requires all webhook routes to declare their signature verification method.

**Risk if not fixed:** Attacker sends forged webhook payloads to trigger billing events, account changes, or data mutations without valid provider signatures.

**Blast radius:** All webhook endpoints — Stripe payment processing, Clerk auth events, Paddle billing.

---

### Finding 12: Dual Pool Connection Exhaustion Risk

**Severity:** P1-HIGH
**Category:** SQL
**File:** `/home/user/SmartBeak/packages/database/pool/index.ts`, `/home/user/SmartBeak/packages/database/knex/index.ts`, `/home/user/SmartBeak/apps/api/src/db.ts`
**Line:** Multiple
**Tag:** CONNECTION_EXHAUSTION

**Violation:** Three independent connection pools connect to the same PostgreSQL database:

| Pool | Max Connections | File |
|------|----------------|------|
| Raw `pg.Pool` | 10 | `packages/database/pool/index.ts` |
| `packages/database/knex` | 10 | `packages/database/knex/index.ts:44` |
| `apps/api/src/db.ts` Knex | 20 (non-serverless) | `apps/api/src/db.ts:43` |

Total: up to **40 connections** from a single process. With multiple instances (Vercel functions, Docker replicas), this can easily exceed PostgreSQL's `max_connections` (default 100).

**Fix:** Consolidate to a single connection pool. Use `getPoolInstance()` from `@database/pool` everywhere. Remove the separate Knex pools or configure them to use the shared pool.

**Risk if not fixed:** Connection pool exhaustion causes "too many clients" errors, bringing down all database operations.

**Blast radius:** All database-dependent functionality — the entire application.

---

### Finding 13: Knex Pool Missing `statement_timeout`

**Severity:** P1-HIGH
**Category:** SQL
**File:** `/home/user/SmartBeak/packages/database/knex/index.ts`
**Line:** 38:5
**Tag:** RUNAWAY_QUERY

**Violation:** The Knex pool configuration does not set `statement_timeout` or `idle_in_transaction_session_timeout`. Unlike the raw Pool which has timeout configuration, queries through Knex can run indefinitely.

**Evidence:**
```typescript
// knex/index.ts:38-52 - No statement_timeout
knexInstance = knex({
  client: 'pg',
  connection: connectionString,
  pool: {
    min: 2,
    max: 10,
    idleTimeoutMillis: 30000,
    acquireTimeoutMillis: 30000,
    // NO statement_timeout
    // NO idle_in_transaction_session_timeout
  },
});
```

**Fix:** Add `afterCreate` pool hook to set statement timeout:
```typescript
pool: {
  min: 2, max: 10,
  afterCreate: (conn, done) => {
    conn.query('SET statement_timeout = 30000; SET idle_in_transaction_session_timeout = 60000;', done);
  },
},
```

**Risk if not fixed:** A single slow query through Knex can hold a connection indefinitely, eventually exhausting the pool.

**Blast radius:** All queries routed through Knex (both `packages/database/knex` and `apps/api/src/db.ts`).

---

### Finding 14: `apps/api/src/db.ts` Statement Timeout Only in Serverless

**Severity:** P1-HIGH
**Category:** SQL
**File:** `/home/user/SmartBeak/apps/api/src/db.ts`
**Line:** 53:3
**Tag:** RUNAWAY_QUERY

**Violation:** `statement_timeout` is only configured in serverless mode (`isServerless`). In non-serverless deployments, queries have no timeout.

**Evidence:**
```typescript
// apps/api/src/db.ts:52-55
...(isServerless && {
  statement_timeout: 3000,  // Only set in serverless
}),
```

**Fix:** Always set `statement_timeout`:
```typescript
statement_timeout: isServerless ? 3000 : 30000,
```

**Risk if not fixed:** Runaway queries in non-serverless deployments hold connections indefinitely.

**Blast radius:** All `apps/api` database operations in non-serverless environments.

---

### Finding 15: Token Revocation Check Fails Open When Redis Is Down

**Severity:** P1-HIGH
**Category:** Security
**File:** `/home/user/SmartBeak/control-plane/services/jwt.ts`
**Line:** 370:3
**Tag:** SECURITY_BYPASS

**Violation:** When the Redis circuit breaker is open (Redis unavailable), `isTokenRevoked()` returns `false` (line 372), meaning revoked tokens are accepted as valid. The circuit breaker opens after just 5 failures (line 158).

**Evidence:**
```typescript
// jwt.ts:370-373
if (isCircuitOpen()) {
  logger.warn('Circuit breaker open, allowing token (Redis unavailable)');
  return false; // Token NOT treated as revoked — revoked tokens bypass check
}
```

**Fix:** When circuit breaker is open, reject authentication entirely rather than silently accepting revoked tokens:
```typescript
if (isCircuitOpen()) {
  throw new AuthError('Authentication service temporarily unavailable', 'SERVICE_UNAVAILABLE');
}
```

**Risk if not fixed:** An attacker who gets their token revoked can wait for a Redis hiccup (5 failures) and then use the revoked token while the circuit breaker is open.

**Blast radius:** All token revocation events become bypassable during Redis outages.

---

### Finding 16: `control-plane/services/jwt.ts` Module-Level Redis Crash

**Severity:** P1-HIGH
**Category:** Architecture
**File:** `/home/user/SmartBeak/control-plane/services/jwt.ts`
**Line:** 248:1
**Tag:** STARTUP_CRASH

**Violation:** `REDIS_URL` is checked at module load time (line 248). If `REDIS_URL` is not set, the module throws immediately, crashing any import chain that includes this module — including the entire Fastify API server.

**Evidence:**
```typescript
// jwt.ts:248-254
const REDIS_URL = process.env['REDIS_URL'];
if (!REDIS_URL) {
  throw new Error('REDIS_URL environment variable is required'); // Module-level crash
}
const redis = new Redis(REDIS_URL, { ... });
```

**Fix:** Lazy-initialize Redis connection:
```typescript
let redis: Redis | null = null;
function getRedis(): Redis {
  if (!redis) {
    const url = process.env['REDIS_URL'];
    if (!url) throw new Error('REDIS_URL required');
    redis = new Redis(url, { ... });
  }
  return redis;
}
```

**Risk if not fixed:** Missing `REDIS_URL` in any environment (development, testing, CI) crashes the entire application on import.

**Blast radius:** Complete application startup failure.

---

### Finding 17: JWT Keys Loaded at Module Level with Silent Fallback

**Severity:** P1-HIGH
**Category:** Security
**File:** `/home/user/SmartBeak/control-plane/services/jwt.ts`
**Line:** 233:1
**Tag:** SECRET_LEAK

**Violation:** JWT keys are loaded at module initialization. If key loading fails, the code catches the error and sets `KEYS = ['', '']` (line 239). This means the application will attempt to sign tokens with empty-string keys, which would create trivially forgeable JWTs.

**Evidence:**
```typescript
// jwt.ts:233-241
const KEYS: string[] = (() => {
  try {
    return getKeys();
  } catch (error) {
    logger.error('Failed to load JWT keys', error);
    return ['', ''];  // Empty keys - tokens signed with '' are trivially forgeable
  }
})();

// jwt.ts:322 - Signs with empty key
return jwt.sign(payload, KEYS[0]!, { expiresIn: ... });
```

**Fix:** Fail hard on key loading failure — do not fall back to empty keys:
```typescript
const KEYS: string[] = getKeys(); // Throws on failure — prevents startup
```

**Risk if not fixed:** If JWT key loading fails (env var missing, placeholder detection), the application starts with empty signing keys. Any attacker can forge valid JWTs by signing with an empty string.

**Blast radius:** Complete authentication compromise — any attacker can impersonate any user.

---

## P2 - MEDIUM (Technical Debt / Performance Degradation)

### Finding 18: Bot Detection Threshold Mismatch

**Severity:** P2-MEDIUM
**Category:** Security
**File:** `/home/user/SmartBeak/apps/api/src/middleware/rateLimiter.ts`
**Line:** 871:7
**Tag:** CONFIG_ERROR

**Violation:** `botResult.confidence > 0.7` compares against 0.7, but `detectBot` returns confidence as an integer 0-100 (line 106: `Math.min(score, 100)`). Since `isBot = score >= 30`, when `isBot` is true confidence is always >= 30, which is always > 0.7. The check is redundant and overly aggressive.

**Fix:** Change to `botResult.confidence > 70`.

---

### Finding 19: Orphaned In-Memory Rate Limit Map

**Severity:** P2-MEDIUM
**Category:** Performance
**File:** `/home/user/SmartBeak/apps/api/src/middleware/rateLimiter.ts`
**Line:** 709:1
**Tag:** MEMORY_LEAK

**Violation:** `rateLimitStore = new Map()` (line 709) and its `checkRateLimit` function (line 718) appear unused after migration to distributed Redis. The Map is never cleaned up and allocated at module load.

**Fix:** Remove the orphaned `rateLimitStore` Map and `checkRateLimit` function.

---

### Finding 20: Three Separate `AuthContext` Type Definitions

**Severity:** P2-MEDIUM
**Category:** Type
**File:** Multiple
**Line:** `packages/security/auth.ts:339`, `packages/security/jwt.ts:52`, `apps/web/lib/auth.ts:9`
**Tag:** TYPE_DRIFT

**Violation:** Three independent `AuthContext` interfaces with different shapes:
- `auth.ts:339`: `sessionId?: string | undefined; requestId?: string | undefined;`
- `jwt.ts:52`: `sessionId?: string | undefined;` (no requestId)
- `web/auth.ts:9`: `sessionId?: string; requestId: string;` (requestId required)

**Fix:** Export a single `AuthContext` from `@security/jwt` and import everywhere.

---

### Finding 21: Pool Utilization Metric Calculated Incorrectly

**Severity:** P2-MEDIUM
**Category:** Performance
**File:** `/home/user/SmartBeak/packages/database/pool/index.ts`
**Line:** 208:5
**Tag:** OBSERVABILITY

**Violation:** Pool utilization is calculated as `activeConnections / totalConnections` instead of `activeConnections / maxPoolSize`. When the pool has 3 total (2 active, 1 idle), utilization = 66%. But max is 10, so real utilization is 20%.

**Fix:** Use `pool.options.max` as denominator.

---

### Finding 22: `console.error` Used in CSRF Middleware

**Severity:** P2-MEDIUM
**Category:** Observability
**File:** `/home/user/SmartBeak/apps/api/src/middleware/csrf.ts`
**Line:** 174
**Tag:** LOGGING

**Violation:** CSRF middleware uses `console.error` instead of structured logger. Errors bypass the PII sanitization and structured logging pipeline.

**Fix:** Replace with `logger.error(...)` from `@kernel/logger`.

---

### Finding 23: `console.log` at Server Startup

**Severity:** P2-MEDIUM
**Category:** Observability
**File:** `/home/user/SmartBeak/control-plane/api/http.ts`
**Line:** 54:3
**Tag:** LOGGING

**Violation:** `console.log('[startup] Environment variables validated successfully')` bypasses structured logging.

**Fix:** Replace with `logger.info(...)`.

---

### Finding 24: Audit Logger Uses `Record<string, any>` Parameters

**Severity:** P2-MEDIUM
**Category:** Type
**File:** `/home/user/SmartBeak/packages/security/audit.ts`
**Line:** 211:3, 229:3, 364:3
**Tag:** TYPE_UNSAFE

**Violation:** Multiple methods accept `Record<string, any>` parameters (`logAuth`, `logDataAccess`) and the `query` method uses `const params: any[] = []`, bypassing TypeScript's type system in a security-critical module.

**Fix:** Replace `any` with `unknown` and add proper type guards.

---

### Finding 25: SELECT * in Multiple Repository Queries

**Severity:** P2-MEDIUM
**Category:** Performance
**File:** Multiple (30 files, 69 occurrences)
**Tag:** OVER_FETCHING

**Violation:** 69 instances of `SELECT *` across 30 files, including repositories, services, and audit queries. This fetches all columns including potentially large JSONB fields and text blobs when only a few columns are needed.

**Notable locations:**
- `audit.ts:463` — `SELECT *` on audit_logs (includes full `details` JSONB)
- `PostgresMediaRepository.ts` — Fetches blob metadata with all columns
- `PostgresContentRepository.ts` — Content includes full body text

**Fix:** Specify only needed columns in each query. Prioritize high-traffic queries first.

---

### Finding 26: `tsconfig.base.json` Comment Contradicts `skipLibCheck`

**Severity:** P2-MEDIUM
**Category:** Architecture
**File:** `/home/user/SmartBeak/tsconfig.base.json`
**Line:** 35
**Tag:** CONFIG_ERROR

**Violation:** Comment says "Security: Don't skip lib check" but `skipLibCheck` is set to `true`. Library type errors are silently ignored, potentially masking type incompatibilities in dependencies.

**Fix:** Set `"skipLibCheck": false` or update the comment to reflect the actual setting.

---

### Finding 27: Dynamic SQL with Template Literals in Route Files

**Severity:** P2-MEDIUM
**Category:** Security
**File:** `/home/user/SmartBeak/control-plane/api/routes/timeline.ts`
**Line:** 125:5, 235:5
**Tag:** SQL_CONSTRUCTION

**Violation:** Timeline route constructs queries with `SELECT ${query}` where `query` is built by string concatenation. While the user inputs are properly parameterized with `$N` placeholders, the query construction pattern is fragile and error-prone. The `usage.ts` and `onboarding.ts` services also use `SET ${field}` interpolation, though they validate against whitelists.

**Note:** Currently safe due to whitelist validation, but the pattern is risky for future modifications.

**Fix:** Use a query builder (Knex) instead of manual string construction for complex dynamic queries.

---

### Finding 28: `in-memory` Rate Limit Fallback in `http.ts`

**Severity:** P2-MEDIUM
**Category:** Security
**File:** `/home/user/SmartBeak/control-plane/api/http.ts`
**Line:** 159:1
**Tag:** RATE_LIMIT_BYPASS

**Violation:** When Redis is unavailable, auth rate limiting falls back to an in-memory Map (line 159). In multi-instance deployments (Vercel, K8s), each instance maintains its own counter. An attacker can distribute brute-force attempts across instances, effectively multiplying the rate limit by the number of instances.

**Fix:** Document the multi-instance limitation. Consider failing closed (rejecting all auth attempts) when Redis is unavailable for auth rate limiting.

---

### Finding 29: `sanitizeUrl` in Theme Sanitizer Vulnerable to Encoding Bypass

**Severity:** P2-MEDIUM
**Category:** Security
**File:** `/home/user/SmartBeak/themes/sanitize.ts`
**Line:** 56:3
**Tag:** XSS

**Violation:** `sanitizeUrl` checks for dangerous protocols using `startsWith` on the lowercase URL. However, HTML entity encoding (`&#106;avascript:`) or Unicode escapes could bypass this check. The main `sanitizeHtml` function uses DOMPurify which handles this, but `sanitizeUrl` is exported separately and could be used without DOMPurify protection.

**Fix:** Decode HTML entities and normalize Unicode before checking protocols. Or enforce that `sanitizeUrl` is only called on URLs already processed by DOMPurify.

---

## P3 - LOW (Style / Perfectionist Ideals)

### Finding 30: 99 `as unknown as` Type Assertions

**Severity:** P3-LOW
**Category:** Type
**File:** 43 files
**Tag:** TYPE_UNSAFE

**Violation:** 99 occurrences of `as unknown as` across 43 files. Each bypasses TypeScript's type system. While some are necessary for framework interop (Fastify request typing), many could be replaced with proper type guards.

---

### Finding 31: `process.exit` in 15+ Non-Script Files

**Severity:** P3-LOW
**Category:** Architecture
**Tag:** UNGRACEFUL_SHUTDOWN

**Violation:** `process.exit()` is called in `http.ts`, `worker.ts`, `shutdown.ts`, and other files. In some cases it's called without running shutdown handlers, potentially leaving database connections open.

---

### Finding 32: AuthContext Includes `requestId` in Some Definitions

**Severity:** P3-LOW
**Category:** Architecture
**Tag:** INTERFACE_BLOAT

**Violation:** `requestId` is a per-request concern, not an authentication concern. It's included in `AuthContext` in `apps/web/lib/auth.ts` but not in `packages/security/jwt.ts`. This mixes cross-cutting concerns.

---

### Finding 33: `role` Type Inconsistency (String vs Enum)

**Severity:** P3-LOW
**Category:** Type
**File:** `/home/user/SmartBeak/control-plane/services/auth.ts`
**Line:** 4:1
**Tag:** TYPE_DRIFT

**Violation:** `control-plane/services/auth.ts` defines `type Role = 'admin' | 'editor' | 'viewer' | 'owner'` (includes `owner`), while `packages/security/auth.ts` and `jwt.ts` define `UserRole = 'admin' | 'editor' | 'viewer'` (no `owner`). The `requireRole` function on line 181 accepts `Role[]` which can include `owner`, but JWT tokens only contain `admin | editor | viewer`.

---

### Finding 34: `import` Statement After Code in `rateLimiter.ts`

**Severity:** P3-LOW
**Category:** Architecture
**File:** `/home/user/SmartBeak/apps/api/src/middleware/rateLimiter.ts`
**Line:** 698:1
**Tag:** CODE_STYLE

**Violation:** Fastify type imports appear on line 698 after 697 lines of code, mixing import locations. ES module imports should be at the top of the file.

---

### Finding 35: `BigInt` Serialization Helper Defined But Not Used in Error Handler

**Severity:** P3-LOW
**Category:** Architecture
**File:** `/home/user/SmartBeak/control-plane/api/http.ts`
**Line:** 260:1
**Tag:** DEAD_CODE

**Violation:** `serializeBigInt` function is defined but the error handler on line 267 uses standard `JSON.stringify` via `reply.send()`. If any error object contains BigInt values, `JSON.stringify` will throw.

---

## Blast Radius Ranking (Immediate Production Impact)

| Rank | Finding | Impact | Users Affected |
|------|---------|--------|----------------|
| 1 | **F1: Kernel auth stub** | All authenticated API requests fail 401 | ALL users |
| 2 | **F17: Empty JWT key fallback** | Forgeable JWTs if key loading fails | ALL users |
| 3 | **F5: Port 443 blocked** | All HTTPS publishing fails | All publishers |
| 4 | **F2: JWT key divergence** | Auth failures on 5 route files | Users of those routes |
| 5 | **F3: Missing aud/iss** | Cross-service token reuse | ALL users (if key shared) |
| 6 | **F6: SET LOCAL before BEGIN** | No query timeout in transactions | ALL transactions |
| 7 | **F12: Triple pool exhaustion** | Connection storm under load | ALL users |
| 8 | **F10: Health check DoS** | DB pool exhaustion via health endpoint | ALL users |
| 9 | **F15: Revoked tokens accepted** | Revoked tokens work during Redis outage | Revoked users |
| 10 | **F8: Audit OOM** | Server crash on integrity check | Audit system |

---

## Recommendations Priority Matrix

### Immediate (Deploy Today)
1. Fix kernel auth stub (F1) — route `verifyToken` to `@security/jwt`
2. Remove empty key fallback (F17) — fail hard on missing keys
3. Unblock ports 80/443 in SSRF (F5) — unblock publishing
4. Add aud/iss to `@security/auth` (F3) — prevent cross-service reuse

### This Sprint
5. Move `SET LOCAL` after `BEGIN` (F6)
6. Add rate limiting to `/health` (F10)
7. Consolidate connection pools (F12)
8. Add `statement_timeout` to Knex pools (F13, F14)
9. Fix `getRateLimitIdentifier` IP selection (F9)
10. Add LIMIT to `verifyIntegrity` (F8)

### Next Sprint
11. Audit all webhook signature verification (F11)
12. Fix `extractSafeUrl` double-slash pattern (F4)
13. Change revocation circuit breaker to fail-closed (F15)
14. Fix advisory lock cleanup (F7)
15. Lazy-init Redis in jwt.ts (F16)
16. Replace `any` with `unknown` in audit.ts (F24)
17. Reduce `SELECT *` usage (F25)

### Backlog
18-35: P2/P3 findings — type drift, logging, dead code, style issues

---

---

## Supplementary Findings (Phase 2 Cross-Verification)

The following findings were identified during the adversarial cross-verification phase.

### Finding 36: CSRF Path Exclusion Bypass via `startsWith()`

**Severity:** P1-HIGH
**Category:** Security
**File:** `/home/user/SmartBeak/apps/api/src/middleware/csrf.ts`
**Line:** 127:5
**Tag:** CSRF_BYPASS

**Violation:** CSRF exclusion uses `path.startsWith(excluded)`, which allows prefix-based bypass. For example, if `/api/auth/login` is excluded, an attacker can craft `/api/auth/login-admin` or `/api/auth/loginxyz` to bypass CSRF protection on unintended endpoints.

**Evidence:**
```typescript
// csrf.ts:127
if (mergedConfig.excludedPaths.some(excluded => path.startsWith(excluded))) {
  // CSRF check skipped — but matches ANY path sharing the prefix
}
```

**Fix:** Use exact path matching or regex patterns instead of `startsWith()`:
```typescript
if (mergedConfig.excludedPaths.some(excluded => path === excluded)) {
```

**Risk if not fixed:** State-changing endpoints sharing a prefix with an excluded path bypass CSRF protection entirely.

**Blast radius:** All endpoints sharing a prefix with any CSRF-excluded path.

---

### Finding 37: CSRF Token Length Check Leaks Timing Information

**Severity:** P2-MEDIUM
**Category:** Security
**File:** `/home/user/SmartBeak/apps/api/src/middleware/csrf.ts`
**Line:** 85:5
**Tag:** TIMING_ATTACK

**Violation:** The token comparison performs a non-constant-time length check before the constant-time XOR comparison. This leaks whether the attacker's token has the correct length.

**Evidence:**
```typescript
// csrf.ts:85-87
if (stored.length !== providedToken.length) {
    return false; // Fast path — leaks correct length
}
// Lines 89-94: constant-time comparison only runs after length check
```

**Fix:** Remove the early length check and let the constant-time comparison handle all cases, or pad both strings to a fixed length before comparing.

**Risk if not fixed:** Attacker can determine correct token length (~6 bits of entropy reduction).

**Blast radius:** CSRF token validation for all state-changing requests.

---

### Finding 38: Missing `org_id` Scoping in Notification Queries

**Severity:** P1-HIGH
**Category:** Security
**File:** `/home/user/SmartBeak/domains/notifications/infra/persistence/PostgresNotificationRepository.ts`
**Line:** 178, 243, 390
**Tag:** AUTHZ_BYPASS

**Violation:** Three notification queries lack `org_id` filtering, allowing cross-tenant data access:
- `listPending()` (line 178): Fetches pending notifications across ALL organizations
- `listByUser()` (line 243): Fetches by `user_id` only, no org isolation
- `deleteOld()` (line 390): Deletes old notifications across ALL organizations

**Evidence:**
```typescript
// Line 178 (listPending) - VULNERABLE
const { rows } = await queryable.query(
  `SELECT id, org_id, user_id, channel, template, payload, status
   FROM notifications
   WHERE status IN ('pending', 'failed')  -- No org_id filter!
   ORDER BY created_at ASC
   LIMIT $1 OFFSET $2`,
  [safeLimit, safeOffset]
);
```

**Fix:** Add `AND org_id = $N` to all three queries. Pass `orgId` as a required parameter.

**Risk if not fixed:** Multi-tenancy isolation breach. Users in one organization can view or affect notifications belonging to other organizations.

**Blast radius:** All notification queries, all organizations.

---

### Finding 39: N+1 Query Pattern in 5 Repository `batchSave` Methods

**Severity:** P2-MEDIUM
**Category:** Performance
**File:** Multiple domain repositories
**Tag:** N_PLUS_1

**Violation:** Five repository files implement `batchSave()` with a recursive loop pattern that splits large batches into multiple sequential database operations instead of a single bulk operation:
- `PostgresMediaRepository.ts:160`
- `PostgresSearchIndexRepository.ts:226`
- `PostgresIndexingJobRepository.ts:169`
- `PostgresSeoRepository.ts:211`
- `PostgresNotificationRepository.ts:295`

**Evidence:**
```typescript
// PostgresMediaRepository.ts:160-166
for (let i = 0; i < assets.length; i += BATCH_SIZE) {
    const batch = assets.slice(i, i + BATCH_SIZE);
    const batchResult = await this.batchSave(batch, client); // Recursive call in loop
}
```

**Fix:** Use a single bulk INSERT with VALUES list or UNNEST pattern for all items, with a single database round-trip.

**Risk if not fixed:** Under high load, 1000 items create 10 sequential database operations instead of 1, increasing latency 10x and connection hold time.

**Blast radius:** All batch operations in the 5 affected domain repositories.

---

### Cross-Verification: Webhook Security Confirmed

The adversarial review confirmed that all webhook handlers (Stripe, Paddle, Clerk) implement proper HMAC signature verification with constant-time comparison, event deduplication via Redis, timestamp validation, and event type allowlists. The `/webhooks/*` auto-public pattern in `http.ts:235` is mitigated because control-plane webhook routes don't currently exist — all webhooks are in the Next.js layer.

---

## Updated Summary

| Severity | Original Count | + Supplementary | Total |
|----------|---------------|-----------------|-------|
| P0-CRITICAL | 4 | 0 | **4** |
| P1-HIGH | 13 | +2 | **15** |
| P2-MEDIUM | 12 | +2 | **14** |
| P3-LOW | 6 | 0 | **6** |
| **Total** | **35** | **+4** | **39** |

---

*Report generated by automated security audit with manual verification and adversarial cross-verification phase. All findings verified against source code as of 2026-02-12.*

---

## Remediation Log (Hostile Code Review — Session 2)

**Date:** 2026-02-12
**Commits:** `1ed2b0e` (P0 critical fixes), `3f90ba0` (P1/P2 fixes)
**Branch:** `claude/security-audit-typescript-postgres-3W4mv`

This section documents all findings discovered and/or remediated during the second-pass hostile code review audit. Findings are categorized as **NEW** (not in original report) or **REMEDIATED** (fixes an existing finding above).

### P0 — Critical Fixes Applied

#### NEW — P0-A: IDOR in `verifyAdminOrgAccess` — Any Admin Can Access Any Org

**File:** `apps/api/src/routes/adminBilling.ts:15-22`, `apps/api/src/routes/adminAudit.ts`
**Status:** PARTIALLY REMEDIATED

The `verifyAdminOrgAccess` function checked whether ANY admin/owner membership existed in the target org (`WHERE org_id = ? AND role IN ('admin', 'owner')`), but never verified the REQUESTING user's identity. Since admin routes use a shared `ADMIN_API_KEY` (not per-user JWT), full per-user IDOR protection requires an architectural change to per-user auth.

**Fixes applied:**
- Added UUID format validation to prevent SQL injection via `orgId`
- Added missing `verifyAdminOrgAccess` call to `/admin/billing/:id` endpoint (was completely unguarded)
- Documented the shared-API-key limitation with `// SECURITY-LIMITATION` comments

#### NEW — P0-B: Audit Hash Tamper Detection Broken — Nested Fields Excluded From Hash

**File:** `packages/security/audit.ts:555-585`
**Status:** REMEDIATED

`calculateHash` passed an array replacer to `JSON.stringify`. Per the JSON.stringify spec, an array replacer filters properties **recursively at all nesting levels**. Top-level keys like `actor`, `resource`, `details` were included, but their nested properties (`actor.email`, `actor.ip`, `actor.userAgent`, `resource.name`, all `details.*`) were **silently excluded** because those nested key names didn't appear in the replacer array.

**Fix:** Removed the array replacer argument. The first argument already uses explicitly ordered keys with `sortKeys()` applied to nested objects — no replacer was needed. The hash now covers all nested fields.

**Blast radius:** An attacker with DB write access could have modified `actor.email`, `actor.ip`, `resource.name`, and arbitrary `details` fields in audit logs without breaking the hash chain. `verifyIntegrity()` would have reported tampered logs as valid.

#### NEW — P0-C: Paddle Webhook Dedup Fails Open — Duplicate Payments During Redis Downtime

**File:** `apps/api/src/billing/paddleWebhook.ts:52-57`
**Status:** REMEDIATED

`isDuplicateEvent` caught Redis errors and returned `false` ("not a duplicate"), allowing duplicate event processing. The subscription upgrade path also performed SELECT + UPDATE + INSERT **without a transaction**.

**Fixes applied:**
- Changed `isDuplicateEvent` to throw on Redis error (fail-closed), matching Stripe's behavior
- Wrapped subscription upgrade path in `db.transaction()`

#### NEW — P0-D: JWT `UserRole` Enum Drift — `owner` Role Rejected by jwt.ts

**File:** `packages/security/jwt.ts:31`
**Status:** REMEDIATED (also partially remediates Finding 33)

`jwt.ts` defined `UserRoleSchema = z.enum(['admin', 'editor', 'viewer'])` without `owner`. `auth.ts` had `z.enum(['viewer', 'editor', 'admin', 'owner'])`. Tokens with `role: "owner"` passed auth.ts validation but were rejected by jwt.ts Zod validation.

**Fix:** Added `'owner'` to jwt.ts's `UserRoleSchema`.

#### REMEDIATED — P0-E: Dual `verifyToken` Implementations (Fixes Finding 2, Finding 3)

**File:** `packages/security/auth.ts:384-405`
**Status:** REMEDIATED

`auth.ts` maintained its own `verifyToken` using only `JWT_SECRET` (single key, no rotation, no aud/iss validation). `jwt.ts` used `JWT_KEY_1` + `JWT_KEY_2` with rotation, audience, issuer, and Zod validation.

**Fix:** Replaced auth.ts's independent `verifyToken` with delegation to jwt.ts's `verifyToken`. Now both code paths use the same verification logic with consistent key rotation, Zod validation, and clock tolerance.

### P1 — High Severity Fixes Applied

#### REMEDIATED — P1-A: CSRF Timing Leak (Fixes Finding 37)

**File:** `apps/api/src/middleware/csrf.ts:85-87`
**Status:** REMEDIATED

The early `stored.length !== providedToken.length` return leaked token length via timing.

**Fix:** Replaced with `crypto.timingSafeEqual` using Buffer padding to ensure constant-time comparison regardless of length mismatch.

#### NEW — P1-B: `checkAbuseDetailed` Honors `riskOverride` Without Role Check

**File:** `apps/api/src/middleware/abuseGuard.ts:359-360`
**Status:** REMEDIATED

`checkAbuseDetailed` accepted `riskOverride: true` in the payload without verifying admin role. The middleware (`abuseGuard`) correctly required `canOverrideRisk(req.user)`, but the standalone function had no user context.

**Fix:** Removed `riskOverride` logic from `checkAbuseDetailed`. Added comment explaining that the middleware version should be used for role-checked overrides.

#### NEW — P1-C: SSRF DNS Rebinding — No DNS Resolution Before IP Check

**File:** `packages/security/ssrf.ts:268-343`
**Status:** REMEDIATED

`validateUrl` only checked hostname strings against `INTERNAL_IP_PATTERNS` without performing DNS resolution. An attacker could register a domain resolving to `127.0.0.1` to bypass the string-based check.

**Fix:** Added `validateUrlWithDnsCheck()` async function that resolves DNS via `dns.resolve4()`/`dns.resolve6()` and checks all resolved IPs against `isInternalIp()`. Fails closed on DNS resolution errors.

#### NEW — P1-D: Stripe `processEvent` Uses `if/if/if` Instead of `switch`

**File:** `apps/api/src/billing/stripeWebhook.ts:191-281`
**Status:** REMEDIATED

Multiple `if (event.type === ...)` blocks could theoretically all execute for a single event.

**Fix:** Changed to `switch (event.type)` with explicit cases and `default` handler.

#### REMEDIATED — P1-E: `auth.ts` Optional Auth Silently Defaults Missing Role to 'viewer' (Fixes Finding implicit in F33)

**File:** `packages/security/auth.ts:206, 274`
**Status:** REMEDIATED

`optionalAuthFastify` used `const roles = claims.role ? [claims.role] : ['viewer']`, silently granting viewer access when role was missing. `requireAuthFastify` did the same. In contrast, `requireAuthNextJs` threw on missing role.

**Fix:** Both `optionalAuthFastify` and `requireAuthFastify` now reject missing role claims instead of defaulting. `optionalAuthFastify` returns without attaching auth context; `requireAuthFastify` returns 401.

#### NEW — P1-F: Stripe Module-Level Initialization Crashes Entire App

**File:** `apps/api/src/billing/stripeWebhook.ts:11-17`
**Status:** REMEDIATED

`if (!stripeKey) throw new Error(...)` at module level crashed the process on import if `STRIPE_SECRET_KEY` was not set — even if billing features weren't needed.

**Fix:** Replaced with lazy `getStripe()` function that initializes on first use.

#### REMEDIATED — P1-G: CSRF Path Exclusion Bypass (Fixes Finding 36)

**File:** `apps/api/src/middleware/csrf.ts:127`
**Status:** REMEDIATED

`path.startsWith(excluded)` allowed bypass via crafted paths like `/webhookAdmin`.

**Fix:** Changed to exact match OR path + '/' prefix: `path === excluded || path.startsWith(excluded + '/')`.

#### REMEDIATED — P1-H: CSRF Session ID From Client Header (Finding 36 related)

**File:** `apps/api/src/middleware/csrf.ts:148-149`
**Status:** REMEDIATED

Session ID was derived from client-controlled `x-session-id` header, allowing an attacker to generate a CSRF token with their own session ID and use it against a victim.

**Fix:** Derived session ID from authenticated JWT claims (`req.auth.sessionId || req.auth.userId`) instead of client header.

### P2 — Medium Severity Fixes Applied

#### REMEDIATED — P2-A: Audit `verifyIntegrity` OOM (Fixes Finding 8)

**File:** `packages/security/audit.ts:463-471`
**Status:** REMEDIATED

`SELECT * FROM audit_logs ORDER BY timestamp` with no LIMIT loaded all rows into memory.

**Fix:** Paginated to 1000-row batches using LIMIT/OFFSET.

#### NEW — P2-B: `abuseGuard.ts` Uses `console.warn` Instead of Structured Logger

**File:** `apps/api/src/middleware/abuseGuard.ts:293`
**Status:** REMEDIATED

Used `console.warn` despite importing `getLogger`.

**Fix:** Replaced with `logger.warn()` from the imported structured logger.

#### REMEDIATED — P2-C: CSRF Double-Delete (Fixes implicit Finding 37 related)

**File:** `apps/api/src/middleware/csrf.ts:99-100, 187`
**Status:** REMEDIATED

`validateCsrfToken` deleted the token on success, then middleware called `clearCsrfToken` again.

**Fix:** Removed redundant `clearCsrfToken` call.

#### REMEDIATED — P2-D: `extractSafeUrl` Rejects All Valid URLs (Fixes Finding 4)

**File:** `packages/security/ssrf.ts:360`
**Status:** REMEDIATED

The `/\/\//g` pattern matched `://` in every URL, causing `extractSafeUrl()` to return `null` for ALL valid URLs.

**Fix:** Removed the `//` pattern. Protocol-relative URLs are already handled by the protocol allowlist.

#### REMEDIATED — P2-E: SSRF Blocks Standard HTTP/HTTPS Ports (Fixes Finding 5)

**File:** `packages/security/ssrf.ts:98, 113`
**Status:** REMEDIATED

Ports 80 and 443 were in `BLOCKED_PORTS`, causing `validateUrl()` to reject all standard HTTP/HTTPS URLs.

**Fix:** Removed ports 80 and 443 from `BLOCKED_PORTS`.

#### REMEDIATED — P2-F: CSRF `HttpOnly` Cookie Prevents Double-Submit Pattern

**File:** `apps/api/src/middleware/csrf.ts:220`
**Status:** REMEDIATED

`HttpOnly` flag on the CSRF cookie prevented client JavaScript from reading the token to send in the `x-csrf-token` header, completely breaking the double-submit CSRF pattern.

**Fix:** Removed `HttpOnly`; retained `Secure; SameSite=Strict` which still prevents cross-origin cookie submission.

#### REMEDIATED — P2-G: CSRF Token Replay (Single-Use Enforcement)

**File:** `apps/api/src/middleware/csrf.ts:100-105`
**Status:** REMEDIATED

CSRF tokens remained valid for the full 1-hour TTL after use, allowing unlimited replay attacks.

**Fix:** Token is now deleted from Redis immediately after successful validation (single-use).

### Updated Remediation Status Summary

| Severity | Total Findings | Remediated This Session | Remaining |
|----------|---------------|------------------------|-----------|
| P0-CRITICAL | 4 + 4 new = **8** | 5 fully + 1 partial | 2 (F1 kernel stub, F17 empty key fallback) |
| P1-HIGH | 15 + 4 new = **19** | 8 | 11 |
| P2-MEDIUM | 14 + 3 new = **17** | 7 | 10 |
| P3-LOW | 6 | 0 | 6 |
| **Total** | **50** | **20 fully + 1 partial** | **29** |

### Files Modified

| File | Changes |
|------|---------|
| `apps/api/src/routes/adminBilling.ts` | UUID validation, missing access check, documentation |
| `apps/api/src/routes/adminAudit.ts` | UUID validation, documentation |
| `packages/security/audit.ts` | Hash calculation fix, verifyIntegrity pagination |
| `apps/api/src/billing/paddleWebhook.ts` | Fail-closed dedup, transactional subscription upgrade |
| `packages/security/jwt.ts` | Added `owner` to UserRoleSchema |
| `packages/security/auth.ts` | Delegated to jwt.ts verifyToken, fixed role defaults |
| `apps/api/src/middleware/csrf.ts` | Timing-safe comparison, path exclusion, session ID, single-use tokens, cookie flags |
| `apps/api/src/middleware/abuseGuard.ts` | Removed unsafe riskOverride, structured logging |
| `packages/security/ssrf.ts` | DNS rebinding check, removed broken URL patterns, unblocked ports 80/443 |
| `apps/api/src/billing/stripeWebhook.ts` | Switch statement, lazy Stripe init |

---

*Remediation log appended 2026-02-12. Verified against source code post-fix.*
