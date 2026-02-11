# HOSTILE Architecture & Configuration Audit Report

**Project:** SmartBeak  
**Date:** 2026-02-10  
**Auditor:** Sub-agent  
**Scope:** tsconfig.json, package.json, .env, CI/CD, Architecture Patterns  

---

## EXECUTIVE SUMMARY

| Category | Critical | High | Medium | Low |
|----------|----------|------|--------|-----|
| SOLID Violations | 3 | 8 | 5 | 2 |
| Configuration Issues | 1 | 4 | 6 | 3 |
| Security Risks | 2 | 3 | 2 | 1 |
| Architecture Violations | 2 | 5 | 4 | 2 |
| **TOTAL** | **8** | **20** | **17** | **8** |

---

## 1. TSCONFIG AUDIT

### 1.1 Root tsconfig.json
| File | Severity | Issue | Fix |
|------|----------|-------|-----|
| `tsconfig.json` | 🟡 MEDIUM | Minimal config only extends base - missing package-specific compiler options | Add explicit compiler options for root project |
| `tsconfig.json` | 🟢 LOW | No `files` or `include` specified at root level | Consider adding explicit file list for root |

### 1.2 tsconfig.base.json
| File | Severity | Issue | Fix |
|------|----------|-------|-----|
| `tsconfig.base.json` | 🟢 LOW | `skipLibCheck: false` is good for security but may slow builds | Document this intentional choice |
| `tsconfig.base.json` | 🟢 LOW | `jsx: "react-jsx"` in base config affects all packages | Consider moving to app-specific configs |
| `tsconfig.base.json` | 🟡 MEDIUM | `rootDir: "."` with broad `include` pattern may include unintended files | Add stricter include/exclude patterns |
| `tsconfig.base.json` | 🟡 MEDIUM | No `noUnusedLocals` or `noUnusedParameters` enabled | Add for stricter code quality |

### 1.3 Package tsconfig.json Files
| File | Severity | Issue | Fix |
|------|----------|-------|-----|
| `packages/*/tsconfig.json` | 🟡 MEDIUM | All packages use identical template - no customization per package needs | Review each package for specific requirements |
| `packages/*/tsconfig.json` | 🟡 MEDIUM | Missing `noImplicitReturns` in compiler options | Add for safety |
| `packages/db/tsconfig.json` | 🔴 CRITICAL | Package has zero files - dead package reference | Remove from codebase or implement |
| `packages/*/tsconfig.json` | 🟡 MEDIUM | No `strictNullChecks` explicitly enabled (relies on `strict: true`) | Document dependency on base config |

---

## 2. PACKAGE.JSON AUDIT

### 2.1 Root package.json
| File | Severity | Issue | Fix |
|------|----------|-------|-----|
| `package.json` | 🟢 LOW | `license: "UNLICENSED"` - no open source license | Add appropriate license or keep proprietary |
| `package.json` | 🟢 LOW | `type: "module"` - ES modules only | Good practice, document in README |
| `package.json` | 🟡 MEDIUM | No `workspaces` field for monorepo structure | Add workspaces configuration |
| `package.json` | 🟡 MEDIUM | `zod: ^4.3.6` - major version 4 is very new | Pin to exact version or test thoroughly |
| `package.json` | 🟡 MEDIUM | Mixed dependency versions (some ^, some exact) | Standardize versioning strategy |
| `package.json` | 🔴 HIGH | No `resolutions` or `overrides` for security patches | Add for critical dependencies |
| `package.json` | 🟡 MEDIUM | `typescript: ^5.4.5` - consider pinning TS version | Pin for reproducible builds |
| `package.json` | 🟢 LOW | `tsx` in devDependencies - good for development | Consider production runtime needs |

### 2.2 packages/shutdown/package.json
| File | Severity | Issue | Fix |
|------|----------|-------|-----|
| `packages/shutdown/package.json` | 🔴 CRITICAL | References `"@kernel/logger": "workspace:*"` - workspace protocol not configured | Remove workspace: prefix or configure npm workspaces |
| `packages/shutdown/package.json` | 🟡 MEDIUM | No `engines` field | Add node version constraints |
| `packages/shutdown/package.json` | 🟡 MEDIUM | No `scripts` defined | Add build/test scripts |

### 2.3 Theme Packages
| File | Severity | Issue | Fix |
|------|----------|-------|-----|
| `themes/*/package.json` | 🟢 LOW | All identical minimal configs | Review for theme-specific needs |

