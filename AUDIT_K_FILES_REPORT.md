# Hostile Code Review Audit: "k*" Files

**Scope**: All files with filenames starting with "k" in the SmartBeak codebase
**Audited files** (8 total):
1. `apps/api/src/keywords/keywords.ts`
2. `apps/api/src/advisor/keywordCoverage.ts`
3. `knexfile.ts`
4. `packages/security/keyRotation.ts`
5. `packages/security/__tests__/keyRotation.security.test.ts`
6. `apps/web/pages/domains/[id]/keywords-map.tsx`
7. `apps/web/pages/domains/[id]/keywords-decay.tsx`
8. `apps/web/pages/domains/[id]/keywords.tsx`

**Date**: 2026-02-18

---

## Critical (P0) — Production outage, data loss, security breach imminent

### P0-01: Multi-instance race condition in scheduled key invalidation
- **File**: `packages/security/keyRotation.ts:343-370`
- **Category**: SQL | Concurrency
- **Violation**: `processScheduledInvalidations()` performs a bare `SELECT provider FROM api_keys WHERE scheduled_invalidation_at <= NOW() AND invalidation_status = 'pending'` followed by individual UPDATE statements, with no `FOR UPDATE SKIP LOCKED` and no transaction boundary. The Kubernetes production deployment runs 2–10 API replicas (confirmed in `k8s/overlays/production/patches/replicas.yaml`). All replicas execute this method on a 1-hour interval. Every replica will read the same pending rows and attempt concurrent invalidation.
- **Fix**: Wrap in a transaction with `SELECT ... FOR UPDATE SKIP LOCKED` (the codebase already has a `withLock()` helper in `packages/database/transactions/index.ts`):
  ```sql
  BEGIN;
  SELECT provider FROM api_keys
  WHERE scheduled_invalidation_at <= NOW()
  AND invalidation_status = 'pending'
  FOR UPDATE SKIP LOCKED;
  -- process each row
  UPDATE api_keys SET invalidation_status = 'completed' ...
  COMMIT;
  ```
- **Risk**: Duplicate key invalidations across instances. If `invalidateOldKey()` has side effects (external API calls, webhook fires), they execute N times (N = replica count). Could revoke keys while other instances still serve traffic with the previous key, causing intermittent auth failures.
- **Blast radius**: All API key providers in the system. Every provider undergoing rotation is affected simultaneously.

### P0-02: Salt race condition across instances (distributed TOCTOU)
- **File**: `packages/security/keyRotation.ts:212-241`
- **Category**: Security | Concurrency
- **Violation**: `ensureProviderSalt()` uses a per-process `Mutex` (from `async-mutex`), which only serializes within a single Node.js process. In multi-instance Kubernetes deployments, two instances can simultaneously: (1) both see no salt in DB, (2) both generate different random salts, (3) one overwrites the other via `ON CONFLICT DO UPDATE SET salt = EXCLUDED.salt`. The instance whose salt was overwritten still has the old salt in memory in `this.providerSalts`, and all subsequent encrypt/decrypt operations on that instance use the wrong salt. Data encrypted with the overwritten salt becomes permanently undecryptable.
- **Fix**: Use `INSERT ... ON CONFLICT DO NOTHING` and then `SELECT` to read back what was actually persisted. Or use `pg_advisory_lock` keyed on provider name before the check-and-insert.
- **Risk**: **Permanent data loss.** Encrypted API keys stored with the wrong salt cannot be recovered. Silent corruption — the system won't detect the mismatch until decryption fails at key retrieval time.
- **Blast radius**: Any provider whose salt is initialized while multiple instances start concurrently. Startup race window is highest during rolling deployments.

### P0-03: Plaintext API keys held permanently in memory
- **File**: `packages/security/keyRotation.ts:83` (`this.keys = new Map<string, ApiKeyConfig>()`)
- **Category**: Security
- **Violation**: All registered API keys (plaintext) are stored in an in-memory `Map` for the lifetime of the process. The `stop()` method (line 164) clears timers but does NOT clear `this.keys`, `this.providerSalts`, or `this.derivedKeyCache`. A heap dump, core dump, or memory inspection at any point reveals every plaintext provider API key. The `revokeKey()` method (line 540) deletes from the map, but `stop()` does not.
- **Fix**: (1) `stop()` must call `this.keys.clear()`, `this.providerSalts.clear()`, `this.derivedKeyCache.clear()`. (2) Consider storing only encrypted keys in memory and decrypting on demand. (3) Zero-fill Buffers in `providerSalts` before deletion: `salt.fill(0)`.
- **Risk**: Memory dump in production (OOM kill, debug attach, pod eviction) leaks all provider API keys. Kubernetes pods sharing a node could potentially access each other's memory via `/proc`.
- **Blast radius**: Every API key registered in the system.

