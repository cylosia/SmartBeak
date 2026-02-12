# TypeScript Structure Review: `packages/security/` & `packages/kernel/`

**Reviewed**: 2026-02-12
**Scope**: `packages/security/` (8 source files) and `packages/kernel/` (~37 source files)
**tsconfig**: `strict: true`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, ES2022/ESM

---

## Summary

Both packages are well-architected with clear DDD-inspired structure, comprehensive type safety via branded types, and strong security patterns (constant-time comparison, SSRF protection, tamper-evident audit logging). The main structural issues are: (1) inconsistent section ordering within files — types and constants defined *after* the functions that use them, imports split across the file; (2) duplicate `AuthContext`/`UserRole`/`roleHierarchy` definitions across `packages/security/` and `packages/types/`; (3) empty or redundant default exports in 3 security files; and (4) pervasive bracket-notation property access and changelog-style comments that obscure actual code intent.

---

## File Structure Score: 6 / 10

Section ordering is mostly correct but violated in several key files; types are well-centralized in `kernel/validation` but duplicated in `security/auth.ts`; barrel files (`kernel/index.ts`, `security/index.ts`, `kernel/validation/index.ts`) are well-organized with explicit named exports. However, inconsistent class-body indentation (`audit.ts` at column 0), empty `export default {}` blocks, mid-file type definitions, and import ordering violations across 4 security files drag the score down.

---

## Issues & Recommendations

### P0 — Must Fix

#### P0-1: Duplicate `AuthContext` / `UserRole` / `roleHierarchy` across packages

`packages/security/auth.ts:355-368` defines its own `AuthContext` interface, `UserRole` type (via Zod), and `roleHierarchy` constant. Meanwhile, `packages/types/auth.ts:11-17` defines a separate "canonical" `AuthContext`, `UserRole` literal union, and identical `roleHierarchy` at lines 27-32. The `packages/security/jwt.ts:58-63` defines yet a *third* `AuthContext`.

Additionally, `packages/security/auth.ts:344-346` exports `hasRequiredRole(userRole, requiredRole)` (single-role signature) while `packages/types/auth.ts:98-102` exports `hasRequiredRole(ctx, minRole)` (context-based signature). These are **different functions with the same name** — consumers importing from different paths get different behavior.

The `packages/security/index.ts` re-exports from both `./jwt` and `./auth`, meaning both `AuthContext` definitions are available from the same barrel.

```
packages/security/auth.ts:355   →  export interface AuthContext { userId, orgId, roles, sessionId?, requestId? }
packages/security/jwt.ts:58     →  export interface AuthContext { userId, orgId, roles, sessionId? }  // missing requestId
packages/types/auth.ts:11       →  export interface AuthContext { userId, orgId, roles, sessionId?, requestId? }
```

**Fix**: Delete `AuthContext`, `UserRole`, `roleHierarchy`, and `hasRequiredRole` from `packages/security/auth.ts`. Delete `AuthContext` from `packages/security/jwt.ts`. Import and re-export from `@types/auth` as the single source of truth.

---

#### P0-2: Unhandled floating promise in `SecurityAlertManager.checkSuspiciousActivity`

`packages/security/security.ts:284-291` calls `this.triggerAlert(...)` which is an `async` method returning `Promise<void>`, but the call site does not `await` it and does not handle the returned promise. This is a fire-and-forget that silently swallows rejections.

```typescript
// packages/security/security.ts:284-291
if (failedAttempts >= 5) {
  this.triggerAlert(          // <-- Promise<void> not awaited
    'high',
    'multiple_failed_attempts',
    `User ${userId} has ${failedAttempts} failed attempts in the last hour`,
    { failedAttempts, recentEvents: userAlerts },
  );
}
```

This should be caught by `@typescript-eslint/no-floating-promises: 'error'` in `.eslintrc.cjs:55`, but `checkSuspiciousActivity` is a synchronous `void` method, so the float escapes the rule.