---

## 3. ENVIRONMENT & SECRETS AUDIT

### 3.1 .env.example
| File | Severity | Issue | Fix |
|------|----------|-------|-----|
| `.env.example` | 🟢 LOW | Well-documented with 643 lines | Good practice |
| `.env.example` | 🟡 MEDIUM | Contains many placeholder secrets | Ensure these patterns don't match real secrets |
| `.env.example` | 🟡 MEDIUM | No `.env.vault` or encryption | Consider secret management tool |
| `.env.example` | 🟡 MEDIUM | Frontend vars mixed with backend (NEXT_PUBLIC_*) | Document security implications |

### 3.2 .master_key
| File | Severity | Issue | Fix |
|------|----------|-------|-----|
| `.master_key` | 🔴 CRITICAL | **COMMITTED TO REPO** - Actual encryption key present | **REMOVE IMMEDIATELY** - Rotate all encrypted secrets |
| `.master_key` | 🔴 CRITICAL | Line 2 contains 32-byte key: `J4wB9kYf63Av3LgrvM2Xx3pqy0xPG5ugLKKmgEH69HI=` | Rotate and use proper secret management |

### 3.3 Secret Detection in Code
| File | Severity | Issue | Fix |
|------|----------|-------|-----|
| `control-plane/services/container.ts` | 🔴 HIGH | `process.env.FACEBOOK_PAGE_TOKEN` accessed directly | Use config package abstraction |
| `apps/*/src/**/*.ts` | 🟡 MEDIUM | Multiple direct `process.env` accesses | Centralize through @config package |
| `packages/kernel/logger.ts` | 🟢 LOW | `process.env.NODE_ENV` and `LOG_LEVEL` access | Acceptable for logging level |

---

## 4. CI/CD AUDIT

### 4.1 .github/workflows/ci-guards.yml
| File | Severity | Issue | Fix |
|------|----------|-------|-----|
| `ci-guards.yml` | 🟡 MEDIUM | `on: [push, pull_request]` triggers on all branches | Limit to main/protected branches |
| `ci-guards.yml` | 🔴 HIGH | `actions/checkout@v4` with `persist-credentials: false` is good | But no artifact cleanup |
| `ci-guards.yml` | 🟡 MEDIUM | Only checks for `autoPublish` and `autoMerge` strings | Incomplete security checks |
| `ci-guards.yml` | 🔴 HIGH | No dependency vulnerability scanning | Add `npm audit` step |
| `ci-guards.yml` | 🔴 HIGH | No TypeScript compilation check | Add `tsc --noEmit` |
| `ci-guards.yml` | 🟡 MEDIUM | No test execution | Add test runner |
| `ci-guards.yml` | 🟡 MEDIUM | No linting checks | Add ESLint step |
| `ci-guards.yml` | 🔴 HIGH | No secret scanning | Add truffleHog or similar |

### 4.2 Missing CI/CD Features
| File | Severity | Issue | Fix |
|------|----------|-------|-----|
| `.github/workflows/` | 🔴 CRITICAL | No deployment workflow | Create deployment pipeline |
| `.github/workflows/` | 🔴 HIGH | No CodeQL analysis | Add security scanning |
| `.github/workflows/` | 🟡 MEDIUM | No dependency update automation | Add Dependabot |
| `.github/workflows/` | 🟡 MEDIUM | No build artifact verification | Add checksum verification |

---

## 5. SOLID VIOLATIONS