---

## High (P1) — Likely bugs under load, security vulnerabilities, data corruption

### P1-01: `deriveKey()` and `encryptKey()` are public methods
- **File**: `packages/security/keyRotation.ts:448,467`
- **Category**: Security | Architecture
- **Violation**: `deriveKey(provider)` and `encryptKey(key, provider)` have no access modifier (default `public` in TypeScript). Any code with a reference to the `KeyRotationManager` instance can call `deriveKey('openai')` to get the raw AES-256 derived key as a Buffer, or call `encryptKey(data, provider)` to use the encryption oracle with arbitrary plaintext. This violates the principle of least privilege.
- **Fix**: Add `private` modifier to both methods:
  ```typescript
  private deriveKey(provider: string): Buffer {
  private encryptKey(key: string, provider: string): string {
  ```
- **Risk**: Any module importing the KeyRotationManager can extract derived encryption keys. An XSS or code injection that obtains the instance reference can decrypt all stored API keys.

### P1-02: `pbkdf2Sync` blocks the event loop (~100-300ms per uncached call)
- **File**: `packages/security/keyRotation.ts:459`
- **Category**: Performance
- **Violation**: `pbkdf2Sync(this.encryptionSecret, salt, 600000, 32, 'sha256')` is synchronous and blocks the Node.js event loop for 100–300ms per call. The LRU cache (5-minute TTL, 100 entries) mitigates repeat calls, but every cache miss blocks. If the cache is cold (after restart, after TTL expiry, or after `revokeKey()` which clears the cache), all concurrent requests stall.
- **Note**: Currently the `KeyRotationManager` is not instantiated in production code paths (only tests). This becomes P0 the moment it's wired into HTTP handlers.
- **Fix**: Replace `pbkdf2Sync` with async `pbkdf2` from `node:crypto` and make `deriveKey()`, `encryptKey()` async.
- **Risk**: Event loop stall under cold-cache scenarios. All HTTP requests queue behind the PBKDF2 computation.

### P1-03: LRU cache returns mutable Buffer references
- **File**: `packages/security/keyRotation.ts:450-451` + `packages/utils/lruCache.ts`
- **Category**: Security | Type
- **Violation**: `this.derivedKeyCache.get(provider)` returns a direct reference to the cached Buffer object. If any code path mutates the returned Buffer (e.g., `key.fill(0)` for security wiping), the cached copy is corrupted. All subsequent cache hits return the zeroed-out Buffer, causing silent encryption/decryption failures with wrong keys.
- **Fix**: Return a copy in `deriveKey()`: `return Buffer.from(cached)` instead of `return cached`.
- **Risk**: Silent cryptographic failure. Encrypted data written with corrupted key cannot be decrypted. Data loss for all affected providers.

### P1-04: Weak secret validation (prefix-only check, naive entropy)
- **File**: `packages/security/keyRotation.ts:31-38`
- **Category**: Security
- **Violation**: The weak pattern check `const weakPatterns = /^(password|secret|key|test|123|abc)/i` only matches the START of the string. A secret like `strong-prefixpassword` passes. The entropy check `new Set(secret).size < 16` only measures character diversity, not Shannon entropy. A string like `abcdefghijklmnop` (exactly 16 unique chars) passes with only ~4 bits of entropy per character.
- **Fix**: Use a proper entropy calculation: `Shannon entropy = -sum(p * log2(p))` where p is the frequency of each character. Require >= 3.5 bits/char for a 32-char string (~112 bits total). Also check weak patterns anywhere in the string, not just prefix: remove the `^` anchor.
- **Risk**: Weak encryption secrets accepted by the validator. If the PBKDF2-derived key has low entropy, brute-force decryption of stored API keys becomes feasible.

