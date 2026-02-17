# Latent Bug Scan Report

**Date:** 2026-02-17
**Scope:** Full codebase — race conditions, null/undefined access, resource leaks, boundary issues, error swallowing

---

## 1. Race Conditions & Concurrency

### 1.1 Redis singleton reset races with active callers

**File:** `packages/kernel/redis.ts:38-47`

```typescript
redis.on('error', (err: Error) => {
  // ...
  if (fatalPatterns.some(p => err.message.includes(p))) {
    redis = null;  // ← resets global while callers hold stale reference
  }
});
```

**Bug:** `getRedis()` returns the instance, then the `error` event fires asynchronously and sets `redis = null`. Callers that already received the reference continue using the dead connection object. The next `getRedis()` call creates a fresh connection, but existing callers are stuck with the old one.

**Why it hasn't triggered:** Redis errors typically cause a full process restart via SIGTERM. Brief disconnects are handled by ioredis's internal retry. The window between returning the instance and the error event is narrow.

**Activation:** A recoverable Redis network blip (not a full crash) during sustained traffic — e.g. a Redis failover where the old primary becomes unreachable for a few seconds while requests are in-flight.

---

### 1.2 UsageBatcher `flushing` flag is never set — dead guard + broken public API

**File:** `control-plane/services/usage-batcher.ts:18,38,82,176-178`

```typescript
private flushing = false;  // line 18 — initialized, NEVER toggled

// line 38 — guard is always true
if (!this.flushing && this.buffer.length > 0) {
  this.flush().catch(...);
}

// line 82 — guard is always true
if (this.buffer.length >= MAX_BUFFER_SIZE * 0.8 && !this.flushing) {
  this.flush().catch(...);
}

// line 176 — always returns false
isFlushing(): boolean { return this.flushing; }
```

**Bug:** The `flushing` field is declared but never set to `true` anywhere. The `flushPromise` field was added as a replacement guard (P1-13 FIX) but `flushing` was never removed or wired up. Consequences:

1. `isFlushing()` always returns `false` — any external code relying on it gets wrong state.
2. The `!this.flushing` guards on lines 38 and 82 are no-ops, meaning the interval timer and `add()` will invoke `flush()` even when a flush is in progress. The `flushPromise` guard inside `flush()` catches this, but the unnecessary re-entrant calls waste event-loop time.

**Why it hasn't triggered:** The `flushPromise` guard in `flush()` compensates. No external code currently calls `isFlushing()` in a control-flow decision.

**Activation:** Any new code that calls `batcher.isFlushing()` to decide whether to proceed (e.g. graceful shutdown draining) would get `false` during an active flush and proceed incorrectly.

---

### 1.3 Check-then-act on `knownOrgs` Set in UsageService

**File:** `control-plane/services/usage.ts:91-94`

```typescript
if (!this.knownOrgs.has(orgId)) {
  await this.ensureOrg(orgId);   // ← yields control
  this.knownOrgs.add(orgId);
}
```

**Bug:** Two concurrent requests for the same new orgId both see `has()` return `false`, both call `ensureOrg()`, both do a database INSERT. The `ON CONFLICT DO NOTHING` in the DB prevents a crash, but the Set is unreliable and redundant INSERTs add latency.

**Why it hasn't triggered:** PostgreSQL handles the duplicate gracefully. It manifests as slightly higher DB load, not errors.

**Activation:** Burst of requests for a brand-new organization during onboarding (e.g. user signs up and immediately triggers multiple API calls).

---

### 1.4 TOCTOU in UploadMedia — check-then-insert without transaction

**File:** `domains/media/application/handlers/UploadMedia.ts:70-80`

```typescript
const existingAsset = await this.repo.getById(id);
if (existingAsset) {
  return { success: false, error: `...already exists` };
}
// gap: another request can insert with same ID here
const asset = MediaAsset.reconstitute(id, sanitizedKey, mimeType, 'uploaded');
await this.repo.save(asset);
```