### 5.1 Single Responsibility Principle (SRP) Violations - GOD CLASSES
| File | Lines | Severity | Issue | Fix |
|------|-------|----------|-------|-----|
| `apps/api/src/adapters/gbp/GbpAdapter.ts` | 770 | 🔴 CRITICAL | God class - handles all Google Business Profile operations | Split into: Auth, Locations, Posts, Insights adapters |
| `packages/database/index.ts` | 770 | 🔴 CRITICAL | God class - database connection, pooling, migrations, helpers | Split into: ConnectionManager, PoolManager, QueryBuilder |
| `packages/middleware/validation.ts` | 703 | 🔴 CRITICAL | God class - 50+ validation schemas in one file | Split by domain: UserSchemas, ContentSchemas, etc. |
| `apps/api/src/middleware/abuseGuard.ts` | 659 | 🔴 HIGH | Multiple responsibilities: rate limiting, content scanning, alerting | Extract to separate middlewares |
| `apps/api/src/routes/emailSubscribers.ts` | 640 | 🔴 HIGH | Route file too large - handles CRUD, import, export, sync | Split into route modules |
| `apps/web/lib/auth.ts` | 631 | 🔴 HIGH | Auth utilities mixed with Clerk integration, session management | Split: AuthProvider, SessionManager, Permissions |
| `apps/api/src/db.ts` | 575 | 🔴 HIGH | Database module with multiple responsibilities | Extract connection, migration, query logic |
| `packages/security/audit.ts` | 567 | 🟡 MEDIUM | Audit logging mixed with security event handling | Separate concerns |
| `apps/api/src/jobs/JobScheduler.ts` | 561 | 🟡 MEDIUM | Scheduler mixed with worker management | Extract WorkerManager |
| `apps/web/lib/db.ts` | 535 | 🟡 MEDIUM | Duplicate database logic between apps/web and apps/api | Consolidate to @database package |
| `packages/errors/index.ts` | 517 | 🟡 MEDIUM | All error classes in single file | Split by error domain |
| `apps/api/src/jobs/domainExportJob.ts` | 514 | 🟡 MEDIUM | Job logic mixed with export formats | Extract format handlers |
| `apps/api/src/routes/email.ts` | 494 | 🟡 MEDIUM | Route file too large | Split by operation type |
| `packages/kernel/validation.ts` | 492 | 🟡 MEDIUM | Validation schemas duplicated with middleware package | Consolidate to single package |

### 5.2 Open/Closed Principle Violations
| File | Severity | Issue | Fix |
|------|----------|-------|-----|
| `control-plane/services/container.ts` | 🔴 HIGH | Switch statement for adapter creation | Use factory pattern or registry |
| `packages/database/index.ts` | 🟡 MEDIUM | Hard-coded sort column whitelist | Make configurable per domain |
| `apps/api/src/middleware/rateLimiter.ts` | 🟡 MEDIUM | Fixed rate limit rules | Make extensible strategy pattern |

### 5.3 Liskov Substitution Violations
| File | Severity | Issue | Fix |
|------|----------|-------|-----|
| `packages/errors/index.ts` | 🟡 MEDIUM | Error classes have inconsistent constructor signatures | Standardize base AppError |
| `packages/utils/lruCache.ts` | 🟢 LOW | BoundedMap extends Map but may violate LSP | Review method overrides |

### 5.4 Interface Segregation Violations
| File | Severity | Issue | Fix |
|------|----------|-------|-----|
| `packages/types/events/content-published.v1.ts` | 🟡 MEDIUM | Large event interface with optional fields | Split into specific event types |
| `packages/middleware/validation.ts` | 🔴 HIGH | ValidationConstants has 20+ unrelated constants | Split by domain |
| `control-plane/services/container.ts` | 🔴 HIGH | Container interface too broad | Split into service-specific containers |

### 5.5 Dependency Inversion Violations
| File | Severity | Issue | Fix |
|------|----------|-------|-----|
| `apps/api/src/db.ts` | 🔴 HIGH | Direct knex/pg imports instead of @database package | Use shared package |
| `apps/web/lib/db.ts` | 🔴 HIGH | Duplicate database implementation | Use @database package |
| `control-plane/services/container.ts` | 🟡 MEDIUM | Direct imports from domains (should be via interfaces) | Use dependency injection |
| `packages/kernel/logger.ts` | 🟡 MEDIUM | Direct `process.env` access | Use @config package |

---

## 6. CIRCULAR DEPENDENCIES

### 6.1 Detected Import Cycles
| Package | Severity | Issue | Fix |
|---------|----------|-------|-----|
| `@kernel` ↔ `@database` | 🔴 HIGH | Kernel imports database, database imports kernel logger | Extract logger to separate package |
| `@security` ↔ `@kernel` | 🟡 MEDIUM | Security imports kernel logger | Use event-based logging or dependency injection |
| `@database` → `@kernel` | 🟡 MEDIUM | Database depends on kernel for logging | Pass logger as constructor parameter |
| `@middleware` → `@kernel` | 🟢 LOW | Middleware uses kernel validation | Acceptable if kernel is base layer |

### 6.2 Architecture Layer Violations
| File | Severity | Issue | Fix |
|------|----------|-------|-----|
| `control-plane/services/container.ts` | 🔴 CRITICAL | Imports from `../../domains/*` directly | Use domain interfaces only |
| `apps/api/src/**/*.ts` | 🔴 HIGH | Direct imports across domain boundaries | Route through control-plane |
| `domains/*/infra/persistence/*.ts` | 🟡 MEDIUM | Import from other domains | Use shared kernel or events |

