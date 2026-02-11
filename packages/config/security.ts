/**
 * Security Configuration
 * 
 * SECURITY HARDENING: All security-critical settings now require explicit
 * environment variables. No silent defaults are used to prevent accidental
 * weak configurations in production.
 * 
 * @security CRITICAL - These settings affect authentication and rate limiting
 */

import { requireIntEnv } from './env';

/**
 * Validates that all required security environment variables are set
 * @throws Error if any required security config is missing
 */
function validateSecurityEnv(): void {
  const required = [
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
  ];

  const missing: string[] = [];
  for (const key of required) {
    if (!process.env[key]) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `SECURITY_CONFIG_MISSING:\n` +
      `Missing required security environment variables: ${missing.join(', ')}\n\n` +
      `Please set these in your .env file:\n` +
      missing.map(key => `${key}=<value>`).join('\n') + '\n\n' +
      `Recommended values:\n` +
      `BCRYPT_ROUNDS=12\n` +
      `JWT_EXPIRY_SECONDS=3600\n` +
      `JWT_CLOCK_TOLERANCE_SECONDS=30\n` +
      `JWT_MAX_AGE_SECONDS=604800\n` +
      `MAX_FAILED_LOGINS=5\n` +
      `LOCKOUT_DURATION_MINUTES=30\n` +
      `RATE_LIMIT_MAX_REQUESTS=100\n` +
      `RATE_LIMIT_WINDOW_MS=60000\n` +
      `MAX_RATE_LIMIT_STORE_SIZE=100000\n` +
      `RATE_LIMIT_CLEANUP_INTERVAL_MS=300000`
    );
  }
}

// Validate at module load - fail fast
validateSecurityEnv();

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
 * Validates that all required abuse guard environment variables are set
 * @throws Error if any required config is missing
 */
function validateAbuseGuardEnv(): void {
  const required = [
    'ABUSE_MAX_REQUESTS_PER_MINUTE',
    'ABUSE_BLOCK_DURATION_MINUTES',
    'ABUSE_SUSPICIOUS_THRESHOLD',
    'ABUSE_GUARD_ENABLED',
  ];

  const missing: string[] = [];
  for (const key of required) {
    if (!process.env[key]) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `ABUSE_GUARD_CONFIG_MISSING:\n` +
      `Missing required abuse guard environment variables: ${missing.join(', ')}\n\n` +
      `Please set these in your .env file:\n` +
      missing.map(key => `${key}=<value>`).join('\n') + '\n\n' +
      `Recommended values:\n` +
      `ABUSE_MAX_REQUESTS_PER_MINUTE=100\n` +
      `ABUSE_BLOCK_DURATION_MINUTES=60\n` +
      `ABUSE_SUSPICIOUS_THRESHOLD=80\n` +
      `ABUSE_GUARD_ENABLED=true`
    );
  }
}

// Validate at module load - fail fast
validateAbuseGuardEnv();

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
  /** Enable abuse detection - requires explicit env var */
  enabled: process.env['ABUSE_GUARD_ENABLED'] === 'true',
} as const;
