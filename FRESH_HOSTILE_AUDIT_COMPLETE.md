# 🔴 FRESH HOSTILE AUDIT - SMARTBEAK CODEBASE
## Production Security & Quality Assessment

**Audit Date:** 2026-02-10 (Fresh Audit)  
**Scope:** Full codebase re-scan after previous fixes  
**Classification:** CRITICAL ISSUES FOUND

---

## EXECUTIVE SUMMARY

| Severity | NEW | UNFIXED | TOTAL |
|----------|-----|---------|-------|
| **P0-Critical** | 8 | 1 | 9 |
| **P1-High** | 15 | 3 | 18 |
| **P2-Medium** | 12 | 5 | 17 |
| **P3-Low** | 8 | 4 | 12 |
| **TOTAL** | **43** | **13** | **56** |

**Status:** Previous fixes applied, but **56 issues remain** - including 9 CRITICAL issues requiring immediate action.

---

## 🔴 TOP 7 MOST CRITICAL ISSUES (DEPLOYMENT BLOCKERS)

### #1: MASTER KEY STILL IN REPOSITORY (P0-CRITICAL)
| | |
|---|---|
| **File** | `.master_key` |
| **Status** | UNFIXED |
| **Content** | `YMAcJ6m+WXUEBFZPrdiIDzJ3Ki/C944LyFfHUrUtrz4=` |
| **Blast Radius** | **COMPLETE SYSTEM COMPROMISE** |
| **Risk** | Attacker with repo access can decrypt ALL customer data, API keys, billing records |
| **Attack** | 1) Extract key from repo → 2) Decrypt vault → 3) Access all customer data → 4) Financial theft |
| **Fix** | ```bash\ngit filter-branch --force --index-filter \n  'git rm --cached --ignore-unmatch .master_key' \n  HEAD\n# Generate new key\nnode -e "console.log(require('crypto').randomBytes(32).toString('base64'))" > .master_key\necho ".master_key" >> .gitignore\nchmod 600 .master_key\n``` |

---

### #2: FLOATING PROMISE IN HEALTH CHECK - JS FILE (P0-CRITICAL)
| | |
|---|---|
| **File** | `packages/kernel/health-check.js:33` |
| **Status** | NEW |
| **Issue** | `setInterval` with async callback creates floating promises |
| **Blast Radius** | **PROCESS CRASH → COMPLETE OUTAGE** |
| **Risk** | Unhandled promise rejection crashes Node.js process |
| **Current Code** | ```javascript\nsetInterval(async () => {\n  const result = await check.check();  // Can throw!\n  lastResults.set(check.name, result);\n}, check.intervalMs);\n``` |
| **Fix** | ```javascript\nsetInterval(async () => {\n  try {\n    const result = await check.check();\n    lastResults.set(check.name, result);\n  } catch (err) {\n    logger.error(`Health check ${check.name} failed`, err);\n    lastResults.set(check.name, { name: check.name, healthy: false });\n  }\n}, check.intervalMs);\n``` |

---

### #3: WORKER WITHOUT ERROR HANDLERS - JS FILE (P0-CRITICAL)
| | |
|---|---|
| **File** | `packages/kernel/queues/bullmq-worker.js:3` |
| **Status** | NEW |
| **Issue** | Worker instantiated without error handlers |
| **Blast Radius** | **MEMORY LEAK + UNHANDLED ERRORS** |
| **Risk** | Unhandled errors crash process; no reference = garbage collection issues |
| **Current Code** | ```javascript\nexport function startWorker(eventBus) {\n  new Worker('events', async (job) => {\n    await eventBus.publish(job.data);\n  });  // No error handlers!\n}\n``` |
| **Fix** | ```javascript\nimport { Worker } from 'bullmq';\nexport function startWorker(eventBus) {\n  const worker = new Worker('events', async (job) => {\n    await eventBus.publish(job.data);\n  });\n  worker.on('failed', (job, err) => {\n    logger.error(`Job ${job?.id} failed`, err);\n  });\n  worker.on('error', (err) => {\n    logger.error('Worker error', err);\n  });\n  return worker;\n}\n``` |

---

### #4: CIRCUIT BREAKER RACE CONDITION - JS FILE (P0-CRITICAL)
| | |
|---|---|
| **File** | `packages/kernel/resilience.js` |
| **Status** | NEW |
| **Issue** | JS version lacks AsyncLock present in TS version |
| **Blast Radius** | **CASCADE FAILURE** |
| **Risk** | Multiple requests bypass open circuit under load |
| **Fix** | Add AsyncLock to JS version matching TS implementation |

---

### #5: N+1 QUERY IN SEARCH INDEXING (P0-CRITICAL)
| | |
|---|---|
| **File** | `domains/search/application/SearchIndexingWorker.ts:192` |
| **Status** | NEW |
| **Issue** | Database query inside loop |
| **Blast Radius** | **DATABASE OVERLOAD → OUTAGE** |
| **Risk** | 1000 items = 1000 queries; connection pool exhaustion |
| **Fix** | Use batch query with `WHERE id = ANY($1::uuid[])` |