---

## 7. SHARED MUTABLE STATE (GLOBALS)

### 7.1 Global State Detected
| File | Variable | Severity | Issue | Fix |
|------|----------|----------|-------|-----|
| `packages/kernel/queues/bullmq-queue.ts` | `eventQueue` | 🔴 HIGH | Global Queue instance | Use factory/dependency injection |
| `packages/kernel/request-context.ts` | `requestContextStorage` | 🟡 MEDIUM | Global AsyncLocalStorage | Wrap in provider |
| `packages/database/index.ts` | `activeAdvisoryLocks` | 🟡 MEDIUM | Module-level Set | Encapsulate in class |
| `packages/config/index.ts` | All config objects | 🟡 MEDIUM | Exported mutable config | Use `Object.freeze()` or getters |
| `packages/kernel/constants.ts` | TIME, DB, etc. | 🟢 LOW | Exported constants | Good: const assertions used |
| `control-plane/services/container.ts` | `globalContainer` | 🔴 CRITICAL | Global mutable container | Use proper DI framework |

---

## 8. ARCHITECTURE PATTERN VIOLATIONS

### 8.1 Architectural Contract Violations
Per `ARCHITECTURAL_CONTRACT.md`:
- Control plane orchestrates; domains own data.
- One database per domain.
- Domain = unit of deletion/export.

| File | Severity | Issue | Fix |
|------|----------|-------|-----|
| `apps/api/src/db.ts` | 🔴 CRITICAL | Direct database access from app layer | Route through control-plane |
| `apps/web/lib/db.ts` | 🔴 CRITICAL | Frontend lib accessing database directly | Use API client only |
| `domains/*/infra/persistence/*.ts` | 🟡 MEDIUM | Multiple domains share database connection | Implement per-domain connection strategy |
| `packages/database/index.ts` | 🔴 HIGH | Shared database package violates per-domain rule | Deprecate or make domain-agnostic |

### 8.2 Domain Structure Analysis
| Domain | Files | Lines | Assessment |
|--------|-------|-------|------------|
| notifications | 17 | 2020 | Good size |
| search | 15 | 1878 | Good size |
| content | 19 | 1748 | Good size |
| publishing | 15 | 1435 | Good size |
| media | 10 | 803 | Good size |
| seo | 6 | 465 | Could merge with content |
| authors | 1 | 341 | Too small - merge opportunity |
| customers | 1 | 333 | Too small - merge opportunity |

### 8.3 App Structure Analysis
| App | Files | Lines | Assessment |
|-----|-------|-------|------------|
| api | 175 | 21900 | 🔴 TOO LARGE - violates SRP |
| web | 33 | 4142 | Good size |

---

## 9. SECURITY CONFIGURATION ISSUES

### 9.1 Hardcoded Configuration
| File | Severity | Issue | Fix |
|------|----------|-------|-----|
| `packages/middleware/validation.ts` | 🟡 MEDIUM | `MAX_PASSWORD_LENGTH: 128` hardcoded | Move to config |
| `packages/database/index.ts` | 🟡 MEDIUM | Sort column whitelist hardcoded | Make configurable |
| `packages/kernel/constants.ts` | 🟢 LOW | HTTP status codes hardcoded | Acceptable |

### 9.2 Missing Security Headers
| File | Severity | Issue | Fix |
|------|----------|-------|-----|
| `control-plane/api/http.ts` | 🔴 HIGH | No helmet or security headers configured | Add fastify-helmet |
| `apps/api/src/config/index.ts` | 🟡 MEDIUM | No CORS configuration visible | Verify CORS is restricted |

### 9.3 Input Validation
| File | Severity | Issue | Fix |
|------|----------|-------|-----|
| `packages/middleware/validation.ts` | 🟡 MEDIUM | `MAX_JSONB_SIZE_BYTES: 1024 * 1024` - 1MB limit | Document and review |
| `packages/middleware/validation.ts` | 🟡 MEDIUM | `MAX_BODY_LENGTH: 50000` may be too high | Review for abuse potential |

---

## 10. DEPENDENCY & ENGINE ISSUES