**Fix**: Either make the method `async` and `await` the calls, or explicitly mark as intentional with `void this.triggerAlert(...)`.

```diff
-  checkSuspiciousActivity(
+  async checkSuspiciousActivity(
   userId: string,
   event: { type: string; ip: string; userAgent: string }
-  ): void {
+  ): Promise<void> {
   ...
   if (failedAttempts >= 5) {
-    this.triggerAlert(
+    await this.triggerAlert(
```

---

#### P0-3: `AuditLogger` class body at column 0

`packages/security/audit.ts:85-674` — Every method, property, and nested block inside the `AuditLogger` class is indented at column 0 (i.e., flush with the `export class AuditLogger` declaration). The `SecurityAlertManager` in `security.ts:58-309` has the same issue.

This is inconsistent with the rest of the codebase (e.g., `kernel/retry.ts:322` `CircuitBreaker` uses standard 2-space class indentation) and makes the code significantly harder to read.

**Fix**: Re-indent the entire class body with 2-space indentation. This is a formatter fix — running `prettier --write packages/security/audit.ts packages/security/security.ts` should resolve it.

---

#### P0-4: Empty / redundant default exports

Three files in `packages/security/` have default exports that serve no purpose:

| File | Line | Export |
|------|------|--------|
| `ssrf.ts` | 539 | `export default {};` |
| `input-validator.ts` | 571 | `export default {};` |
| `logger.ts` | 488 | `export default { sanitizeForLogging, createLogEntry, ... }` |

The first two export empty objects. The third re-exports the same functions already exported as named exports, creating two import paths for the same symbols. All three hurt tree-shaking and confuse consumers about the intended import style.

**Fix**: Remove all three `export default` blocks.

```diff
--- a/packages/security/ssrf.ts
+++ b/packages/security/ssrf.ts
@@ -537,4 +537,0 @@
-
-// Default export
-export default {
-};
```

```diff
--- a/packages/security/input-validator.ts
+++ b/packages/security/input-validator.ts
@@ -569,4 +569,0 @@
-
-// Export all utilities
-export default {
-};
```

```diff
--- a/packages/security/logger.ts
+++ b/packages/security/logger.ts
@@ -486,12 +486,0 @@
-
-// Default export
-export default {
-  sanitizeForLogging,
-  createLogEntry,
-  sanitizeHeaders,
-  sanitizeUrl,
-  sanitizeErrorMessage,
-  SecureLogger,
-  logger,
-};
```

---

### P1 — Should Fix

#### P1-1: Import ordering violations

Four files in `packages/security/` mix Node builtins, external dependencies, and internal imports without consistent grouping:

**`security.ts:1-7`**:
```typescript
import { EventEmitter } from 'events';          // builtin
import { getLogger, getRequestContext } from '@kernel/logger';  // internal alias
import { LRUCache } from '../utils/lruCache';    // relative
import crypto from 'crypto';                     // builtin (should be first!)
```

**`audit.ts:1-7`**:
```typescript
import { EventEmitter } from 'events';          // builtin
import { Pool } from 'pg';                      // external
import { getLogger } from '@kernel/logger';     // internal
import crypto from 'crypto';                    // builtin (should be first!)
```

**`keyRotation.ts:1-6`**:
```typescript
import { pbkdf2Sync, randomBytes, ... } from 'crypto';  // builtin
import { EventEmitter } from 'events';                   // builtin
import { LRUCache } from '../utils/lruCache';            // relative (between builtins!)
import { Pool } from 'pg';                               // external
import { getLogger } from '@kernel/logger';              // internal
import { Mutex } from 'async-mutex';                     // external (should be with pg)
```

**Fix**: Enforce consistent order: builtins, then external, then internal aliases, then relative. Add `eslint-plugin-import` with the `import/order` rule:

```json
"import/order": ["warn", {
  "groups": ["builtin", "external", "internal", "parent", "sibling"],
  "newlines-between": "always"
}]
```

---

#### P1-2: Types and constants defined after the functions that use them

`packages/security/auth.ts` places its core types and constants *after* all exported functions:

```
Line 34:   export interface FastifyAuthContext { ... }
Line 52:   export async function requireAuthNextJs(...) { ... }  // uses BEARER_REGEX, AuthContext, UserRole
...
Line 346:  export function hasRequiredRole(...) { ... }
Line 352:  const BEARER_REGEX = ...           // <-- should be near top
Line 355:  export interface AuthContext { ... } // <-- should be near top
Line 367:  const UserRoleSchema = ...           // <-- should be near top
Line 368:  export type UserRole = ...           // <-- should be near top
```

**Fix**: Move `BEARER_REGEX`, `AuthContext`, `UserRole`, `UserRoleSchema`, and `roleHierarchy` to the section immediately after imports, before any exported functions.

---

#### P1-3: `Record<string, any>` with eslint-disable comments

| File | Line | Usage |
|------|------|-------|
| `security.ts` | 41 | `details: Record<string, any>` |
| `security.ts` | 193 | `details: Record<string, any> = {}` |
| `audit.ts` | 216 | `details?: Record<string, any>` |
| `audit.ts` | 234 | `details?: Record<string, any>` |

All four have `// eslint-disable-next-line @typescript-eslint/no-explicit-any`.

**Fix**: Replace with `Record<string, unknown>`. Callers can use type narrowing or `as` casts at the call site if needed.

```diff
--- a/packages/security/security.ts
+++ b/packages/security/security.ts
@@ -39,3 +39,2 @@
   message: string;
-  // eslint-disable-next-line @typescript-eslint/no-explicit-any
-  details: Record<string, any>;
+  details: Record<string, unknown>;
 }
```

---

#### P1-4: Bracket notation where dot notation suffices

Throughout both packages, property access on statically-typed objects uses bracket notation `obj["prop"]` instead of dot notation `obj.prop`. This appears to be a workaround for `noPropertyAccessFromIndexSignature`, but these types have known properties (not index signatures):

| File | Example | Type |
|------|---------|------|
| `audit.ts:197` | `this.logger["error"](...)` | Logger (known method) |
| `audit.ts:318` | `e.actor["ip"]` | `AuditEvent['actor']` (known field) |
| `retry.ts:184` | `error["message"]` | `Error` (known property) |
| `retry.ts:461` | `logger["error"](...)` | Logger |
| `event-bus.ts:65` | `this.logger["error"](...)` | Console |
| `safe-handler.ts:56` | `error["message"]` | `Error` |
| `auth.ts:83,96,149,161` | `claims["orgId"]` | JWT claims (Zod-validated) |

**Fix**: Use dot notation for all statically-typed properties. Only use bracket notation for true index-signature access.

---

#### P1-5: Unsafe `error as Error` casts

`packages/security/keyRotation.ts` has 5 instances of `logger.error('...', error as Error)` without checking `instanceof`:

```typescript
// keyRotation.ts:157
logger.error('[KeyRotation] Initial check failed:', error as Error);  // error could be anything
```

The safe pattern already exists elsewhere in the codebase:

```typescript
// retry.ts:239
const err = error instanceof Error ? error : new Error(String(error));
```

**Fix**: Use the safe pattern consistently:

```diff
-logger.error('[KeyRotation] Initial check failed:', error as Error);
+logger.error('[KeyRotation] Initial check failed:', error instanceof Error ? error : new Error(String(error)));
```

---

#### P1-6: Branded type factory duplication

`packages/kernel/branded.ts:156-281` contains 10 nearly-identical factory functions:

```typescript
export function createOrgId(value: string): OrgId {
  if (!value || typeof value !== 'string') { throw new TypeError('OrgId must be a non-empty string'); }
  if (!isValidUuid(value)) { throw new TypeError(`OrgId must be a valid UUID, got: ${value}`); }
  return value as OrgId;
}
// ... 9 more identical functions with only the type name changed
```

`packages/kernel/validation/branded.ts` has 18 more such factories (e.g., `createPublishingJobId`, `createNotificationId`, etc.).

**Fix**: Create a generic factory:

```typescript
function createBrandedUuid<B>(typeName: string) {
  return (value: string): Brand<string, B> => {
    if (!value || typeof value !== 'string') {
      throw new TypeError(`${typeName} must be a non-empty string`);
    }
    if (!isValidUuid(value)) {
      throw new TypeError(`${typeName} must be a valid UUID, got: ${value}`);
    }
    return value as Brand<string, B>;
  };
}

export const createOrgId = createBrandedUuid<'OrgId'>('OrgId');
export const createUserId = createBrandedUuid<'UserId'>('UserId');
export const createDomainId = createBrandedUuid<'DomainId'>('DomainId');
// ... etc
```

---

#### P1-7: Timer leak in `safe-handler.ts`

`packages/kernel/safe-handler.ts:165-167` creates a `setTimeout` inside `Promise.race` that is never cleared:

```typescript
const timeoutPromise = new Promise<never>((_, reject) => {
  setTimeout(() => reject(new Error(`Handler timed out after ${HANDLER_TIMEOUT_MS}ms`)), HANDLER_TIMEOUT_MS);
});
await Promise.race([handler(), timeoutPromise]);
```

If the handler resolves quickly, the 60-second timeout timer continues running until it fires, wastes memory, and calls `reject()` on an already-settled promise.

**Fix**:

```diff
+let timeoutId: NodeJS.Timeout;
 const timeoutPromise = new Promise<never>((_, reject) => {
-  setTimeout(() => reject(new Error(`Handler timed out after ${HANDLER_TIMEOUT_MS}ms`)), HANDLER_TIMEOUT_MS);
+  timeoutId = setTimeout(() => reject(new Error(`Handler timed out after ${HANDLER_TIMEOUT_MS}ms`)), HANDLER_TIMEOUT_MS);
 });
-await Promise.race([handler(), timeoutPromise]);
+try {
+  await Promise.race([handler(), timeoutPromise]);
+} finally {
+  clearTimeout(timeoutId!);
+}
```

---

#### P1-8: Unused `_commentBuffer` variable

`packages/security/input-validator.ts:110` declares `let _commentBuffer = ''` which is only written to (lines 121, 128, 131) but never read. The comment-detection logic only needs the `inComment` boolean.

**Fix**: Remove the variable and all assignments to it.

---

#### P1-9: Dead `_assertNever` function

`packages/kernel/safe-handler.ts:41-43` defines:

```typescript
function _assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}
```

This is never called. The file's actual exhaustiveness pattern at line 72 uses a different approach (`const category: ErrorCategory = 'unknown'`).

**Fix**: Delete the function.

---

### P2 — Nice to Have

#### P2-1: Excessive changelog-style comments

Nearly every file has verbose inline comments like:

```
// P0-FIX: Delegate to packages/security/jwt.ts verifyToken instead of maintaining a
// separate implementation. Previously this function only tried JWT_KEY_1 || JWT_SECRET
// (single key, no rotation support), while jwt.ts tried all keys from getCurrentKeys()...
```

These are commit messages embedded in code. They describe *what changed* and *what the old code did*, which belongs in git history.

**Fix**: Replace with brief comments explaining *why the code works this way*, e.g.:

```typescript
// Delegate to jwt.ts which handles key rotation and Zod validation
function verifyToken(token: string) { ... }
```

#### P2-2: Missing `import type` for type-only imports