---

### #6: ANALYTICS ROUTE AUTHORIZATION BYPASS (P1-HIGH)
| | |
|---|---|
| **File** | `control-plane/api/routes/analytics.ts:31` |
| **Status** | NEW |
| **Issue** | No org_id ownership check before returning stats |
| **Blast Radius** | **CROSS-TENANT DATA ACCESS** |
| **Risk** | Attacker can view analytics for ANY content ID |
| **Current Code** | ```typescript\nconst { id } = paramsResult.data;\nreturn rm.getContentStats(id);  // No ownership check!\n``` |
| **Fix** | ```typescript\nconst { id } = paramsResult.data;\nconst { rows } = await pool.query(\n  'SELECT 1 FROM content c JOIN domains d ON c.domain_id = d.id WHERE c.id = $1 AND d.org_id = $2',\n  [id, ctx.orgId]\n);\nif (rows.length === 0) return res.status(404).send({ error: 'Not found' });\nreturn rm.getContentStats(id);\n``` |

---

### #7: NON-CRYPTOGRAPHIC RNG IN RATE LIMITER (P1-HIGH)
| | |
|---|---|
| **File** | `control-plane/services/rate-limiter-redis.ts:142` |
| **Status** | NEW |
| **Issue** | Math.random() for generating unique IDs |
| **Blast Radius** | **RATE LIMIT BYPASS** |
| **Risk** | Predictable IDs allow rate limit evasion |
| **Current Code** | ```typescript\nprivate generateUniqueId(): string {\n  return `${Date.now()}-${Math.random().toString(36)}`;\n}\n``` |
| **Fix** | ```typescript\nimport { randomBytes } from 'crypto';\nprivate generateUniqueId(): string {\n  return `${Date.now()}-${randomBytes(8).toString('hex')}`;\n}\n``` |

---

## DETAILED FINDINGS BY CATEGORY

### 🔴 P0-CRITICAL (9 issues)

#### 1. Committed Master Key (UNFIXED)
- **File:** `.master_key`
- **Issue:** Encryption key in version control
- **Fix:** Rotate key, remove from git history

#### 2. Floating Promise - Health Check JS (NEW)
- **File:** `packages/kernel/health-check.js:33`
- **Issue:** Unhandled async in setInterval
- **Fix:** Add try/catch wrapper

#### 3. Worker Without Error Handlers - JS (NEW)
- **File:** `packages/kernel/queues/bullmq-worker.js:3`
- **Issue:** No error event handlers
- **Fix:** Add on('failed') and on('error') handlers

#### 4. Circuit Breaker Race - JS (NEW)
- **File:** `packages/kernel/resilience.js`
- **Issue:** No AsyncLock in JS version
- **Fix:** Port AsyncLock from TS

#### 5. N+1 Query - Search Indexing (NEW)
- **File:** `domains/search/application/SearchIndexingWorker.ts:192`
- **Issue:** Query in loop
- **Fix:** Batch query

#### 6. TIMESTAMP Without Timezone (NEW)
- **File:** `packages/db/migrations/20260227_add_content_archive_tables.sql:9,12,28`
- **Issue:** Uses TIMESTAMP instead of TIMESTAMPTZ
- **Fix:** Change to TIMESTAMPTZ

#### 7. Missing ON DELETE (NEW)
- **File:** `packages/db/migrations/20260214_add_affiliate_links.sql:4`
- **Issue:** Foreign key without ON DELETE
- **Fix:** Add ON DELETE CASCADE or SET NULL

#### 8. Unbounded OFFSET Pagination (NEW)
- **Files:** 12 repository files
- **Issue:** OFFSET without limit causes O(n) scans
- **Fix:** Implement cursor-based pagination

#### 9. Missing lock_timeout (NEW)
- **File:** `apps/web/lib/db.ts:275`
- **Issue:** Only statement_timeout, no lock_timeout
- **Fix:** Add lock_timeout configuration

### 🟠 P1-HIGH (18 issues)

#### Security (6 issues)
1. **Analytics Route Auth Bypass** - `control-plane/api/routes/analytics.ts:31`
2. **Non-Crypto RNG** - `control-plane/services/rate-limiter-redis.ts:142`
3. **Missing Rate Limiting** - 7 routes including bulk publish
4. **Rate Limit After Auth** - DoS vector
5. **Inconsistent JWT Verification** - 7 routes use custom instead of @security/auth
6. **CSV Formula Injection** - `mediaAnalyticsExport.ts`

#### Database (6 issues)
1. **Race Condition in Quota** - `control-plane/api/routes/domains.ts:174`
2. **Missing Indexes** - Several queries lack indexes
3. **Transaction Boundary Violations** - Read outside transaction
4. **Replica Lag Checks Missing** - No lag detection
5. **No Idempotency in Seed** - `20260210_backfill_human_intents.sql`
6. **Missing RLS** - No Row Level Security