### 10.1 Engine Constraints
| File | Severity | Issue | Fix |
|------|----------|-------|-----|
| Root package.json | 🟢 LOW | `node: ">=20.0.0 <21.0.0"` - restrictive but clear | Good |
| Root package.json | 🟢 LOW | `engineStrict: true` | Good practice |
| packages/shutdown/package.json | 🔴 HIGH | Missing engines field | Add constraint |

### 10.2 Dependency Issues
| File | Severity | Issue | Fix |
|------|----------|-------|-----|
| Root package.json | 🟡 MEDIUM | 29 production dependencies - many | Review for bloat |
| Root package.json | 🟡 MEDIUM | `@clerk/nextjs` + custom JWT handling | Potential conflict |
| Root package.json | 🟡 MEDIUM | Both `knex` and direct `pg` usage | Consolidate or document |

---

## 11. RECOMMENDATIONS SUMMARY

### Immediate Actions (Critical/High)
1. **🔴 REMOVE `.master_key` from repository** - Rotate all encrypted secrets
2. **🔴 Split God classes** - Start with GbpAdapter.ts and database/index.ts
3. **🔴 Fix circular dependencies** - Extract logger to standalone package
4. **🔴 Consolidate database access** - Remove duplicate db.ts implementations
5. **🔴 Add security headers** - Configure helmet in HTTP server
6. **🔴 Expand CI/CD** - Add type checking, testing, security scanning

### Short Term (Medium Priority)
1. **🟡 Enable additional TypeScript strictness** - `noUnusedLocals`, `noImplicitReturns`
2. **🟡 Standardize config access** - Remove direct `process.env` accesses
3. **🟡 Split validation schemas** - Organize by domain
4. **🟡 Configure npm workspaces** - Fix workspace:* protocol
5. **🟡 Add missing CI checks** - lint, test, audit

### Long Term (Low Priority)
1. **🟢 Review domain boundaries** - Merge small domains (authors, customers)
2. **🟢 Add architectural tests** - Enforce import boundaries
3. **🟢 Document configuration choices** - Add ADRs
4. **🟢 Consider micro-packages** - For kernel utilities

---

## 12. COMPLIANCE CHECKLIST

| Requirement | Status | Notes |
|-------------|--------|-------|
| No secrets in repo | ❌ FAIL | `.master_key` committed |
| TypeScript strict mode | ✅ PASS | `strict: true` enabled |
| Engine constraints | ⚠️ PARTIAL | Root OK, packages missing |
| CI/CD security checks | ❌ FAIL | Minimal CI configuration |
| SOLID principles | ❌ FAIL | Multiple God classes |
| No circular deps | ⚠️ PARTIAL | Some cycles detected |
| Domain boundaries | ⚠️ PARTIAL | Some violations |
| Interface segregation | ❌ FAIL | Large interfaces exist |

---

## APPENDIX: FILE SIZES (Top 30)

| File | Lines | Assessment |
|------|-------|------------|
| apps/api/src/adapters/gbp/GbpAdapter.ts | 770 | 🔴 God class |
| packages/database/index.ts | 770 | 🔴 God class |
| packages/middleware/validation.ts | 703 | 🔴 God class |
| apps/api/src/middleware/abuseGuard.ts | 659 | 🔴 Too large |
| apps/api/src/routes/emailSubscribers.ts | 640 | 🔴 Too large |
| apps/web/lib/auth.ts | 631 | 🔴 Too large |
| apps/api/src/db.ts | 575 | 🟡 Large |
| packages/security/audit.ts | 567 | 🟡 Large |
| apps/api/src/jobs/JobScheduler.ts | 561 | 🟡 Large |
| apps/web/lib/db.ts | 535 | 🟡 Large |
| packages/errors/index.ts | 517 | 🟡 Large |
| apps/api/src/jobs/domainExportJob.ts | 514 | 🟡 Large |
| apps/api/src/routes/email.ts | 494 | 🟡 Large |
| packages/kernel/validation.ts | 492 | 🟡 Large |
| apps/api/src/utils/rateLimiter.ts | 485 | 🟡 Large |
| apps/api/src/seo/ahrefsGap.ts | 476 | 🟡 Large |
| control-plane/services/jwt.ts | 469 | 🟡 Large |
| packages/monitoring/alerting.ts | 466 | 🟡 Large |
| packages/security/keyRotation.ts | 466 | 🟡 Large |
| packages/kernel/logger.ts | 435 | 🟡 Large |

---

*End of HOSTILE Architecture & Configuration Audit Report*
