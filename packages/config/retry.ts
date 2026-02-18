/**
 * Retry Configuration
 *
 * Retry settings for failed operations.
 */

import { parseIntEnv, parseFloatEnv } from './env';

export const retryConfig = {
  /** Maximum retry attempts */
  maxRetries: parseIntEnv('RETRY_MAX_RETRIES', 3),

  /** Base delay in milliseconds */
  baseDelayMs: parseIntEnv('RETRY_BASE_DELAY_MS', 1000),

  /** Maximum delay in milliseconds */
  maxDelayMs: parseIntEnv('RETRY_MAX_DELAY_MS', 60000),

  /** Minimum delay in milliseconds */
  minDelayMs: parseIntEnv('RETRY_MIN_DELAY_MS', 100),

  // P1-FIX: Use parseFloatEnv instead of parseIntEnv for the backoff multiplier.
  // parseIntEnv truncates fractional values: RETRY_BACKOFF_MULTIPLIER=1.5 silently
  // becomes 1, making backoff linear (1s, 1s, 1s) instead of exponential (1s, 1.5s,
  // 2.25s). At multiplier=1 every retry fires at the same delay, defeating the
  // exponential strategy and hammering the failing service instead of backing off.
  /** Backoff multiplier (must be > 1 for exponential growth) */
  backoffMultiplier: parseFloatEnv('RETRY_BACKOFF_MULTIPLIER', 2),

  /** HTTP status codes that trigger retry */
  retryableStatuses: [408, 429, 500, 502, 503, 504] as number[],

  /** Error codes that trigger retry */
  retryableErrorCodes: ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'],
} as const;

// P1-FIX: Validate retry config at module-load time so misconfigured deployments
// fail fast with a clear error rather than silently misbehaving at runtime.
// Examples of dangerous misconfiguration:
//   RETRY_BACKOFF_MULTIPLIER=0  → every retry fires instantly (CPU-burning loop)
//   RETRY_MAX_RETRIES=-1        → retry loop never executes
//   RETRY_MIN_DELAY_MS=60001 with RETRY_MAX_DELAY_MS=60000 → inverted range
(function validateRetryConfig() {
  if (retryConfig.maxRetries < 0) {
    throw new Error('RETRY_MAX_RETRIES must be >= 0');
  }
  if (retryConfig.baseDelayMs <= 0) {
    throw new Error('RETRY_BASE_DELAY_MS must be > 0');
  }
  if (retryConfig.minDelayMs <= 0) {
    throw new Error('RETRY_MIN_DELAY_MS must be > 0');
  }
  if (retryConfig.minDelayMs > retryConfig.maxDelayMs) {
    throw new Error('RETRY_MIN_DELAY_MS must be <= RETRY_MAX_DELAY_MS');
  }
  if (retryConfig.backoffMultiplier <= 1) {
    throw new Error('RETRY_BACKOFF_MULTIPLIER must be > 1 for exponential backoff');
  }
})();