### P1-05: Missing foreign key on `keywords.domain_id`
- **File**: `migrations/sql/20260610000000_pkg_keywords.up.sql`
- **Category**: SQL | Data Integrity
- **Violation**: The `keywords` table defines `domain_id uuid not null` but has NO foreign key constraint to the `domains` table. Confirmed by migration review. This allows orphaned keyword records when a domain is deleted.
- **Fix**: Add migration:
  ```sql
  ALTER TABLE keywords
  ADD CONSTRAINT keywords_domain_id_fk
  FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE;
  ```
- **Risk**: Orphaned records accumulate after domain deletion. Coverage queries return phantom results. `keywordCoverageForDomain()` reports data for non-existent domains.

### P1-06: Locale-dependent normalization without Unicode NFC
- **File**: `apps/api/src/keywords/keywords.ts:52`
- **Category**: SQL | Data Integrity
- **Violation**: `const normalize = (s: string) => s.trim().toLowerCase()` performs no Unicode normalization. The same visible character can have multiple byte representations (e.g., "é" as U+00E9 vs U+0065+U+0301). These produce different `normalized_phrase` values, bypassing the UNIQUE constraint `keywords_domain_norm_idx(domain_id, normalized_phrase)`. Additionally, `.toLowerCase()` produces locale-dependent results for Turkish İ/I, German ß, Greek Σ.
- **Fix**:
  ```typescript
  const normalize = (s: string) => s.trim().normalize('NFC').toLowerCase();
  ```
  Also add `COLLATE "C"` to the `normalized_phrase` column for deterministic comparison.
- **Risk**: Duplicate keywords that should be deduplicated. Coverage metrics become incorrect. UPSERT `.onConflict()` fails to detect conflicts, creating multiple rows for semantically identical phrases.

### P1-07: No `updated_at` maintenance on `api_keys` table
- **File**: `packages/security/keyRotation.ts:247-256`
- **Category**: SQL | Data Integrity
- **Violation**: `storeKey()` uses `ON CONFLICT (provider) DO UPDATE SET` but does not set `updated_at = NOW()`. The `api_keys` table has an `updated_at` column with `DEFAULT NOW()` but no trigger. After upsert, `updated_at` retains the original insertion timestamp. Similarly, `updateKeyInDatabase()` (line 401) and `scheduleInvalidation()` (line 334) update rows without touching `updated_at`.
- **Fix**: Add `updated_at = NOW()` to every UPDATE/upsert statement, or create a trigger:
  ```sql
  CREATE OR REPLACE FUNCTION update_updated_at()
  RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END $$ LANGUAGE plpgsql;
  CREATE TRIGGER api_keys_updated_at BEFORE UPDATE ON api_keys
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  ```
- **Risk**: Audit trail broken. Cannot determine when a key was last rotated from the `updated_at` column. Compliance and forensic analysis compromised.

### P1-08: No hex validation on decryption input
- **File**: `packages/security/keyRotation.ts:482-489`
- **Category**: Security | Type
- **Violation**: `decryptKey()` splits on `:` and passes `parts[0]` (ivHex) and `parts[1]` (authTagHex) directly to `Buffer.from(ivHex, 'hex')`. If these contain non-hex characters, `Buffer.from(..., 'hex')` silently truncates at the first invalid byte, producing a shorter-than-expected IV or auth tag. A 15-byte IV (instead of 16) would cause AES-GCM to produce different ciphertext, leading to silent decryption failure or a thrown error that doesn't indicate the root cause.
- **Fix**: Validate hex format before use:
  ```typescript
  const HEX_RE = /^[0-9a-f]+$/i;
  if (!HEX_RE.test(ivHex) || ivHex.length !== 32) throw new Error('Invalid IV format');
  if (!HEX_RE.test(authTagHex) || authTagHex.length !== 32) throw new Error('Invalid auth tag format');
  ```
- **Risk**: Malformed encrypted data in the database causes cryptic errors instead of clear validation failures. Difficult to diagnose in production.