**Bug:** Two concurrent uploads with the same ID both pass the existence check because neither has saved yet. The second `save()` either overwrites the first (if no UNIQUE constraint) or throws an unhandled constraint violation (caught as generic error).

**Why it hasn't triggered:** Media IDs are typically UUIDs generated client-side, making collisions astronomically unlikely in normal use.

**Activation:** API client retrying a failed upload with the same ID, or BullMQ processing a duplicate job.

---

## 2. Resource Leaks

### 2.1 Event listener accumulation in PAA health check

**File:** `control-plane/adapters/keywords/paa.ts:364-368`

```typescript
new Promise((_, reject) => {
  controller.signal.addEventListener('abort', () => {
    reject(new Error('Health check timeout'));
  });
  // ← listener never removed, no { once: true }
})
```

**Bug:** Each call to `healthCheck()` adds a new event listener to the `AbortController.signal`. When the `Promise.race` resolves via `fetchForKeyword` (the happy path), the listener remains attached. Over time, listeners accumulate.

**Why it hasn't triggered:** Health checks run infrequently (e.g. every 60s). The `controller` is function-scoped, so it becomes eligible for GC after the function returns — but only if nothing else holds a reference. If the AbortController or its signal is retained (e.g. in a closure or monitoring system), listeners pile up.

**Activation:** Long-running process calling `healthCheck()` every 30 seconds for days without restart, combined with anything that prevents the AbortController from being GC'd.

**Fix:** Add `{ once: true }` to the `addEventListener` call.

---

### 2.2 OutboxRelay silently swallows ROLLBACK errors

**File:** `packages/kernel/outbox/OutboxRelay.ts:183`

```typescript
await client.query('ROLLBACK').catch(() => {});
```

**Bug:** If the ROLLBACK fails (dead connection, network error), the error is completely discarded. The client is then released with `true` (error flag), which is correct, but the operator gets zero visibility into a potentially serious state: the transaction may be left in an unknown state on the server side if the ROLLBACK command was never received.

**Why it hasn't triggered:** ROLLBACK almost always succeeds even when the preceding query failed. Connection deaths are rare.

**Activation:** Network partition between app and database mid-transaction. The original error is re-thrown (good), but the ROLLBACK failure — which may indicate an in-doubt transaction holding locks — is invisible.

---

## 3. Null/Undefined Access

### 3.1 Non-null assertion on timestamp format assumption

**File:** `control-plane/adapters/affiliate/amazon.ts:232`

```typescript
const dateStamp = timestamp.split('T')[0]!.replace(/-/g, '');
```

**Bug:** The `!` assertion assumes the timestamp contains a `T` character. If it doesn't, `split('T')` returns a single-element array and `[0]` is the full string — which actually works. However, `[0]!` bypasses TypeScript's `noUncheckedIndexedAccess` protection, and semantically the `dateStamp` value would be wrong (it would be the full timestamp, not just the date portion).

**Why it hasn't triggered:** The caller always uses `new Date().toISOString()`, which always contains `T`.

**Activation:** Any future refactor that passes a differently-formatted timestamp (e.g. `"2026-02-17 10:30:45"` from a database column or external API). The code wouldn't crash but would produce a malformed AWS signature, causing opaque 403 errors from the Amazon PAAPI.

---

### 3.2 Rate limiter Redis result access with non-null assertion

**File:** `control-plane/api/rate-limit-read.ts:171`

```typescript
const currentCount = results[1]![1] as number;
```

**Bug:** Assumes `results` from a Redis `MULTI/EXEC` always has at least 2 elements, and that each element is a 2-element array. The `!` assertion and `as number` cast suppress both TypeScript and runtime safety. If the Redis pipeline returns a different shape (e.g. due to a script error or Redis version change), this throws at runtime.

**Why it hasn't triggered:** The Redis pipeline is deterministic — it always executes the same commands in the same order. Redis 7 has been stable.

