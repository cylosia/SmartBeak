/**
 * Security Configuration
 *
 * SECURITY HARDENING: All security-critical settings now require explicit
 * environment variables. No silent defaults are used to prevent accidental
 * weak configurations in production.
 *
 * @security CRITICAL - These settings affect authentication and rate limiting
 */

import { requireIntEnv, requireBoolEnv } from './env';

// ─────────────────────────────────────────────────────────────────────────────
// C-03-FIX: Consolidated validation. Previously two independent validators ran
// at module load time. If `validateSecurityEnv` passed but `validateAbuseGuardEnv`
// failed, the module partially initialised: `securityConfig` was assigned and
// exported, but `abuseGuardConfig` was never set. Any consumer that imported
// `securityConfig` but not `abuseGuardConfig` saw incomplete state. Now a single
// `validateAllSecurityEnv` call runs before any exports are assigned — either
// everything validates or nothing is exported.
//
// C-02-FIX: Removed "Recommended values" section from thrown error messages.
// Those messages reached external log aggregators (Datadog, Sentry, PagerDuty),
// exposing the exact numeric values of bcrypt cost, JWT TTL, and rate limits to
// anyone with read access to those systems. A reference to the internal runbook
// is sufficient — operators who need the values can consult it.
// ─────────────────────────────────────────────────────────────────────────────

function validateAllSecurityEnv(): void {
  const allRequired = [
    // Security group
    'BCRYPT_ROUNDS',
    'JWT_EXPIRY_SECONDS',
    'JWT_CLOCK_TOLERANCE_SECONDS',
    'JWT_MAX_AGE_SECONDS',
    'MAX_FAILED_LOGINS',
    'LOCKOUT_DURATION_MINUTES',
    'RATE_LIMIT_MAX_REQUESTS',
    'RATE_LIMIT_WINDOW_MS',
    'MAX_RATE_LIMIT_STORE_SIZE',
    'RATE_LIMIT_CLEANUP_INTERVAL_MS',
    // Abuse guard group
    'ABUSE_MAX_REQUESTS_PER_MINUTE',
    'ABUSE_BLOCK_DURATION_MINUTES',
    'ABUSE_SUSPICIOUS_THRESHOLD',
    'ABUSE_GUARD_ENABLED',
  ];

  const missing = allRequired.filter(k => !process.env[k]);

  if (missing.length > 0) {
    // C-02-FIX: Do not include recommended numeric values in error messages.
    // Those values reach external log aggregators and expose security parameters.
    throw new Error(
      `SECURITY_CONFIG_MISSING: Missing required security environment variables: ${missing.join(', ')}\n` +
      `See the internal secrets runbook for setup instructions.`
    );
  }
}

// Validate all variables atomically before any export — fail fast
validateAllSecurityEnv();

export const securityConfig = {
  /** bcrypt rounds for password hashing */
  bcryptRounds: requireIntEnv('BCRYPT_ROUNDS'),

  /** JWT expiry in seconds */
  jwtExpirySeconds: requireIntEnv('JWT_EXPIRY_SECONDS'),

  /** JWT clock tolerance in seconds */
  jwtClockToleranceSeconds: requireIntEnv('JWT_CLOCK_TOLERANCE_SECONDS'),

  /** Max age for JWT token in seconds */
  jwtMaxAgeSeconds: requireIntEnv('JWT_MAX_AGE_SECONDS'),

  /** Maximum failed login attempts before lockout */
  maxFailedLogins: requireIntEnv('MAX_FAILED_LOGINS'),

  /** Account lockout duration in minutes */
  lockoutDurationMinutes: requireIntEnv('LOCKOUT_DURATION_MINUTES'),

  /** Rate limit max requests per window */
  rateLimitMaxRequests: requireIntEnv('RATE_LIMIT_MAX_REQUESTS'),

  /** Rate limit window in milliseconds */
  rateLimitWindowMs: requireIntEnv('RATE_LIMIT_WINDOW_MS'),

  /** Maximum rate limit store size */
  maxRateLimitStoreSize: requireIntEnv('MAX_RATE_LIMIT_STORE_SIZE'),

  /** Cleanup interval for rate limit store in milliseconds */
  rateLimitCleanupIntervalMs: requireIntEnv('RATE_LIMIT_CLEANUP_INTERVAL_MS'),
} as const;

/**
 * Abuse guard configuration for rate limiting and abuse detection
 * SECURITY FIX: All values now require explicit environment variables
 */
export const abuseGuardConfig = {
  /** Maximum requests per minute */
  maxRequestsPerMinute: requireIntEnv('ABUSE_MAX_REQUESTS_PER_MINUTE'),
  /** Block duration in minutes */
  blockDurationMinutes: requireIntEnv('ABUSE_BLOCK_DURATION_MINUTES'),
  /** Suspicious threshold (requests) */
  suspiciousThreshold: requireIntEnv('ABUSE_SUSPICIOUS_THRESHOLD'),
  // C-01-FIX: Use requireBoolEnv instead of `=== 'true'` string comparison.
  // `ABUSE_GUARD_ENABLED=yes` or `ABUSE_GUARD_ENABLED=1` silently disabled the guard
  // with the old comparison. requireBoolEnv accepts true/false/1/0 and throws on any
  // other value, making misconfiguration loud rather than silent.
  enabled: requireBoolEnv('ABUSE_GUARD_ENABLED'),
} as const;
