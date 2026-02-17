# Code Review — SmartBeak (2026-02-17)

Reviewed by: Claude Code (claude-sonnet-4-6)
Branch: `claude/code-review-SR4ig`

---

## Executive Summary

The codebase has strong fundamentals: strict TypeScript, comprehensive Zod validation on every
route, fully parameterised SQL, Redis-backed rate limiting, and a clean DDD layer separation.
The items below are the gaps that remain. None are catastrophic, but two (H1, H2) can cause
silent data loss or unhandled rejections in production.

---

## Findings by Severity

### HIGH — Must Fix

#### H1 · `control-plane/api/routes/diligence.ts` — Error-handling gap (lines 23–24, 93–94)

Both handlers invoke `TokenParamSchema.parse(req.params)` (throws `ZodError`) and
`await rateLimit('diligence', 30)` (throws on Redis failure) **before** the surrounding `try`
block. Any failure here produces an unhandled rejection rather than a structured HTTP response.

**Fix:** Move both calls inside `try`; replace `.parse()` with `.safeParse()`:
```typescript
try {
  const paramsResult = TokenParamSchema.safeParse(req.params);
  if (!paramsResult.success) {
    return errors.badRequest(res, 'Invalid token', ErrorCodes.INVALID_PARAMS);
  }
  const { token } = paramsResult.data;
  await rateLimit('diligence', 30);
  // ... existing handler body
} catch (error) { ... }
```
Apply identically to both `/overview` and `/affiliate-revenue` handlers.

---

#### H2 · `control-plane/services/container.ts` — Silent publish stub in production (lines 241–254)

`createPublishAdapter()` returns a no-op `PublishAdapter` when `FACEBOOK_PAGE_TOKEN` is unset.
The stub resolves without error, so every Facebook publish silently disappears with no alert,
no retry, and no failure surface to operators.

```typescript
// Current — dangerous in production:
return {
  publish: async () => {
    logger.info('FacebookAdapter stub: publish called but no token configured');
  }
};
```

**Fix:** Throw `ServiceUnavailableError` in production; keep stub for dev/test only:
```typescript
private createPublishAdapter(): PublishAdapter {
  const token = process.env['FACEBOOK_PAGE_TOKEN'];
  if (!token) {
    if (process.env['NODE_ENV'] === 'production') {
      throw new ServiceUnavailableError('FACEBOOK_PAGE_TOKEN is not configured');
    }
    logger.warn('FACEBOOK_PAGE_TOKEN not set — using no-op stub (non-production)');
    return { publish: async () => { logger.info('FacebookAdapter stub called'); } };
  }
  return new FacebookAdapter(token);
}
```
Add `import { ServiceUnavailableError } from '@errors';`.

---

#### H3 · `control-plane/api/routes/seo.ts` — Weak ownership check + invalid SQL (lines 19–28)

Two bugs in `verifyContentOwnership`:

1. **Invalid SQL identifier** — `c["id"]` is JavaScript bracket notation inside a raw SQL string.
   PostgreSQL interprets `["id"]` as an array subscript operator, not an identifier quote. This
   will error or silently return no rows.

2. **Incomplete ownership chain** — The join goes `contents → memberships` directly on `org_id`.
   This skips the `domains` table, meaning the check relies on a denormalised `contents.org_id`
   column being consistent. The canonical chain is `contents → domains → memberships`.

```sql
-- Current (broken):
SELECT 1 FROM contents c
JOIN memberships m ON m.org_id = c.org_id
WHERE c["id"] = $1 AND m.user_id = $2

-- Fixed:
SELECT 1
FROM contents c
JOIN domains d ON c.domain_id = d.id
JOIN memberships m ON m.org_id = d.org_id
WHERE c.id = $1 AND m.user_id = $2
LIMIT 1
```

---

#### H4 · `control-plane/services/publishing-create-job.ts` — Rollback error swallowed (lines 87–91)

```typescript
} catch (rollbackError) {
  // Rollback error - already in error handling, cannot recover
}
```

A failed rollback leaves the transaction open, holding row locks and potentially blocking all
subsequent writes to the affected tables. The failure must be logged so operators can act.