### P1-09: No input validation on keyword phrase length/content
- **File**: `apps/api/src/keywords/keywords.ts:59-80`
- **Category**: Security | Validation
- **Violation**: `upsertKeyword()` accepts `input.phrase` with no length validation. A caller can insert a multi-megabyte string into the `phrase` and `normalized_phrase` TEXT columns. The `normalize()` function calls `.trim().toLowerCase()` on arbitrarily large strings, consuming CPU and memory. No control character stripping, no maximum length enforcement.
- **Fix**: Add validation before the database call:
  ```typescript
  if (input.phrase.length === 0 || input.phrase.length > 500) {
    throw new ValidationError('Keyword phrase must be 1-500 characters', ErrorCodes.VALIDATION_ERROR);
  }
  ```
- **Risk**: DoS via large payload. Memory exhaustion from normalizing a multi-MB string. Database bloat from unbounded TEXT values.

---

## Medium (P2) — Technical debt, maintainability, performance degradation

### P2-01: Branded types not used for IDs
- **File**: `apps/api/src/keywords/keywords.ts:8-10`
- **Category**: Type
- **Violation**: `KeywordRow.id` is typed `string` instead of branded `KeywordId`. `KeywordRow.domain_id` is `string` instead of `DomainId`. The codebase uses branded types (`UserId`, `OrgId`, `ContentId`) per CLAUDE.md conventions but keyword-related types use raw strings. This allows accidentally passing a `domain_id` where a `keyword_id` is expected.
- **Fix**: Define `KeywordId` branded type and use it:
  ```typescript
  import type { DomainId } from '@kernel/branded';
  export type KeywordId = string & { readonly __brand: 'KeywordId' };
  ```
- **Risk**: Type confusion bugs. A domain_id accidentally passed as a keyword_id compiles without error.

### P2-02: `KeyRotationManager` extends `EventEmitter` without typed events
- **File**: `packages/security/keyRotation.ts:79`
- **Category**: Type | Architecture
- **Violation**: `class KeyRotationManager extends EventEmitter` uses the untyped base `EventEmitter`. Events emitted include `keyRegistered`, `keyRotated`, `rotationFailed`, `error`, `alert`, `oldKeyInvalidated`, `keyRevoked` — all stringly typed with no payload type checking. A typo like `this.emit('keyRotaed', event)` compiles silently.
- **Fix**: Create a typed event map:
  ```typescript
  interface KeyRotationEvents {
    keyRegistered: [{ provider: string; expiresAt: Date }];
    keyRotated: [KeyRotationEvent];
    rotationFailed: [KeyRotationEvent];
    error: [Error | { phase: string; error: unknown }];
    // etc.
  }
  class KeyRotationManager extends (EventEmitter as new () => TypedEmitter<KeyRotationEvents>) {
  ```
- **Risk**: Silent event name typos. Listeners attached to misspelled events never fire. No compile-time validation of event payloads.

### P2-03: N+1 query pattern in `processScheduledInvalidations`
- **File**: `packages/security/keyRotation.ts:349-364`
- **Category**: SQL | Performance
- **Violation**: Iterates over selected rows one-by-one with individual `invalidateOldKey()` (which does a DB query) and individual UPDATE per row. With N pending invalidations, this executes 1 + 2N queries.
- **Fix**: Batch the update:
  ```sql
  UPDATE api_keys
  SET invalidation_status = 'completed', previous_key = NULL
  WHERE provider = ANY($1::text[])
  AND invalidation_status = 'pending';
  ```
- **Risk**: Slow invalidation processing under load. Connection pool contention with many pending invalidations.

### P2-04: `knexfile.ts` missing `statement_timeout`
- **File**: `knexfile.ts:23-33`
- **Category**: SQL | Resilience
- **Violation**: The migration knexfile has no `statement_timeout` in the connection config. A malformed migration (e.g., `CREATE INDEX CONCURRENTLY` on a huge table, or an accidental cartesian join) runs indefinitely, holding a connection and potentially locking tables.
- **Fix**: Add to the connection config:
  ```typescript
  connection: {
    connectionString,
    statement_timeout: 300000, // 5 minutes max for migrations
  },
  ```
- **Risk**: Hung migration blocks deployment pipeline indefinitely. Locks held by the migration block application queries.

### P2-05: `knexfile.ts` missing `test` and `staging` environments
- **File**: `knexfile.ts:36-46`
- **Category**: Architecture
- **Violation**: Config only defines `development` and `production`. No `test` or `staging` entry. Knex defaults to `development` when environment doesn't match. Running migrations in CI/staging silently uses development config.
- **Fix**: Add `test` and `staging` entries with appropriate pool sizes and timeouts.
- **Risk**: Staging migrations run with development pool settings. Test migrations may connect to wrong database if CONTROL_PLANE_DB differs per environment.

