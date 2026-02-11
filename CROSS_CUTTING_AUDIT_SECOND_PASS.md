# SmartBeak Cross-Cutting Audit - Second Pass

**Date:** 2026-02-10  
**Scope:** Entire codebase (apps/, domains/, control-plane/, packages/)  
**Focus:** Systemic patterns, not individual file issues  

---

## EXECUTIVE SUMMARY

This audit identifies **7 major cross-cutting patterns** with systemic inconsistencies across the SmartBeak codebase. These patterns affect code maintainability, type safety, security posture, and operational reliability.

| Pattern Category | Issues Found | Severity | Files Affected |
|-----------------|--------------|----------|----------------|
| Import/Dependency Consistency | 3 | 🔴 HIGH | 30+ files |
| Error Handling Patterns | 4 | 🔴 HIGH | 50+ files |
| Type Safety Consistency | 3 | 🟡 MEDIUM | 25+ files |
| Security Patterns | 2 | 🔴 HIGH | 15+ files |
| Configuration & Environment | 2 | 🟡 MEDIUM | 40+ files |
| API Contract Consistency | 2 | 🔴 HIGH | 10+ files |
| Resource Management | 3 | 🟡 MEDIUM | 20+ files |

---

## 1. IMPORT/DEPENDENCY CONSISTENCY

### Issue 1.1: Inconsistent @kernel/* Import Adoption
**Severity:** 🔴 HIGH  
**Pattern:** Mixed usage of `@kernel/*` imports vs local relative imports

**Files Affected:**
- `apps/api/src/adapters/instagram/InstagramAdapter.ts` - Uses `../../utils/config` instead of `@kernel/config`
- `apps/api/src/adapters/pinterest/PinterestAdapter.ts` - Uses `../../utils/config` instead of `@kernel/config`
- `apps/api/src/adapters/soundcloud/SoundCloudAdapter.ts` - Uses local utils instead of `@kernel/*`
- `apps/api/src/adapters/vimeo/VimeoAdapter.ts` - Uses local utils instead of `@kernel/*`
- `apps/api/src/adapters/youtube/YouTubeAdapter.ts` - Uses local utils instead of `@kernel/*`
- `apps/api/src/adapters/vercel/VercelAdapter.ts` - Uses local utils instead of `@kernel/*`
- `apps/api/src/utils/resilience.ts` - Uses `@kernel/logger` but also `../config` (local)
- `apps/api/src/utils/request.ts` - Local utils instead of `@kernel/request`
- `apps/api/src/utils/validation.ts` - Re-exports from `@kernel/validation` but also has local implementations