#### Type Safety (6 issues)
1. **Type Assertions** - Multiple `as any` bypasses
2. **Missing Validation** - `control-plane/api/routes/orgs.ts:26`
3. **Implicit Any** - Several functions lack return types
4. **Unsafe Casts** - `as unknown as X` patterns
5. **Error Sanitization Gaps** - `control-plane/api/routes/content.ts:59-77`
6. **Weak ETag Algorithm** - `control-plane/api/middleware/cache.ts:13` (MD5)

### 🟡 P2-MEDIUM (17 issues)

1. Error message leakage if NODE_ENV misconfigured
2. Missing input validation in org creation
3. Incomplete error sanitization in content routes
4. JSONB size limits not enforced
5. Sequence monitoring missing
6. Missing BRIN indexes for time-series data
7. Naming inconsistencies in migrations
8. Theme configs lack security headers (5 files)
9. Theme directories lack package.json
10. tsconfig.json overrides base settings
11. Missing CSP headers in themes
12. Missing import in DLQ service
13. Type assertion bypass in intent guard
14. Unbounded Promise.all in 2 files
15. Missing AbortController in 2 files
16. Memory leak in event emitter
17. Unhandled rejections in 2 places

### 🟢 P3-LOW (12 issues)

1. Console.log usage (8 files)
2. Trailing whitespace (multiple files)
3. Inconsistent quote style
4. Missing final newlines (5 files)
5. Unused imports (3 files)
6. Long lines >100 chars (12 files)
7. Missing JSDoc (6 files)
8. Implicit returns (4 files)
9. Var usage instead of const/let (2 files)
10. Loose equality == (4 files)
11. Commented code (6 files)
12. TODO comments without tracking

---

## PREVIOUS FIXES - VERIFICATION STATUS

| Category | Applied | Verified | Notes |
|----------|---------|----------|-------|
| Master key rotation | ❌ NO | ❌ | Key still in repo |
| Crypto import | ✅ YES | ✅ | Fixed in dlq.ts |
| Auth bypass | ✅ YES | ✅ | Imports corrected |
| JWT algorithm | ✅ YES | ✅ | Whitelist added |
| IDOR fixes | ✅ YES | ✅ | org_id checks added |
| Pool exhaustion | ✅ YES | ✅ | Semaphore added |
| Transaction deadlocks | ✅ YES | ✅ | CTE queries |
| TypeScript strictness | ✅ YES | ✅ | Options enabled |
| Branded types | ✅ YES | ✅ | Added validation.ts |
| Global state freeze | ✅ YES | ✅ | Object.freeze() |
| Database migrations | ✅ YES | ✅ | 5 migrations created |
| Circuit breaker lock | ✅ YES | ⚠️ | TS fixed, JS not fixed |
| Floating promises | ✅ YES | ⚠️ | TS fixed, JS not fixed |

---

## COMPLIANCE STATUS

| Standard | Status | Violations |
|----------|--------|------------|
| SOC 2 Type II | ❌ FAIL | Committed secrets |
| GDPR Article 32 | ❌ FAIL | Encryption key exposure |
| PCI-DSS 6.5 | ❌ FAIL | Key in version control |
| ISO 27001 | ❌ FAIL | Secrets management |

---

## IMMEDIATE ACTION PLAN

### TODAY (P0-Critical)
1. **Rotate master key** - Use git filter-branch to remove from history
2. **Fix JS files** - Add error handling to health-check.js and bullmq-worker.js
3. **Fix circuit breaker JS** - Add AsyncLock to resilience.js
4. **Fix N+1 query** - Batch query in SearchIndexingWorker.ts

### THIS WEEK (P1-High)
5. Fix analytics route authorization
6. Replace Math.random() with crypto.randomBytes()
7. Add rate limiting to bulk publish routes
8. Fix TIMESTAMP types in migrations
9. Add missing ON DELETE clauses

### ONGOING (P2-P3)
10. Implement cursor-based pagination
11. Add comprehensive input validation
12. Standardize error handling
13. Add security headers to all configs

---

## SECURITY POSTURE

### Current Grade: C-

**Strengths:**
- Strong security packages (@security/auth)
- Comprehensive input validation with Zod
- Proper transaction usage in most places
- Good CORS and security header configuration

**Weaknesses:**
- Master key committed to repository (CRITICAL)
- JavaScript files lack TypeScript safety fixes
- Inconsistent adoption of security patterns
- Missing authorization on some routes

---

## CONCLUSION

While significant progress was made in the previous remediation, **critical issues remain** that prevent production deployment:

1. **The master key is still in the repository** - This is a SEV-1 incident
2. **JavaScript files were not fixed** - Only TypeScript was addressed
3. **New issues introduced** - Recent migrations have timestamp issues
4. **Authorization gaps** - Some routes still lack proper ownership checks

**RECOMMENDATION:** Do NOT deploy until all P0 issues are resolved.

---

*Audit completed: 2026-02-10*  
*Classification: CONFIDENTIAL - CRITICAL ISSUES FOUND*