### P2-06: `knexfile.ts` eagerly evaluates config at module load
- **File**: `knexfile.ts:37`
- **Category**: Architecture
- **Violation**: `development: getBaseConfig()` is evaluated at import time. If `CONTROL_PLANE_DB` is not set, the module throws immediately. This prevents importing the config for inspection or testing without the env var set.
- **Fix**: Use a getter or factory function:
  ```typescript
  const config = {
    get development() { return getBaseConfig(); },
    get production() { return { ...getBaseConfig(), connection: { ... } }; },
  };
  ```
- **Risk**: Test suites that import knexfile (even indirectly) fail without CONTROL_PLANE_DB set.

### P2-07: Error `as Error` casts without type narrowing
- **File**: `packages/security/keyRotation.ts:157,359,367,377`
- **Category**: Type
- **Violation**: Multiple catch blocks cast `error as Error` without checking `instanceof Error` first. Per codebase conventions (CLAUDE.md), catch parameters must be `unknown` and should use `getErrorMessage(error)` from `@errors`. Examples: line 157 `logger.error('...', error as Error)`, line 359 same pattern.
- **Fix**: Replace `error as Error` with proper narrowing:
  ```typescript
  logger.error('message', error instanceof Error ? error : new Error(String(error)));
  ```
  (Some call sites already do this correctly, e.g., lines 132, 324. The pattern is inconsistent.)
- **Risk**: If a non-Error is thrown (string, object), the logger may crash or produce garbled output.

### P2-08: `hashKey` uses 64-bit truncated SHA-256
- **File**: `packages/security/keyRotation.ts:505-507`
- **Category**: Security
- **Violation**: `createHash('sha256').update(key).digest('hex').slice(0, 16)` truncates to 64 bits. While used only for identification (not security), the birthday paradox gives ~50% collision at 2^32 (~4 billion) keys. For a key rotation system tracking at most hundreds of providers, this is technically safe, but violates defense-in-depth.
- **Fix**: Use at least 128 bits (32 hex chars): `.slice(0, 32)`.
- **Risk**: Theoretical collision in key identification. Rotation events could reference the wrong key.

### P2-09: `setMaxListeners(50)` masks potential memory leaks
- **File**: `packages/security/keyRotation.ts:101`
- **Category**: Architecture
- **Violation**: `this.setMaxListeners(50)` suppresses the Node.js memory leak warning for >10 listeners. If callers attach listeners (e.g., `.on('keyRotated', ...)`) without removing them, the leak goes undetected up to 50 listeners.
- **Fix**: Document expected listener count. Use `once()` for one-shot listeners. Add cleanup in `stop()`:
  ```typescript
  stop(): void {
    this.removeAllListeners();
    // ... clear intervals
  }
  ```
- **Risk**: Slow memory leak from accumulated event listeners over process lifetime.

### P2-10: Unbounded salt mutex map growth
- **File**: `packages/security/keyRotation.ts:200-206`
- **Category**: Performance
- **Violation**: `getSaltMutex()` creates a new `Mutex` per provider and stores it in `this.saltMutexes`, but never cleans up. If many providers are registered and revoked over the process lifetime, the map grows without bound.
- **Fix**: Delete mutex in `revokeKey()`:
  ```typescript
  async revokeKey(provider: string): Promise<void> {
    this.keys.delete(provider);
    this.providerSalts.delete(provider);
    this.saltMutexes.delete(provider);  // Add this
    this.derivedKeyCache.delete(provider);
    // ...
  }
  ```
- **Risk**: Minor memory leak. Each Mutex is small, but principle of clean resource management.

### P2-11: Duplicated `UUID_RE` regex across three frontend pages
- **File**: `apps/web/pages/domains/[id]/keywords-map.tsx:35`, `keywords-decay.tsx:25`, `keywords.tsx:39`
- **Category**: Architecture
- **Violation**: `const UUID_RE = /^[0-9a-f]{8}-...$/i` is copy-pasted identically in all three files. Violates DRY principle and risks inconsistent updates.
- **Fix**: Extract to a shared utility: `packages/kernel/validation/uuid.ts` (which likely already has UUID validation).
- **Risk**: If the regex needs updating (e.g., to restrict UUID version), three files must be changed in sync.