| File | Import | Used as |
|------|--------|---------|
| `keyRotation.ts:4` | `import { Pool } from 'pg'` | Type annotation only |
| `audit.ts:2` | `import { Pool } from 'pg'` | Type annotation only |
| `event-bus.ts:1` | `import { DomainEventEnvelope } from '../types/domain-event'` | Type positions only |

**Fix**: Convert to `import type { Pool } from 'pg'` etc. to keep runtime bundles clean.

#### P2-3: Validation barrel already well-organized (Style/Convention)

`packages/kernel/validation/index.ts` uses clear `export type { ... }` blocks and section headers. The mixed type/value exports in lines 66-100 are acceptable since they're factory functions alongside their type guards.

#### P2-4: Unused type parameter on `EventBus.unsubscribe`

`packages/kernel/event-bus.ts:80`: `unsubscribe<_T>(eventName: string, plugin: string): void` — the `_T` parameter is never referenced.

**Fix**: Remove the type parameter: `unsubscribe(eventName: string, plugin: string): void`.

#### P2-5: `AuditLogger.query` parameter shadows method-style name (Style/Convention)

`packages/security/audit.ts:373`: The method is `async query(query: AuditQuery)` — the parameter shadows the method name conceptually.

**Fix**: Rename to `filter` or `criteria`.

#### P2-6: Inconsistent error emission shapes in `KeyRotationManager`

```typescript
// keyRotation.ts:133 — emits object with phase/error
this.emit('error', { phase: 'initialCheck', error: err });

// keyRotation.ts:325 — emits Error instance
this.emit('error', new Error(`Rotation failed for ${provider}: ${errorMsg}`));

// keyRotation.ts:360 — emits object with phase/provider/error
this.emit('error', { phase: 'invalidation', provider: row.provider, error });
```

**Fix**: Standardize on `{ phase: string; provider?: string; error: Error }` shape.

#### P2-7: Module-level mutable `retryHistory` map (Style/Convention)

`packages/kernel/retry.ts:78`: `const retryHistory = new Map<string, RetryHistoryEntry>()` is module-level mutable state shared across all callers. Consider moving to a class for testability.

---

## Proposed File Layout

Standard section ordering recommended for all files in both packages:

```
1. Header comment
   - Module purpose (1-3 lines)
   - NO changelog entries (use git)

2. Imports (grouped with blank lines between groups)
   a. Node builtins         (crypto, events, url, dns, os, etc.)
   b. External deps         (pg, zod, async-mutex, jsonwebtoken, etc.)
   c. Internal aliases      (@kernel/*, @types/*, @config, etc.)
   d. Relative imports      (./*,  ../*)
   e. Type-only imports interspersed with their group using `import type`

3. Constants & Configuration
   - Regex patterns, magic numbers, timeouts, thresholds
   - `as const` assertions where appropriate

4. Types & Interfaces
   - Exported types first
   - Private/internal types after

5. Main Exported API
   - Primary classes and functions (public interface)
   - Clear, intentional named exports

6. Private Helpers / Utilities
   - Internal functions used by the main API

7. Module Side Effects (if unavoidable)
   - Singleton instances, setInterval, etc.
   - Clearly commented as side effects

8. NO default exports
   - Unless framework requires it (Next.js pages, Storybook)
```

### Files Needing Reorder

| File | What to move |
|------|--------------|
| `security/auth.ts` | Move `BEARER_REGEX`, `AuthContext`, `UserRole`, `UserRoleSchema`, `roleHierarchy` from lines 334-368 to after imports |
| `security/keyRotation.ts` | Reorder imports: builtins first, then external, then internal |
| `security/audit.ts` | Reorder imports; re-indent class body to 2-space |
| `security/security.ts` | Reorder imports: `crypto` before `EventEmitter`; re-indent class bodies |

---

## Suggested Patch

The most impactful, safe, minimal changes covering P0-4, P1-7, P1-8, and P1-9:

