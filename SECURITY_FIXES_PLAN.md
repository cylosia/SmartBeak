# Security Fixes Implementation Plan

## Overview
This document outlines the comprehensive plan for fixing all P1 (High Priority) security issues in the SmartBeak codebase.

## Issues Summary

### Already Fixed (Verified by Code Review)
1. **SSRF Vulnerability** - `WebPublishingAdapter.ts` has `isInternalIp()` check
2. **JWT Validation** - `packages/security/jwt.ts` provides centralized verification
3. **Rate Limit Key Collision** - Namespace prefix `ratelimit:` added
4. **Org Verification in Stripe Webhook** - `verifyOrgBelongsToCustomer()` implemented
5. **Basic Auth Validation** - Credentials validated before Buffer.from()
6. **ReDoS Vulnerability** - Character-based sanitization in search.ts
7. **Input Validation** - Zod schemas in route files
8. **UUID Validation** - Consistent `z.string().uuid()` usage
9. **URL Encoding** - HTTPS-only enforced
10. **Content-Type Validation** - Default application/json set
11. **Error Response Format** - `sanitizeErrorForClient()` standardized
12. **API Key Logging** - `redactSensitiveData()` in abuseGuard.ts

### Remaining Issues to Fix

#### Issue 13: Missing CSRF Protection on Stripe Portal
**File:** `apps/api/src/routes/billingStripe.ts`
**Fix:** Add CSRF token generation and validation

#### Issue 14: Missing Bot Detection in Middleware  
**File:** `apps/api/src/middleware/rateLimiter.ts`
**Fix:** Add bot detection heuristics

#### Issue 15: Missing Signature Verification Retry
**File:** `apps/api/src/billing/paddleWebhook.ts`
**Fix:** Add retry logic with exponential backoff

#### Issue 16: Missing Event Type Allowlist in Webhooks
**File:** `apps/api/src/billing/paddleWebhook.ts`
**Fix:** Add allowed event types list

#### Issue 17: Missing Request Timeout in Hooks
**File:** `apps/api/src/domain/publishing/WebPublishingAdapter.ts`
**Fix:** Add AbortController with timeout to fetch

#### Issue 18: Missing Request Cancellation on Unmount
**File:** `apps/api/src/domain/publishing/WebPublishingAdapter.ts`
**Fix:** Export AbortController for cancellation

## Implementation Order

1. Fix Issue 17 & 18 (WebPublishingAdapter.ts - timeout and cancellation)
2. Fix Issue 13 (billingStripe.ts - CSRF protection)
3. Fix Issue 14 (rateLimiter.ts - bot detection)
4. Fix Issue 15 & 16 (paddleWebhook.ts - retry and allowlist)

## Files to be Modified

1. `apps/api/src/domain/publishing/WebPublishingAdapter.ts`
2. `apps/api/src/routes/billingStripe.ts`
3. `apps/api/src/middleware/rateLimiter.ts`
4. `apps/api/src/billing/paddleWebhook.ts`