### P2-12: Frontend keyword pages are stub implementations
- **File**: `apps/web/pages/domains/[id]/keywords.tsx`, `keywords-map.tsx`, `keywords-decay.tsx`
- **Category**: Architecture
- **Violation**: All three pages render hardcoded placeholder content (`<li>example keyword suggestion</li>`, `<li>example keyword — decay detected</li>`). Forms have no `action`, `method`, or event handlers. Buttons have no `onClick`. If deployed, users see non-functional UI.
- **Fix**: Either implement the pages with real data fetching (TanStack Query) and form handlers, or gate them behind a feature flag.
- **Risk**: Users encounter broken functionality. "Run ingestion" and "Map" buttons do nothing, creating a poor user experience and potential support burden.

### P2-13: `knexfile.ts` production config duplicates env var read
- **File**: `knexfile.ts:39-45`
- **Category**: Architecture
- **Violation**: The production config calls `getBaseConfig()` (which reads `process.env['CONTROL_PLANE_DB']`) and then separately reads `process.env['CONTROL_PLANE_DB']` in the override object. If an env var mutation occurred between the two reads (theoretically possible in test setups), they'd diverge. The `pool` settings from `getBaseConfig()` would use one connection string while the overridden `connection` block uses another.
- **Fix**: Capture the value once:
  ```typescript
  production: (() => {
    const base = getBaseConfig();
    return {
      ...base,
      connection: { ...base.connection, ssl: { ... } },
    };
  })(),
  ```
- **Risk**: Low probability but undefined behavior if env vars change during module initialization.

---

## Low (P3) — Style, nitpicks, perfectionist ideals

### P3-01: `keyRotation.ts` exceeds 300-line limit (552 lines)
- **File**: `packages/security/keyRotation.ts`
- **Category**: Architecture
- **Violation**: At 552 lines, this file violates the project's 300-line Single Responsibility guideline. It handles encryption, key management, scheduling, alerting, database operations, and event emission.
- **Fix**: Extract into separate modules: `KeyEncryption` (encrypt/decrypt/deriveKey), `KeyScheduler` (start/stop/check intervals), `KeyStore` (database operations).
- **Risk**: Maintainability. Complex file is harder to review, test, and modify safely.

### P3-02: No logging in `keywords.ts`
- **File**: `apps/api/src/keywords/keywords.ts`
- **Category**: Observability
- **Violation**: Neither `keywordCoverageForDomain` nor `upsertKeyword` has any logging. Failed queries propagate as raw database errors with no structured log entry. Per CLAUDE.md, all files should use `getLogger()`.
- **Fix**: Add structured logging:
  ```typescript
  const logger = getLogger('keywords');
  ```
- **Risk**: Blind spot in observability. Database errors in keyword operations are invisible to monitoring.

### P3-03: Template literal interpolation in log messages
- **File**: `packages/security/keyRotation.ts:265`
- **Category**: Observability
- **Violation**: `logger.info(\`[KeyRotation] Key for ${provider} expires in ${daysUntilExpiry.toFixed(1)} days, rotating...\`)` uses template interpolation instead of structured data. This prevents log aggregation and search by field.
- **Fix**: Use structured logging:
  ```typescript
  logger.info('[KeyRotation] Key expiring, rotating', { provider, daysUntilExpiry: daysUntilExpiry.toFixed(1) });
  ```
- **Risk**: Log search and aggregation by provider requires regex parsing instead of field filtering.

### P3-04: Frontend props use `string` instead of branded `DomainId`
- **File**: `apps/web/pages/domains/[id]/keywords.tsx:7`, `keywords-map.tsx:7`, `keywords-decay.tsx:7`
- **Category**: Type
- **Violation**: `domainId: string` in props interfaces should use branded `DomainId` type for consistency with the rest of the codebase.
- **Fix**: `import type { DomainId } from '@kernel/branded'; interface KeywordsProps { domainId: DomainId; }`
- **Risk**: Cosmetic. Type confusion possible but mitigated by UUID regex validation in `getServerSideProps`.

