# Security Configuration Hardening

## Overview

This document describes the security hardening applied to the configuration system to prevent dangerous security defaults and ensure fail-fast behavior on misconfiguration.

**Priority:** P1-CRITICAL  
**Scope:** Configuration validation and environment variable handling  
**Impact:** All services using `@config` package

---

## Vulnerabilities Fixed

### 1. Dangerous Security Defaults (RESOLVED)

**Problem:** Security-sensitive configuration values used silent defaults, potentially leading to weak security in production if environment variables were not explicitly set.

**Vulnerable Code:**
```typescript
// BEFORE - VULNERABLE
export const securityConfig = {
  bcryptRounds: parseIntEnv('BCRYPT_ROUNDS', 12),  // Silent default
  jwtExpirySeconds: parseIntEnv('JWT_EXPIRY_SECONDS', 86400),  // 24 hours
  // ... all had defaults
}
```

**Fix Applied:**
```typescript
// AFTER - SECURE
export const securityConfig = {
  bcryptRounds: requireIntEnv('BCRYPT_ROUNDS'),  // Must be explicitly set
  jwtExpirySeconds: requireIntEnv('JWT_EXPIRY_SECONDS'),  // Must be explicitly set
}
```

**Required Environment Variables:**
- `BCRYPT_ROUNDS` - Minimum 10 in production (recommend 12+)
- `JWT_EXPIRY_SECONDS` - Maximum 86400 (24 hours) recommended
- `JWT_CLOCK_TOLERANCE_SECONDS` - JWT clock skew tolerance
- `JWT_MAX_AGE_SECONDS` - Maximum JWT token age
- `MAX_FAILED_LOGINS` - Failed login attempts before lockout
- `LOCKOUT_DURATION_MINUTES` - Account lockout duration
- `RATE_LIMIT_MAX_REQUESTS` - Rate limit requests per window
- `RATE_LIMIT_WINDOW_MS` - Rate limit window in milliseconds
- `MAX_RATE_LIMIT_STORE_SIZE` - Maximum rate limit entries
- `RATE_LIMIT_CLEANUP_INTERVAL_MS` - Cleanup interval for rate limit store
- `ABUSE_MAX_REQUESTS_PER_MINUTE` - Abuse detection threshold
- `ABUSE_BLOCK_DURATION_MINUTES` - Abuse block duration
- `ABUSE_SUSPICIOUS_THRESHOLD` - Suspicious activity threshold
- `ABUSE_GUARD_ENABLED` - Enable/disable abuse detection

---

### 2. Feature Flags Enable All (RESOLVED)

**Problem:** Feature flags defaulted to `true`, potentially exposing unfinished or sensitive features.

**Vulnerable Code:**
```typescript
// BEFORE - VULNERABLE
export const featureFlags = {
  enableAI: parseBoolEnv('ENABLE_AI', true),  // Defaults ON!
  enableSocialPublishing: parseBoolEnv('ENABLE_SOCIAL_PUBLISHING', true),  // Defaults ON!
  // ... most defaulted to true
}
```

**Fix Applied:**
```typescript
// AFTER - SECURE
export const featureFlags = {
  enableAI: parseBoolEnv('ENABLE_AI', false),  // Defaults OFF
  enableSocialPublishing: parseBoolEnv('ENABLE_SOCIAL_PUBLISHING', false),  // Defaults OFF
  // ... all default to false
}
```

**Feature Flags (all default to false):**
- `ENABLE_AI` - AI content generation
- `ENABLE_SOCIAL_PUBLISHING` - Social media publishing
- `ENABLE_EMAIL_MARKETING` - Email marketing features
- `ENABLE_ANALYTICS` - Analytics features
- `ENABLE_AFFILIATE` - Affiliate program features
- `ENABLE_EXPERIMENTAL` - Experimental features (warns in production)
- `ENABLE_CIRCUIT_BREAKER` - Circuit breaker pattern
- `ENABLE_RATE_LIMITING` - Rate limiting

---

### 3. Missing Required Env Vars (RESOLVED)

**Problem:** Critical environment variables were not enforced at startup.

**Added Required Variables:**
- `NODE_ENV` - Must be 'development', 'production', or 'test'
- `LOG_LEVEL` - Must be 'debug', 'info', 'warn', 'error', or 'silent'
- `SERVICE_NAME` - Service identifier (alphanumeric, hyphens, underscores)

**Existing Required Variables:**
- `CONTROL_PLANE_DB` - Database connection string
- `CLERK_SECRET_KEY` - Clerk authentication secret
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` - Clerk public key
- `CLERK_WEBHOOK_SECRET` - Clerk webhook secret
- `STRIPE_SECRET_KEY` - Stripe payment secret
- `STRIPE_WEBHOOK_SECRET` - Stripe webhook secret
- `JWT_KEY_1` - JWT signing key 1
- `JWT_KEY_2` - JWT signing key 2 (must differ from JWT_KEY_1)

---

## Startup Validation

### `validateStartup()` Function

New comprehensive startup validation that fails fast with detailed error messages:

```typescript
import { validateStartup } from '@config';

// At application startup
try {
  validateStartup();
  console.log('Configuration validated successfully');
} catch (error) {
  console.error('Startup failed:', error.message);
  process.exit(1);
}
```

**Validations Performed:**
1. All required environment variables present
2. No placeholder values in required variables
3. `NODE_ENV` is valid
4. `LOG_LEVEL` is valid
5. `SERVICE_NAME` format is valid
6. `JWT_KEY_1` and `JWT_KEY_2` are different
7. `BCRYPT_ROUNDS` >= 10 in production
8. `JWT_EXPIRY_SECONDS` <= 86400 (24 hours)

---

## API Changes

### New Exports

```typescript
// Environment utilities
import { requireIntEnv, requireBoolEnv } from '@config';