**Control-Plane Files (CORRECT - Using @kernel/*):**
- `control-plane/adapters/facebook/FacebookAdapter.ts` - ✅ Uses `@kernel/config`, `@kernel/request`, `@kernel/retry`, `@kernel/validation`

**Description:**
The codebase has a mix of import styles. Some files in `control-plane/` correctly use `@kernel/*` imports while equivalent files in `apps/api/src/adapters/` use relative imports to local utils. This creates:
- Code duplication between local utils and `@kernel` package
- Maintenance burden (changes needed in multiple places)
- Inconsistent behavior between adapters
- Confusion for developers on which pattern to follow

**Fix Strategy:**
1. Migrate all adapter files to use `@kernel/*` imports
2. Deprecate and remove local utility duplicates in `apps/api/src/utils/`
3. Update tsconfig paths if needed to ensure `@kernel/*` resolves correctly in all contexts
4. Add ESLint rule to enforce `@kernel/*` usage over relative imports for kernel functionality

---

### Issue 1.2: Circular Dependency Risk Between Packages
**Severity:** 🟡 MEDIUM  
**Pattern:** Potential circular imports between `@kernel`, `@packages/errors`, and application code

**Evidence:**
- `packages/errors/index.ts` imports `@kernel/logger`
- `packages/kernel/validation.ts` defines error classes that overlap with `packages/errors`
- Apps import from both packages, creating potential for circular dependencies

**Files Affected:**
- `packages/errors/index.ts` (imports `@kernel/logger`)
- `packages/kernel/validation.ts` (defines AppError, ValidationError)
- `apps/api/src/routes/*.ts` (import from both)

**Description:**
Error handling is split between `@kernel/validation` (which has error classes) and `@packages/errors` (which has comprehensive error handling). This creates confusion about which error classes to use and risks circular dependencies.

**Fix Strategy:**
1. Consolidate error handling into a single package (`@packages/errors`)
2. Have `@kernel` re-export from `@packages/errors` for backward compatibility
3. Or define clear boundaries: `@kernel` for low-level utilities, `@packages/errors` for application errors

---

### Issue 1.3: Missing @kernel Exports
**Severity:** 🟡 MEDIUM  
**Pattern:** Some utilities exist in kernel but aren't exported from index.ts

**Description:**
The `packages/kernel/index.ts` has comprehensive exports, but some submodules (like `queue/bullmq-queue.ts`, `queue/bullmq-worker.ts`) may not be consistently exported or documented.

**Fix Strategy:**
1. Audit all files in `packages/kernel/` to ensure everything intended for public use is exported
2. Add explicit exports for queue submodules
3. Document the public API surface

---

## 2. ERROR HANDLING PATTERNS

### Issue 2.1: Inconsistent Error Casting with `as Error`
**Severity:** 🔴 HIGH  
**Pattern:** Mixed error handling patterns across the codebase

**Files with `as Error` casting (40+ files):**
- `apps/web/lib/db.ts` - `err as Error`, `releaseError as Error`, `rollbackError as Error`
- `control-plane/adapters/linkedin/LinkedInAdapter.ts` - `error as Error`
- `control-plane/adapters/keywords/ahrefs.ts` - Multiple casts
- `control-plane/adapters/keywords/paa.ts` - Multiple casts
- `control-plane/adapters/affiliate/amazon.ts` - Multiple casts
- `domains/content/infra/persistence/PostgresContentRepository.ts` - `error as Error`, `pgError as Error & { code?: string }`
- `domains/content/infra/persistence/PostgresContentRevisionRepository.ts` - Multiple casts
- `domains/publishing/infra/persistence/*.ts` - Multiple casts
- `apps/api/src/routes/*.ts` - `error as Error & { code?: string }`

**Files with proper `error instanceof Error` checks:**
- `packages/errors/index.ts` - Uses proper instanceof checks
- `apps/api/src/middleware/rateLimiter.ts` - Uses proper checks

**Description:**
The codebase has inconsistent error handling patterns:
1. `error as Error` - Unsafe casting, assumes error is always Error
2. `error as Error & { code?: string }` - Pattern for PostgreSQL errors, but inconsistent
3. `error instanceof Error` - Proper type guard (rare)
4. `err instanceof Error ? err : new Error(String(err))` - Safest pattern (used in some places)

**Fix Strategy:**
1. Create a standardized error extraction utility in `@packages/errors`:
   ```typescript
   export function toError(error: unknown): Error {
     return error instanceof Error ? error : new Error(String(error));
   }
   
   export function getErrorCode(error: unknown): string | undefined {
     return (error as { code?: string }).code;
   }
   ```
2. Replace all `as Error` casts with the utility function
3. Add ESLint rule to ban `as Error` patterns

---

### Issue 2.2: Inconsistent Async Error Catching
**Severity:** 🔴 HIGH  
**Pattern:** Some async errors are silently swallowed or improperly handled

**Files Affected:**
- `control-plane/adapters/affiliate/impact.ts` - Uses `catch (error: any)` pattern
- `control-plane/adapters/affiliate/cj.ts` - Uses `catch (error: any)` pattern
- `control-plane/api/routes/content-list.ts` - Uses `catch (error: any)`
- `apps/web/pages/api/**/*.ts` - Multiple files use `catch (error: any)`
- `packages/kernel/dns.ts` - Uses `catch (error: any)`
- `packages/database/index.ts` - Uses `catch (error: any)`

**Description:**
Many files use `catch (error: any)` which disables TypeScript's type safety for errors. This pattern:
- Allows accessing properties that might not exist
- Prevents proper error narrowing
- Makes refactoring difficult

**Fix Strategy:**
1. Use `catch (error: unknown)` everywhere
2. Use type guards to narrow error types
3. Create standardized error handler utility

---

### Issue 2.3: Error Code Inconsistency
**Severity:** 🟡 MEDIUM  
**Pattern:** Error codes defined in multiple places with overlapping but different sets

**Locations:**
- `packages/errors/index.ts` - `ErrorCodes` object with comprehensive codes
- `packages/kernel/validation.ts` - `ErrorCodes` object with different set
- `apps/api/src/utils/resilience.ts` - Uses `ErrorCodes` from `@kernel/validation`

**Differences Found:**
- `packages/errors` has: `PUBLISH_FAILED`, `INTENT_RETRIEVAL_FAILED`, `BILLING_ERROR`
- `packages/kernel/validation` has: `CIRCUIT_OPEN`, `CIRCUIT_HALF_OPEN`, `EXTERNAL_API_ERROR`

**Fix Strategy:**
1. Consolidate all error codes into a single source of truth in `@packages/errors`
2. Remove duplicate definitions from `@kernel/validation`
3. Export from `@kernel/validation` for backward compatibility if needed

---

### Issue 2.4: Silent Error Swallowing
**Severity:** 🟡 MEDIUM  
**Pattern:** Some catch blocks silently swallow errors or only log them

**Files Affected:**
- `domains/content/infra/persistence/PostgresContentRepository.ts:70-72` - Returns null on mapping error instead of propagating
- Various adapter files that catch and only log errors

**Description:**
Some code paths catch errors, log them, and return null or default values. This can mask critical failures and make debugging difficult.

**Fix Strategy:**
1. Audit all catch blocks that don't re-throw
2. Distinguish between expected errors (return null) and unexpected errors (re-throw)
3. Document the intentional error swallowing with comments

---

## 3. TYPE SAFETY CONSISTENCY

### Issue 3.1: Remaining `any` Types
**Severity:** 🟡 MEDIUM  
**Pattern:** Several files still use `any` types that should be properly typed

**Files with `any` types:**
- `apps/web/components/*.tsx` - Multiple components use `Props: any` pattern:
  - `AdminAuditView.tsx` - `{ events, onFilter }: any`
  - `AdminBillingDashboard.tsx` - `{ orgs }: any`
  - `BillingProviderSelector.tsx` - `{ onSelect }: any`
  - `BuyerSeoReportView.tsx` - `{ report }: any`
  - `BulkPublishConfirm.tsx` - `{ summary, onConfirm }: any`
  - `BulkPublishView.tsx` - `{ drafts, onPublish }: any`
  - And many more...
- `apps/web/hooks/use-api.ts:151` - `preferences: any`
- `apps/web/lib/perf.ts:7` - `...args: any[]`
- `apps/web/lib/db.ts` - `params?: any[]`

**Description:**
Web components and hooks still extensively use `any` types, bypassing TypeScript's type checking. This is particularly problematic in React components where prop types are crucial for correctness.

**Fix Strategy:**
1. Create proper TypeScript interfaces for all component props
2. Replace `any[]` with proper generic types
3. Use `unknown` instead of `any` where type is truly unknown
4. Add `no-explicit-any` ESLint rule (may need gradual enforcement)

---

### Issue 3.2: Inconsistent Type Assertion Patterns
**Severity:** 🟡 MEDIUM  
**Pattern:** Mix of `as Type`, `as unknown as Type`, and proper type guards

**Files with inconsistent patterns:**
- `control-plane/api/types.ts:35` - `(req as unknown as { auth?: AuthContext | null }).auth`
- `control-plane/api/routes/content.ts:89` - `(req as AuthenticatedRequest).auth`
- `apps/api/src/routes/*.ts` - Various `as` patterns

**Description:**
Type assertions are used inconsistently. Some places use `as unknown as X` (safer), while others use direct `as X` (unsafe). There's no standard pattern.

**Fix Strategy:**
1. Create type guard functions for common type checks:
   ```typescript
   function hasAuth(req: FastifyRequest): req is AuthenticatedRequest {
     return 'auth' in req && req.auth !== undefined;
   }
   ```
2. Replace type assertions with type guards where possible
3. Use `satisfies` operator where appropriate (TypeScript 4.9+)

---

### Issue 3.3: Interface/Type Definition Duplication
**Severity:** 🟡 MEDIUM  
**Pattern:** Similar interfaces defined in multiple places

**Examples:**
- `AuthContext` defined in:
  - `apps/api/src/types/fastify.d.ts`
  - `control-plane/api/types.ts`
- Error response interfaces defined in both `packages/errors` and individual route files
- Rate limit interfaces defined in multiple places

**Fix Strategy:**
1. Consolidate shared interfaces into `@packages/types`
2. Have specific packages re-export with extensions if needed
3. Document the canonical location for each interface type

---

## 4. SECURITY PATTERNS

### Issue 4.1: Inconsistent Input Validation
**Severity:** 🔴 HIGH  
**Pattern:** Not all entry points have consistent input validation

**Files with Zod validation (Good):**
- `control-plane/api/routes/content.ts` - Uses Zod schemas for body, query, params
- `control-plane/api/middleware/validation.ts` - Provides `validateBody`, `validateQuery`, `validateParams`
- `apps/api/src/utils/idempotency.ts` - Uses Zod schemas
- `apps/api/src/utils/cache.ts` - Uses Zod schemas

**Files lacking consistent validation:**
- Some route files in `apps/api/src/routes/` may not use Zod consistently
- Webhook handlers may lack proper validation
- GraphQL resolvers (if any) validation status unknown

**Description:**
While many files use Zod for validation, there's no guarantee that ALL entry points have proper validation. Some files may still use manual validation or type assertions.

**Fix Strategy:**
1. Audit all API entry points to ensure Zod validation is applied
2. Create a mandatory validation middleware that rejects requests without schema validation
3. Add runtime validation for all external inputs (webhooks, file uploads, etc.)

---

### Issue 4.2: SQL Injection Risk Assessment
**Severity:** 🔴 HIGH  
**Pattern:** Some SQL queries may use string interpolation

**Files to Review:**
- `packages/database/index.ts` - Has parameterized query functions, but check for any dynamic SQL
- `domains/*/infra/persistence/*.ts` - PostgreSQL repositories
- `apps/api/src/seo/*.ts` - SEO-related queries
- `control-plane/services/*.ts` - Service layer queries

**Description:**
Most queries appear to use parameterized queries (good), but a comprehensive audit of all SQL generation is needed to ensure no string concatenation is used for SQL.

**Fix Strategy:**
1. Run static analysis tool (like eslint-plugin-sql) to detect potential SQL injection
2. Audit all raw SQL queries for string interpolation
3. Use query builders (like Knex or TypeORM) for complex queries to reduce risk
4. Add security linting rules to CI/CD

---

## 5. CONFIGURATION & ENVIRONMENT

### Issue 5.1: Direct process.env Access
**Severity:** 🟡 MEDIUM  
**Pattern:** Many files access `process.env` directly instead of using `@packages/config`

**Files with direct process.env access:**
- `control-plane/api/http.ts` - `process.env.NEXT_PUBLIC_APP_URL`, `process.env.CONTROL_PLANE_DB`
- `control-plane/adapters/keywords/paa.ts` - `process.env.SERP_API_PROVIDER`, `process.env.SERP_API_KEY`
- `control-plane/adapters/keywords/gsc.ts` - `process.env.GSC_CLIENT_ID`
- `control-plane/services/container.ts` - `process.env.REDIS_URL`, `process.env.REGION`
- `apps/api/src/utils/rateLimiter.ts` - `process.env.REDIS_URL`
- `apps/api/src/middleware/rateLimiter.ts` - `process.env.BOT_DETECTION_ENABLED`

**Description:**
While `@packages/config` exists with proper validation, many files still access `process.env` directly. This:
- Bypasses validation
- Makes it harder to track which env vars are used
- Allows placeholder values to slip through
- Makes testing more difficult

**Fix Strategy:**
1. Migrate all direct `process.env` access to `@packages/config`
2. Add ESLint rule to ban direct `process.env` access (with exceptions for config package)
3. Ensure `@packages/config` covers all environment variables used in the codebase

---

### Issue 5.2: Timeout Configuration Inconsistency
**Severity:** 🟡 MEDIUM  
**Pattern:** Timeouts defined in multiple places with different defaults

**Locations:**
- `packages/config/index.ts` - `timeoutConfig` with env-based defaults
- `packages/kernel/config.ts` - `DEFAULT_TIMEOUTS`
- Individual adapter files have hardcoded timeouts
- `apps/api/src/utils/resilience.ts` - Uses `timeoutConfig` from local config

**Inconsistencies:**
- `packages/config`: short=5000ms, medium=15000ms, long=30000ms
- Individual adapters may use different values without clear rationale

**Fix Strategy:**
1. Consolidate all timeout configuration into `@packages/config`
2. Document the timeout strategy (what each tier means)
3. Add validation that timeouts are within reasonable bounds
4. Ensure all adapters use the standardized timeout configuration

---

## 6. API CONTRACT CONSISTENCY

### Issue 6.1: Duplicate Fastify Module Augmentations
**Severity:** 🔴 HIGH  
**Pattern:** Multiple `declare module 'fastify'` declarations across files

**Files with Fastify augmentations:**
1. `apps/api/src/types/fastify.d.ts` - Defines `AuthContext` with `roles: string[]`
2. `apps/api/src/routes/publish.ts` - Defines `user?: { id: string; orgId: string }`
3. `control-plane/api/types.ts` - Defines `AuthContext` with `role: Role` (singular)

**Conflicts:**
- `apps/api` uses `roles: string[]` (array)
- `control-plane` uses `role: Role` (single enum)
- Different property shapes for auth context

**Description:**
These conflicting augmentations can cause:
- Type errors when sharing code between apps
- Runtime errors if auth context shape differs
- Confusion about which auth pattern to use

**Fix Strategy:**
1. Consolidate all Fastify augmentations into a single location
2. Ensure consistency between `apps/api` and `control-plane` auth contexts
3. If different shapes are needed, use declaration merging carefully
4. Document the canonical auth context shape

---

### Issue 6.2: Inconsistent Response Formats
**Severity:** 🟡 MEDIUM  
**Pattern:** Error responses have different structures across routes

**Examples:**
- `packages/errors/index.ts` - Standard format: `{ error: string; code: string; details?: unknown; requestId?: string }`
- `control-plane/api/routes/content.ts` - Custom format in `sanitizeErrorForClient`
- Individual route files may have their own error response formats

**Description:**
While `@packages/errors` provides a standard format, not all routes use it consistently. This leads to:
- Clients needing to handle multiple error formats
- Inconsistent API experience
- Documentation challenges

**Fix Strategy:**
1. Create a Fastify error handler plugin that uses `@packages/errors`
2. Apply the plugin globally to all routes
3. Remove custom error formatting from individual routes
4. Document the standard error response format

---

## 7. RESOURCE MANAGEMENT

### Issue 7.1: Database Connection Release Inconsistency
**Severity:** 🟡 MEDIUM  
**Pattern:** Most files release connections properly, but pattern varies

**Files with proper release:**
- `control-plane/services/*.ts` - Generally use `client.release()` in finally blocks
- `domains/*/infra/persistence/*.ts` - Generally proper

**Potential issues:**
- `apps/web/lib/db.ts:276` - `client.release(withError)` - passes error to release (good)
- Some files may not use try/finally consistently

**Description:**
While most files appear to handle connection release correctly, there's no unified pattern or helper to ensure consistency.

**Fix Strategy:**
1. Create a database connection wrapper that auto-releases:
   ```typescript
   export async function withClient<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
     const client = await pool.connect();
     try {
       return await fn(client);
     } finally {
       client.release();
     }
   }
   ```
2. Migrate all database code to use the wrapper
3. Add linting to ensure `client.release()` is always called

---

### Issue 7.2: AbortController Timeout Cleanup
**Severity:** 🟡 MEDIUM  
**Pattern:** AbortController timeouts may not always clear properly

**Files with AbortController:**
- `control-plane/adapters/linkedin/LinkedInAdapter.ts` - Lines 74, 172, 226
- `control-plane/adapters/keywords/paa.ts` - Lines 135, 229, 310
- `control-plane/adapters/facebook/FacebookAdapter.ts` - Line 48

**Current pattern:**
```typescript
const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
try {
  // ... fetch
} finally {
  clearTimeout(timeoutId);
}
```

**Description:**
Most files clear the timeout in a finally block (good), but this pattern is repeated everywhere instead of being centralized.

**Fix Strategy:**
1. Create a centralized timeout utility:
   ```typescript
   export function withAbortTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
     const controller = new AbortController();
     const timeoutId = setTimeout(() => controller.abort(), ms);
     return Promise.race([
       promise,
       new Promise<never>((_, reject) => {
         controller.signal.addEventListener('abort', () => {
           reject(new Error(`Timeout after ${ms}ms`));
         });
       })
     ]).finally(() => clearTimeout(timeoutId));
   }
   ```
2. Migrate all timeout handling to use the utility
3. Ensure signal is properly passed to fetch calls

---

### Issue 7.3: Timer Management
**Severity:** 🟡 MEDIUM  
**Pattern:** setTimeout/setInterval usage not tracked for cleanup

**Files with timers:**
- `apps/web/lib/shutdown.ts` - Has timer registration system (good)
- `control-plane/jobs/media-cleanup.ts` - `setTimeout` without tracking
- `control-plane/jobs/content-scheduler.ts` - `setTimeout` usage
- Various other files with delayed operations

**Description:**
While `apps/web/lib/shutdown.ts` has a timer registration system, it's not consistently used across the codebase. This can lead to:
- Timers keeping process alive during shutdown
- Memory leaks from uncleared timers
- Test flakiness

**Fix Strategy:**
1. Export timer utilities from `@kernel` package
2. Enforce use of registered timers through linting
3. Add shutdown hooks to ensure all timers are cleared

---

## RECOMMENDED PRIORITY ORDER

### Phase 1: Critical (Fix Immediately)
1. **Import Consistency (1.1)** - Migrate to `@kernel/*` imports
2. **Error Code Consolidation (2.3)** - Single source of truth for error codes
3. **Fastify Augmentations (6.1)** - Fix conflicting type declarations

### Phase 2: High Priority (Fix This Sprint)
4. **Error Handling Standardization (2.1, 2.2)** - Standardize error casting and catching
5. **Input Validation (4.1)** - Ensure all entry points have validation
6. **Response Format (6.2)** - Standardize API error responses

### Phase 3: Medium Priority (Fix Next Sprint)
7. **Environment Configuration (5.1)** - Migrate to `@packages/config`
8. **Type Safety (3.1, 3.2)** - Remove `any` types, standardize type assertions
9. **Resource Management (7.1, 7.2, 7.3)** - Centralize resource cleanup

---

## APPENDIX: STATISTICS

### Files Analyzed
- **apps/api/src/adapters/**: 18 files
- **apps/api/src/routes/**: 28 files  
- **domains/**: 87 files
- **control-plane/**: 142 files
- **packages/**: 52 files
- **apps/web/**: 45 files

### Import Pattern Distribution
| Pattern | Count | Percentage |
|---------|-------|------------|
| `@kernel/*` imports | ~120 | 40% |
| Relative imports to utils | ~150 | 50% |
| Mixed (both patterns) | ~30 | 10% |

### Error Handling Pattern Distribution
| Pattern | Count | Percentage |
|---------|-------|------------|
| `as Error` casting | ~200 | 70% |
| `instanceof Error` | ~40 | 14% |
| `error: any` | ~45 | 16% |

---

*End of Cross-Cutting Audit Report*