### P3-05: `unsafe` type assertion in `upsertKeyword` return
- **File**: `apps/api/src/keywords/keywords.ts:79`
- **Category**: Type
- **Violation**: `return rows[0] as KeywordRow | undefined` uses `as` type assertion. Knex's `.returning()` returns a loosely typed array. The assertion assumes the returned columns match `KeywordRow` exactly, but if the table schema changes (e.g., column added), the assertion silently lies.
- **Fix**: Use a runtime type guard or Zod schema to validate the returned row:
  ```typescript
  const row = rows[0];
  if (row && isKeywordRow(row)) return row;
  return undefined;
  ```
- **Risk**: Runtime type mismatch if schema drifts from TypeScript interface. Low probability with current migration discipline.

### P3-06: Error over-redaction in rotation failure
- **File**: `packages/security/keyRotation.ts:314`
- **Category**: Observability
- **Violation**: `rawMsg.replace(/[0-9a-f]{16,}/gi, '[REDACTED]')` redacts any hex string >= 16 chars. This also redacts UUIDs, SHA hashes, and request IDs, making error messages unhelpful for debugging.
- **Fix**: Be more targeted — only redact strings matching known key patterns:
  ```typescript
  rawMsg.replace(/\b(sk-[0-9a-f]{48}|AKIA[A-Z0-9]{16}|key_[0-9a-f]{64})\b/gi, '[REDACTED]')
  ```
- **Risk**: Over-redacted error messages obscure root cause during incident response.

### P3-07: Test mocks bypass real concurrency protection
- **File**: `packages/security/__tests__/keyRotation.security.test.ts:24-30`
- **Category**: Testability
- **Violation**: `jest.mock('async-mutex', ...)` replaces the real `Mutex` with a no-op. The tests never verify that concurrent salt initialization is actually serialized. The P0-02 race condition discovered in this audit would not be caught by these tests.
- **Fix**: Add an integration test (or at least a unit test with real Mutex) that fires `ensureProviderSalt` concurrently for the same provider and verifies only one salt is persisted.
- **Risk**: False confidence in concurrency safety. Tests pass while the race condition exists.

### P3-08: `knexfile.ts` pool `min: 1` wasteful for migration runner
- **File**: `knexfile.ts:28`
- **Category**: Performance
- **Violation**: `pool: { min: 1, max: 5 }` keeps a minimum of 1 connection alive even when the migration runner is idle. Migrations are transient; no connection needs to be held between runs.
- **Fix**: `pool: { min: 0, max: 5 }`.
- **Risk**: One wasted database connection per migration invocation. Negligible in isolation but adds up in CI with many parallel migration checks.

---

## Immediate Production Incident Ranking

If all this code were deployed and activated today (specifically, if `KeyRotationManager` is instantiated in a production multi-replica deployment), the following would cause immediate incidents:

| Rank | Issue | Incident Type | Blast Radius | Time to Impact |
|------|-------|--------------|--------------|----------------|
| 1 | **P0-02** Salt race | **Data loss**: encrypted keys unrecoverable | All providers initializing during concurrent startup | Seconds (during rolling deploy) |
| 2 | **P0-01** Invalidation race | **Auth failures**: keys invalidated multiple times, side effects duplicated | All providers with pending invalidation | Within 1 hour (invalidation interval) |
| 3 | **P0-03** Plaintext in memory | **Security breach**: all API keys exposed via memory dump | Every registered provider key | Persistent (entire process lifetime) |
| 4 | **P1-01** Public `deriveKey` | **Key extraction**: any importing module can read AES keys | All encrypted data | Immediate (requires code access) |
| 5 | **P1-06** Locale normalization | **Data corruption**: duplicate keywords bypass unique constraint | All non-ASCII keyword phrases | Gradual (as international users onboard) |
| 6 | **P1-05** Missing FK | **Orphaned data**: keyword records survive domain deletion | All keywords for deleted domains | Gradual (as domains are deleted) |
| 7 | **P1-09** No phrase validation | **DoS**: multi-MB keyword insert crashes normalization | Any unauthenticated insert path | Immediate (if endpoint exposed) |

**Note**: The `KeyRotationManager` is currently exported but not instantiated in production code. P0-01 and P0-02 become active the moment `new KeyRotationManager(pool)` is added to the application startup. P0-03 is latent but activates on first `registerKey()` call.
