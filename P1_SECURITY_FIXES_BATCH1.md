# P1 Security Fixes - Batch 1

This document details the 5 P1 security vulnerabilities that were fixed in this batch.

---

## Issue 1: AbuseGuard Schema Without .strict()

**File:** `apps/api/src/middleware/abuseGuard.ts:20-26`
**Severity:** P1 - HIGH
**CWE:** CWE-915: Improperly Controlled Modification of Dynamically-Determined Object Attributes

### Problem
The `AbuseCheckInputSchema` was defined without `.strict()`, allowing mass assignment attacks where additional properties could be passed in the request body that would be silently ignored by Zod validation but could still be processed by downstream code.

### Solution
Added `.strict()` to the schema to reject any input with unexpected properties.

```typescript
// Before
export const AbuseCheckInputSchema = z.object({
  content: z.string().max(100000).optional(),
  riskFlags: z.array(z.string()).max(20).optional(),
  riskOverride: z.boolean().optional(),
  userId: z.string().min(1).max(256).optional(),
  ip: z.string().optional(),
});

// After
export const AbuseCheckInputSchema = z.object({
  content: z.string().max(100000).optional(),
  riskFlags: z.array(z.string()).max(20).optional(),
  riskOverride: z.boolean().optional(),
  userId: z.string().min(1).max(256).optional(),
  ip: z.string().optional(),
}).strict();
```

### Impact
- Prevents mass assignment attacks
- Ensures input validation is strict and predictable
- Fails fast on unexpected input, preventing potential exploitation

---

## Issue 2: RiskOverride Without Role Validation

**File:** `apps/api/src/middleware/abuseGuard.ts:263-271`
**Severity:** P1 - HIGH
**CWE:** CWE-285: Improper Authorization

### Problem
The `riskOverride` flag could be set by any user, allowing non-privileged users to bypass content safety checks. This is a critical authorization flaw.

### Solution
Added role validation to ensure only users with 'admin' role can use riskOverride.

```typescript
// Helper function to check if user can override risks
function canOverrideRisk(user: UserInfo | undefined): boolean {
  if (!user?.role) return false;
  return user.role === 'admin';
}

// In middleware, check role before allowing override
if (assessment.maxRisk >= 50 && !(validated.riskOverride && canOverrideRisk(req.user))) {
  throw new HighRiskContentError(validated.riskFlags, assessment.maxRisk);
}
```

### Impact
- Only administrators can override risk assessments
- Prevents privilege escalation attacks
- Maintains content safety controls

---

## Issue 3: Regex Without Global Flag (State Poisoning)

**File:** `apps/api/src/middleware/abuseGuard.ts:139-146`
**Severity:** P1 - HIGH
**CWE:** CWE-20: Improper Input Validation

### Problem
Regular expressions without the 'g' flag maintain internal state via `lastIndex`. When reused across multiple test calls, this can cause inconsistent matching behavior (state poisoning) and potential bypasses.

### Solution
Added 'g' flag to all patterns and reset `lastIndex` before each use in a loop.

```typescript
// Patterns now include 'g' flag
const SUSPICIOUS_PATTERNS: SuspiciousPattern[] = [
  { pattern: /\b(buy now|click here|limited time)\b/gi, score: 10, name: 'spam_keywords' },
  { pattern: /<script\b/gi, score: 25, name: 'xss_attempt' },
  { pattern: /(javascript|data:|vbscript):/gi, score: 25, name: 'protocol_attack' },
  // ... more patterns
];

// Reset lastIndex before each test
for (const { pattern, score, name } of SUSPICIOUS_PATTERNS) {
  pattern.lastIndex = 0; // Prevent state poisoning
  if (pattern.test(content)) {
    // ...
  }
}
```

### Impact
- Prevents regex state poisoning attacks
- Ensures consistent pattern matching behavior
- Eliminates potential bypass vectors

---

## Issue 4: Console.warn Logs Sensitive Data

**File:** `apps/api/src/middleware/abuseGuard.ts:273-281`
**Severity:** P1 - HIGH
**CWE:** CWE-532: Insertion of Sensitive Information into Log File

### Problem
The middleware was logging potentially sensitive user data (content flags, userId, IP) directly to console.warn without sanitization, creating a data leakage risk.

### Solution
Import and use `sanitizeForLogging` from the security package before logging.

```typescript
import { sanitizeForLogging } from '@security/logger';

// Sanitize before logging
if (contentCheck.riskScore > 0 || (validated.riskFlags?.length ?? 0) > 0) {
  const logData = sanitizeForLogging({
    riskScore: contentCheck.riskScore,
    flags: validated.riskFlags,
    contentFlags: contentCheck.flags,
    userId: validated.userId,
    ip: validated.ip,
  });
  console.warn('[abuseGuard] High risk submission:', logData);
}
```

### Impact
- Prevents sensitive data exposure in logs
- Complies with data privacy regulations
- Reduces attack surface for information leakage

---

## Issue 5: JWT Key Iteration Timing Side-Channel

**File:** `packages/security/jwt.ts:253-282`
**Severity:** P1 - HIGH
**CWE:** CWE-208: Observable Timing Discrepancy

### Problem
When iterating through multiple JWT signing keys for verification, the function would exit early on the first successful verification or after processing all keys. This timing difference could be exploited to determine which key is valid, facilitating key enumeration attacks.

### Solution
Implement constant-time verification that processes all keys regardless of success/failure, with minimal timing variation.

```typescript
// Constant-time verification that processes all keys
let successResult: JwtClaims | null = null;
let lastError: Error | null = null;

for (const key of keys) {
  try {
    const payload = jwt.verify(token, key, { /* options */ });
    const claims = verifyJwtClaims(payload);
    
    if (!claims.sub) {
      throw new TokenInvalidError('Token missing required claim: sub');
    }
    
    // Store result but continue processing for constant-time
    if (successResult === null) {
      successResult = claims;
    }
  } catch (error) {
    // Continue to next key (constant-time behavior)
    if (error instanceof jwt.TokenExpiredError) {
      lastError = new TokenExpiredError(new Date(error.expiredAt));
    } else if (error instanceof AuthError) {
      lastError = error;
    } else {
      lastError = error as Error;
    }
  }
}

// Return success if any key worked
if (successResult !== null) {
  return successResult;
}

// Throw appropriate error
throw lastError || new TokenInvalidError('verification failed');
```

### Impact
- Eliminates timing-based key enumeration attacks
- Provides constant-time verification regardless of key position
- Maintains security during key rotation periods

---

## Testing

All fixes include comprehensive test coverage:

1. **abuseGuard.test.ts** - Tests for schema strictness, role validation, regex state handling, and log sanitization
2. **jwt.test.ts** - Tests for constant-time verification behavior

Run tests with:
```bash
npm test -- packages/security/__tests__/jwt.test.ts
npm test -- apps/api/src/middleware/__tests__/abuseGuard.test.ts
```

---

## Verification Checklist

- [x] Schema uses `.strict()` to prevent mass assignment
- [x] Role validation added for riskOverride
- [x] Regex patterns include 'g' flag with lastIndex reset
- [x] Logs use sanitization before output
- [x] JWT verification uses constant-time key iteration
- [x] All tests pass
- [x] No TypeScript errors
- [x] Security documentation updated
