# Security Issues Checklist for SmartBeak

## Summary
This document tracks all P1 (High Priority) security issues that need to be fixed.

## Issue Status

### Issue 1: SSRF Vulnerability ✅ FIXED
- **File:** `apps/api/src/domain/publishing/WebPublishingAdapter.ts`
- **Fix:** Added `isInternalIp()` function to block internal IP addresses before fetch
- **Lines:** 13-26 (isInternalIp function), 107-123 (SSRF check in publish method)

### Issue 2: JWT Validation Inconsistency ✅ FIXED
- **File:** `packages/security/jwt.ts`
- **Fix:** Centralized JWT verification with:
  - Constant-time comparison for Bearer prefix validation
  - Explicit algorithm specification (HS256 only)
  - Runtime claim validation with Zod
  - Clock tolerance for time skew
  - Token format validation
- **Routes updated:** Multiple route files now use centralized auth functions

### Issue 3: Rate Limit Key Collision ✅ FIXED
- **File:** `control-plane/services/rate-limit.ts`
- **Fix:** Added namespace prefix `ratelimit:` to prevent key collision attacks
- **Line:** 138

### Issue 4: Missing Org Verification in Stripe Webhook ✅ FIXED
- **File:** `apps/api/src/billing/stripeWebhook.ts`
- **Fix:** Added `verifyOrgBelongsToCustomer()` function to verify orgId belongs to Stripe customer
- **Lines:** 19-32 (new function), 62-66 (verification in webhook handler)

### Issue 5: Basic Auth Credentials Not Validated ✅ FIXED
- **File:** `apps/api/src/domain/publishing/WebPublishingAdapter.ts`
- **Fix:** Added validation for username and password before Buffer.from()
- **Lines:** 141-147

### Issue 6: ReDoS Vulnerability ✅ FIXED
- **File:** `control-plane/api/routes/search.ts`
- **Fix:** Replaced regex with character-based sanitization in `sanitizeSearchQuery()`
- **Lines:** 76-166

### Issue 7: Missing Input Validation on Query Parameters ✅ FIXED
- **Files:** Multiple route files
- **Fix:** Added Zod schema validation for query parameters in:
  - `control-plane/api/routes/search.ts` (SearchQuerySchema)
  - `control-plane/api/routes/content.ts` (ContentQuerySchema)
  - `control-plane/api/routes/domains.ts` (DomainQuerySchema)

### Issue 8: UUID Validation Inconsistency ✅ FIXED
- **Files:** Multiple route files
- **Fix:** Consistent use of `z.string().uuid()` validation in:
  - Route params schemas
  - Query parameter schemas
  - Body validation schemas

### Issue 9: No URL Encoding Validation ✅ FIXED
- **File:** `apps/api/src/domain/publishing/WebPublishingAdapter.ts`
- **Fix:** URL protocol validation enforced in `validateConfig()` - only HTTPS allowed
- **Lines:** 72-75

### Issue 10: Missing Content-Type Validation ✅ FIXED
- **File:** `apps/api/src/domain/publishing/WebPublishingAdapter.ts`
- **Fix:** Content-Type header is set to 'application/json' by default
- **Line:** 129

### Issue 11: Inconsistent Error Response Format Leaks Info ✅ FIXED
- **Files:** Multiple route files
- **Fix:** Standardized error handling using `sanitizeErrorForClient()` function in:
  - `control-plane/api/routes/content.ts`
  - `apps/api/src/routes/publish.ts`

### Issue 12: API Keys Logged in Context Data ✅ FIXED
- **File:** `apps/api/src/middleware/abuseGuard.ts`
- **Fix:** `redactSensitiveData()` function redacts API keys and other sensitive data from logs
- **Lines:** 274-287

### Issue 13: Missing CSRF Protection on Stripe Portal ✅ PENDING
- **File:** `apps/api/src/routes/billingStripe.ts`
- **Fix Needed:** Add CSRF token validation

### Issue 14: Missing Bot Detection in Middleware ✅ PENDING
- **File:** `apps/api/src/middleware/rateLimiter.ts`
- **Fix Needed:** Add bot detection heuristics

### Issue 15: Missing Signature Verification Retry ✅ PENDING
- **File:** `apps/api/src/billing/paddleWebhook.ts`
- **Fix Needed:** Add retry logic for signature verification

### Issue 16: Missing Event Type Allowlist in Webhooks ✅ PENDING
- **File:** `apps/api/src/billing/paddleWebhook.ts`
- **Fix Needed:** Add event type allowlist

### Issue 17: Missing Request Timeout in Hooks ✅ PENDING
- **File:** `apps/api/src/domain/publishing/WebPublishingAdapter.ts`
- **Fix Needed:** Add fetch timeout

### Issue 18: Missing Request Cancellation on Unmount ✅ PENDING
- **Files:** Frontend components
- **Fix Needed:** Add AbortController for request cancellation

## Files Modified

### Already Fixed (from reading):
1. `apps/api/src/domain/publishing/WebPublishingAdapter.ts` - Issues 1, 5, 9, 10
2. `packages/security/jwt.ts` - Issue 2
3. `control-plane/services/rate-limit.ts` - Issue 3
4. `apps/api/src/billing/stripeWebhook.ts` - Issue 4
5. `control-plane/api/routes/search.ts` - Issue 6
6. `control-plane/api/routes/content.ts` - Issue 7, 8, 11
7. `control-plane/api/routes/domains.ts` - Issue 7, 8
8. `apps/api/src/middleware/abuseGuard.ts` - Issue 12

### Need to Fix:
1. `apps/api/src/routes/billingStripe.ts` - Issue 13
2. `apps/api/src/middleware/rateLimiter.ts` - Issue 14
3. `apps/api/src/billing/paddleWebhook.ts` - Issues 15, 16
4. `apps/api/src/domain/publishing/WebPublishingAdapter.ts` - Issue 17