```diff
diff --git a/packages/security/ssrf.ts b/packages/security/ssrf.ts
--- a/packages/security/ssrf.ts
+++ b/packages/security/ssrf.ts
@@ -536,5 +536,0 @@
-
-// Default export
-export default {
-};

diff --git a/packages/security/input-validator.ts b/packages/security/input-validator.ts
--- a/packages/security/input-validator.ts
+++ b/packages/security/input-validator.ts
@@ -108,3 +108,2 @@
   let inTag = false;
   let inComment = false;
-  let _commentBuffer = '';

@@ -119,2 +118,1 @@
       inComment = true;
-      _commentBuffer = '<!--';
       i += 3;
@@ -127,2 +125,1 @@
     if (inComment) {
-      _commentBuffer += char;
       if (char === '>' && prevChar === '-' && input[i - 2] === '-') {
         inComment = false;
-        _commentBuffer = '';
       }

@@ -566,5 +562,0 @@
-
-// Export all utilities
-export default {
-};

diff --git a/packages/kernel/safe-handler.ts b/packages/kernel/safe-handler.ts
--- a/packages/kernel/safe-handler.ts
+++ b/packages/kernel/safe-handler.ts
@@ -38,8 +38,0 @@
-/**
-* Assert never for exhaustiveness checking
-* @param value - Value that should never exist
-* @throws Error with the unexpected value
-*/
-function _assertNever(value: never): never {
-  throw new Error(`Unexpected value: ${String(value)}`);
-}
-
@@ -163,6 +155,8 @@
+    let timeoutId: NodeJS.Timeout;
     const timeoutPromise = new Promise<never>((_, reject) => {
-    setTimeout(() => reject(new Error(`Handler timed out after ${HANDLER_TIMEOUT_MS}ms`)), HANDLER_TIMEOUT_MS);
+    timeoutId = setTimeout(() => reject(new Error(`Handler timed out after ${HANDLER_TIMEOUT_MS}ms`)), HANDLER_TIMEOUT_MS);
     });

-    await Promise.race([handler(), timeoutPromise]);
+    try {
+      await Promise.race([handler(), timeoutPromise]);
+    } finally {
+      clearTimeout(timeoutId!);
+    }
```

---

## Consistency Notes

### Inferred file layout pattern
The project follows a **barrel-export monorepo** pattern: each package has an `index.ts` barrel with explicit named exports. Internal modules use relative imports; cross-package imports use TypeScript path aliases (`@kernel/*`, `@security/*`, `@types/*`). The kernel package is the most disciplined — its `index.ts` and `validation/index.ts` barrels are well-organized with section headers and `export type` separation.

### Assumptions made
- **Formatter**: Prettier is expected but not confirmed via config. The column-0 indentation in `audit.ts` and `security.ts` suggests these files were never auto-formatted.
- **ESLint**: `.eslintrc.cjs` confirms `@typescript-eslint/no-floating-promises: 'error'` and `@typescript-eslint/no-explicit-any: 'warn'`. Test files relax `any` and `!` rules.
- **Module system**: ESM (`"module": "ESNext"` in tsconfig). No CommonJS patterns detected.
- **Framework**: Fastify for API (module augmentation in `auth.ts:43-47`), Next.js for web. React Query hooks use named exports.

### What to check next
1. **Run `prettier --check packages/security/ packages/kernel/`** to confirm which files have formatting drift
2. **Run `eslint --report-unused-disable-directives`** on both packages to find stale `eslint-disable` comments
3. **Audit `packages/types/auth.ts` consumers** — verify no code imports `AuthContext` from `packages/security/auth.ts` or `packages/security/jwt.ts` instead of from `@types/auth`
4. **Check `import type` coverage** — run `@typescript-eslint/consistent-type-imports` rule across both packages
5. **Review `packages/kernel/validation/branded.ts` vs `packages/kernel/branded.ts`** — two separate branded-type files exist with overlapping but different type sets; these should be consolidated