**Fix:**
```typescript
} catch (rollbackError) {
  logger.error(
    '[PublishingCreateJobService] ROLLBACK failed — possible lock leak',
    rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError))
  );
}
```
Add at top of file:
```typescript
import { getLogger } from '@kernel/logger';
const logger = getLogger('PublishingCreateJobService');
```

---

### MEDIUM — Should Fix

#### M1 · `control-plane/api/routes/publishing.ts` — Unsafe auth type-cast (lines 27, 42, 63, 78, 107)

All five handlers use:
```typescript
const ctx = req.auth as AuthContext;
if (!ctx) { return errors.unauthorized(res); }
```
The codebase already provides `getAuthContext(req)` in `control-plane/api/types.ts`, used
consistently by `analytics.ts` and `timeline.ts`. The cast pattern bypasses that helper and is
less safe under future refactors.

**Fix** (per handler):
```typescript
import { getAuthContext } from '../types';

app.get('/publishing/targets', async (req, res) => {
  let ctx;
  try { ctx = getAuthContext(req); }
  catch { return errors.unauthorized(res); }
  requireRole(ctx, ['owner', 'admin', 'editor']);
  ...
```

---

#### M2 · `apps/api/src/db.ts` — Dead code: `_getConnectionString()` (lines 33–45)

The function duplicates the module-level `CONTROL_PLANE_DB` validation at lines 19–28, is
prefixed with `_` (indicating it is unused), and is never called anywhere. It should be deleted.

---

### LOW — Code Quality

#### L3 · SQL bracket notation in raw query strings

JavaScript bracket notation (`obj["key"]`) inside raw SQL strings is a category error — it
looks like object access but is passed verbatim to PostgreSQL as an array subscript.

| File | Line | Before | After |
|------|------|--------|-------|
| `control-plane/api/routes/analytics.ts` | 37 | `d["id"]`, `c["id"]` | `d.id`, `c.id` |
| `control-plane/api/routes/timeline.ts` | 72 | `al["id"]` | `al.id` |
| `control-plane/api/routes/timeline.ts` | 75 | `d["id"]` | `d.id` |
| `control-plane/api/routes/timeline.ts` | 163 | `al["id"]` | `al.id` |
| `control-plane/api/routes/seo.ts` | 23 | `c["id"]` | `c.id` (covered by H3) |

---

## What Is Already Good (Do Not Change)

| Area | Status |
|------|--------|
| SQL injection | All queries fully parameterised; LIKE-escaping correct in `content.ts` |
| JWT / RBAC | `requireRole()` pattern solid; dual-role bug already fixed |
| Rate limiting | Redis fail-closed with LRU fallback; namespace collision prevention correct |
| `container.ts` singletons | Plain `Map` (previous LRUCache-with-TTL eviction bug already fixed) |
| `container.ts` `SearchIndexingWorker` | `PostgresContentRepository` passed instead of `null` (NPE bug already fixed) |
| `apps/api/src/db.ts` logging | `console.log` already replaced with `logger` |
| `queue-metrics.ts` logging | Already uses `logger.error` |
| `onboarding.ts` logging | Already uses `logger.error` |
| `diligence.ts` logging | Already uses `logger` (no console calls remaining) |
| CORS / HTTPS | Origin validation and HTTPS enforcement correct in `http.ts` |
| Transaction pattern | `notifications.ts` transaction with logging in rollback catch is exemplary |

---

## Architectural Note (No Code Change in This PR)

`container.ts` line 232 uses a dynamic `require()` to break a circular ESM import for
`PostgresIndexingJobRepository`. The proper fix—extracting the shared interface to
`packages/types/`—is non-trivial and should be a separate ticket to avoid destabilising this PR.

---

## Verification Checklist

- [ ] `npm run type-check` — zero errors
- [ ] `npm run lint && npm run lint:security` — no new suppressions
- [ ] `npm run test:unit` — all green
- [ ] `npm run test:integration` — all green (`docker compose up -d` required)
- [ ] `/diligence/bad!token/overview` with Redis down → 400 (not unhandled rejection)
- [ ] `POST /seo/:id` with content from wrong org → 404
- [ ] `GET /analytics/content/:id` → no SQL error (bracket notation fixed)
- [ ] `GET /timeline` → no SQL error (bracket notation fixed)
- [ ] `NODE_ENV=production` + no `FACEBOOK_PAGE_TOKEN` → container init throws, not silent stub
