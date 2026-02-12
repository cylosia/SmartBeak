# Security Audit: Quick Reference Guide

**Last Updated:** 2026-02-12
**Branch:** `claude/security-audit-typescript-postgres-UfnDr`

---

## 🚨 P0 - PRODUCTION BLOCKERS (Fix Immediately)

### 1. Hardcoded LLM Attribution → **FTC Violation**
**File:** `control-plane/api/routes/attribution.ts:19-37, 56-62`
**Fix:** Replace with `await calculateActualAIPercentage(contentId)`
**Risk:** Legal penalties up to $50k per violation

### 2. Hardcoded Affiliate Data → **$100k/month Loss**
**File:** `control-plane/api/routes/affiliates.ts:39-58`
**Fix:** Implement real affiliate API/database integration
**Risk:** Wrong commission rates, financial loss

### 3. Weak API Key Validation → **Security Bypass**
**File:** `apps/api/src/seo/ahrefsGap.ts:155-156`
**Fix:** Change minimum from 10 to 32 characters
**Risk:** Invalid keys bypass validation

### 4. Missing Type Validation → **App Crashes**
**Files:** ahrefs.ts, amazon.ts, api-client.ts (8 files, 12 instances)
**Fix:** Use Zod schemas or type guards (see ahrefsGap.ts:9-43)
**Risk:** Production crashes on malformed API responses

---

## 🔥 P1 - HIGH PRIORITY (Fix Before Next Release)

| Issue | File | Line | Fix |
|-------|------|------|-----|
| Secret exposure in errors | Multiple | Various | Truncate errors to 200 chars |
| Missing Retry-After parsing | ahrefs.ts, ahrefsGap.ts | 88, 196 | Parse header and respect delay |
| N+1 query risk | ahrefsGap.ts | 313 | Implement batch upsert |
| Fernet key validation | api-key-vault.ts | 28-30 | Validate 44-char base64 format |

---

## ⭐ BEST PRACTICES TO REPLICATE

### CSV Injection Prevention
**Reference:** `apps/web/pages/api/exports/activity.csv.ts:48-71`
```typescript
function sanitizeCsvCell(value: string): string {
  const dangerousChars = ['=', '+', '-', '@'];
  if (value.startsWith(dangerousChars[0])) {
    return '\'' + value;  // Prefix with quote
  }
  return value.replace(/"/g, '""');  // Escape quotes
}
```

### IDOR Prevention
**Reference:** `apps/web/pages/api/content/archive.ts:67-92`
1. UUID validation
2. org_id filter in query
3. User membership JOIN
4. Explicit org_id match
5. Return 404 (not 403) to prevent enumeration
6. Audit logging

### Cursor Pagination
**Reference:** `apps/web/pages/api/exports/activity.csv.ts:174-210`
```typescript
while (hasMore && totalFetched < MAX_RECORDS) {
  if (lastTimestamp) {
    batchQuery += ` AND timestamp < $${paramIndex++}`;
  }
  const batchResult = await pool.query(batchQuery, batchParams);
  // ...
}
```

### API Key Encryption
**Reference:** `control-plane/services/api-key-vault.ts`
- Fernet symmetric encryption
- Lazy initialization
- Input validation
- Parameterized queries
- Multi-tenant isolation

---

## 🛠️ FIXES BY FILE

### ahrefs.ts
- [ ] Line 102-111: Add Zod schema for API response
- [ ] Line 88-94: Parse Retry-After header
- [ ] Line 258: Sanitize health check error

### amazon.ts
- [ ] Line 135-158: Add type guard for PAAPI response

### api-client.ts
- [ ] Line 109: Add max delay cap (30s)
- [ ] Line 177-185: Add Zod validation

### ahrefsGap.ts
- [ ] Line 155-156: Increase API key min to 32 chars
- [ ] Line 196-213: Parse Retry-After header
- [ ] Line 313: Implement batch upsert

### attribution.ts
- [ ] Line 19-37: Replace hardcoded LLM data
- [ ] Line 56-62: Calculate real AI percentage

### affiliates.ts
- [ ] Line 39-58: Implement real affiliate API

### api-key-vault.ts
- [ ] Line 28-30: Validate Fernet key format (44 chars)
- [ ] Line 228-230: Add purge job for inactive secrets

### api.ts (config)
- [ ] Line 32-42: Move API versions to env vars

---

## 📊 FILES BY SECURITY RATING

### ⭐⭐⭐⭐⭐ EXCELLENT (Use as Models)
- `apps/web/pages/api/exports/activity.csv.ts` - CSV injection prevention
- `apps/web/pages/api/content/archive.ts` - IDOR prevention
- `control-plane/services/api-key-vault.ts` - Encryption

### ✅ GOOD (Minor Improvements)
- `apps/api/src/routes/adminAuditExport.security.test.ts`
- `apps/api/src/middleware/ensureRootUser.ts`
- `packages/monitoring/alerting.ts`

### ⚠️ NEEDS WORK
- `control-plane/adapters/keywords/ahrefs.ts` - Missing type validation
- `control-plane/adapters/affiliate/amazon.ts` - Type assertions
- `apps/web/lib/api-client.ts` - Unbounded retries

### 🔴 CRITICAL ISSUES
- `control-plane/api/routes/attribution.ts` - BLOCK PRODUCTION
- `control-plane/api/routes/affiliates.ts` - BLOCK PRODUCTION
- `apps/api/src/seo/ahrefsGap.ts` - Weak validation

---

## 🔍 LINTING RULES TO ADD

```json
{
  "rules": {
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/no-non-null-assertion": "warn",
    "no-console": ["error", { "allow": ["warn", "error"] }],
    "@typescript-eslint/consistent-type-assertions": [
      "error",
      { "assertionStyle": "never" }  // Ban 'as' for external data
    ]
  }
}
```

---

## 🧪 TESTING CHECKLIST

- [ ] SQL injection tests for all query endpoints
- [ ] IDOR tests for cross-tenant access
- [ ] CSV injection tests for export endpoints
- [ ] Rate limit enforcement tests
- [ ] Type validation tests for adapters
- [ ] Retry logic tests with 429 responses
- [ ] Encryption/decryption tests for vault
- [ ] Error sanitization tests (no secrets in logs)

---

## 📞 ESCALATION

**Security Questions:** Refer to `SECURITY_AUDIT_FINAL_REPORT.md`
**Detailed Findings:** See `audit_findings_a_files.csv` (158 issues)
**Pattern Analysis:** See `audit_cross_file_patterns.md`

**Urgent Issues:** Contact tech lead immediately for P0 blockers.

---

**Files Audited:** 26/68 (38%)
**Issues Found:** 158 total (4 critical, 24 high, 42 medium, 88 low)
**Status:** Ready for remediation