**Activation:** Redis script modification, Redis version upgrade that changes MULTI/EXEC return format, or cluster failover that drops partial pipeline results.

---

## 4. Boundary Issues

### 4.1 Division by zero in maintenance scheduler

**File:** `packages/database/maintenance/scheduler.ts:279-280`

```typescript
const totalBloat = bloatStatus.rows.reduce((sum, r) => sum + r.count, 0);
const avgBloat = bloatStatus.rows.reduce((sum, r) => sum + (r.avg_bloat * r.count), 0) / totalBloat;
```

**Bug:** If `bloatStatus.rows` is empty, `totalBloat` is `0`, and the division produces `Infinity`. The `avgBloat` value propagates to the returned object's `average_bloat_ratio` field. Any downstream code comparing or displaying this value will behave unexpectedly.

**Why it hasn't triggered:** The query groups by bloat status categories, and production databases with tables always have at least one row. Empty databases aren't monitored.

**Activation:** Running the maintenance scheduler on a freshly created database with no user tables, or after a migration that temporarily drops all tables.

---

### 4.2 Division by zero in variance calculation

**File:** `packages/ml/predictions.ts:414-417`

```typescript
private calculateVariance(values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
  return squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
}
```

**Bug:** If `values` is empty, `values.length` is `0`, both divisions produce `NaN`. The `NaN` propagates through anomaly detection, silently disabling it.

**Why it hasn't triggered:** Callers check `data.length >= 14` before invoking the anomaly detection path. The guard is in the caller, not in this function.

**Activation:** Direct call to `calculateVariance([])` from new code, or a data-filtering step that reduces the array to empty before passing it here.

---

## 5. Error Swallowing

### 5.1 Analytics pipeline uses `process.stderr.write` instead of logger

**File:** `packages/analytics/pipeline.ts:215`

```typescript
process.stderr.write(`[...] Failed to flush keywords: ${errMsg}\n`);
```

**Bug:** Flush failures in the analytics pipeline bypass the structured logger entirely, using raw `process.stderr.write`. This means:
- No log level filtering
- No auto-redaction of sensitive data
- Not captured by log aggregation tools configured to parse structured JSON
- Invisible in monitoring dashboards

The items are re-queued (`unshift`) but if flushes keep failing, the buffer grows silently.

**Why it hasn't triggered:** Analytics flush failures are rare in production. When they do occur, operators don't see the stderr output because monitoring is configured for structured JSON logs.

**Activation:** Database connectivity issue affecting analytics writes. Flush failures would repeat, the buffer would grow, and operators would have no visibility because the errors bypass the logging infrastructure.

---

## Summary

| # | Category | File | Severity | Confidence |
|---|----------|------|----------|------------|
| 1.1 | Race condition | `packages/kernel/redis.ts:46` | High | High |
| 1.2 | Dead code / broken API | `control-plane/services/usage-batcher.ts:18` | Medium | High |
| 1.3 | Race condition | `control-plane/services/usage.ts:91` | Low | High |
| 1.4 | TOCTOU | `domains/media/application/handlers/UploadMedia.ts:70` | Medium | High |
| 2.1 | Resource leak | `control-plane/adapters/keywords/paa.ts:365` | Medium | High |
| 2.2 | Error swallowing | `packages/kernel/outbox/OutboxRelay.ts:183` | Medium | High |
| 3.1 | Fragile assertion | `control-plane/adapters/affiliate/amazon.ts:232` | Low | High |
| 3.2 | Fragile assertion | `control-plane/api/rate-limit-read.ts:171` | Low | Medium |
| 4.1 | Division by zero | `packages/database/maintenance/scheduler.ts:280` | Medium | High |
| 4.2 | Division by zero | `packages/ml/predictions.ts:415` | Low | High |
| 5.1 | Invisible errors | `packages/analytics/pipeline.ts:215` | Medium | High |