// Validation
import { validateStartup } from '@config';

// Feature flags
import { getEnabledFeatures, validateFeatureFlags } from '@config';
```

### Behavior Changes

| Function | Before | After |
|----------|--------|-------|
| `parseIntEnv(name, default)` | Returns default if not set | Unchanged (for non-critical configs) |
| `requireIntEnv(name)` | Did not exist | Throws if not set |
| `parseBoolEnv(name, default)` | Often used with `true` default | Now uses `false` default for features |
| `requireBoolEnv(name)` | Did not exist | Throws if not set |
| `validateEnv()` | Basic validation | Enhanced with specific value validation |
| `validateStartup()` | Did not exist | Comprehensive startup validation |

---

## Migration Guide

### For Development

Add to your `.env` file:

```bash
# Core
NODE_ENV=development
LOG_LEVEL=debug
SERVICE_NAME=smartbeak-api

# Security (copy these exact values for development)
BCRYPT_ROUNDS=10
JWT_EXPIRY_SECONDS=3600
JWT_CLOCK_TOLERANCE_SECONDS=30
JWT_MAX_AGE_SECONDS=604800
MAX_FAILED_LOGINS=5
LOCKOUT_DURATION_MINUTES=30
RATE_LIMIT_MAX_REQUESTS=100
RATE_LIMIT_WINDOW_MS=60000
MAX_RATE_LIMIT_STORE_SIZE=1000
RATE_LIMIT_CLEANUP_INTERVAL_MS=300000
ABUSE_MAX_REQUESTS_PER_MINUTE=100
ABUSE_BLOCK_DURATION_MINUTES=60
ABUSE_SUSPICIOUS_THRESHOLD=80
ABUSE_GUARD_ENABLED=false

# Features (enable as needed)
ENABLE_AI=false
ENABLE_SOCIAL_PUBLISHING=false
ENABLE_EMAIL_MARKETING=false
ENABLE_ANALYTICS=false
ENABLE_AFFILIATE=false
ENABLE_EXPERIMENTAL=false
ENABLE_CIRCUIT_BREAKER=false
ENABLE_RATE_LIMITING=false
```

### For Production

```bash
# Core
NODE_ENV=production
LOG_LEVEL=warn
SERVICE_NAME=smartbeak-api-prod

# Security (use strong values)
BCRYPT_ROUNDS=12
JWT_EXPIRY_SECONDS=3600
JWT_CLOCK_TOLERANCE_SECONDS=30
JWT_MAX_AGE_SECONDS=604800
MAX_FAILED_LOGINS=5
LOCKOUT_DURATION_MINUTES=30
RATE_LIMIT_MAX_REQUESTS=100
RATE_LIMIT_WINDOW_MS=60000
MAX_RATE_LIMIT_STORE_SIZE=100000
RATE_LIMIT_CLEANUP_INTERVAL_MS=300000
ABUSE_MAX_REQUESTS_PER_MINUTE=100
ABUSE_BLOCK_DURATION_MINUTES=60
ABUSE_SUSPICIOUS_THRESHOLD=80
ABUSE_GUARD_ENABLED=true

# Features (explicitly enable required features)
ENABLE_AI=true
ENABLE_SOCIAL_PUBLISHING=true
ENABLE_EMAIL_MARKETING=true
ENABLE_ANALYTICS=true
ENABLE_AFFILIATE=true
ENABLE_EXPERIMENTAL=false
ENABLE_CIRCUIT_BREAKER=true
ENABLE_RATE_LIMITING=true
```

---

## Testing

### Running Configuration Tests

```bash
# Run all config tests
npm test -- packages/config/__tests__

# Run specific test file
npm test -- packages/config/__tests__/env.security.test.ts
npm test -- packages/config/__tests__/security.config.test.ts
npm test -- packages/config/__tests__/features.config.test.ts
npm test -- packages/config/__tests__/validation.config.test.ts
npm test -- packages/config/__tests__/startup.validation.test.ts
```

### Test Coverage

- ✅ Missing security env vars throw
- ✅ Invalid security values throw
- ✅ Feature flags default to false
- ✅ Explicit feature enable works
- ✅ Startup fails with missing critical config
- ✅ Placeholder detection works
- ✅ JWT key uniqueness validation

---

## Security Best Practices

1. **Never commit `.env` files** to version control
2. **Use strong BCRYPT_ROUNDS** (12+ in production)
3. **Keep JWT expiry short** (1 hour recommended)
4. **Use different JWT keys** for signing and rotation
5. **Enable only needed features** in production
6. **Review enabled features** before each deployment
7. **Monitor logs** for configuration warnings

---

## Related Files

- `packages/config/security.ts` - Security configuration
- `packages/config/features.ts` - Feature flags
- `packages/config/validation.ts` - Validation logic
- `packages/config/env.ts` - Environment utilities
- `packages/config/index.ts` - Package exports
- `packages/config/__tests__/*.test.ts` - Test files

---

## References

- [OWASP Configuration Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Configuration_Cheat_Sheet.html)
- [CWE-200: Exposure of Sensitive Information](https://cwe.mitre.org/data/definitions/200.html)
- [CWE-250: Execution with Unnecessary Privileges](https://cwe.mitre.org/data/definitions/250.html)
