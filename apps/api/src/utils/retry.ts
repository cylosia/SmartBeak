/**
 * @deprecated Import from @kernel/retry directly.
 * This module re-exports retry utilities for backward compatibility.
 */

// Core retry utilities — canonical implementations in packages/kernel/retry.ts
export {
  withRetry,
  makeRetryable,
  jitteredBackoff,
  isRetryableStatus,
  parseRetryAfter,
  sleep,
} from '@kernel/retry';
export type { RetryOptions, JitteredBackoffOptions } from '@kernel/retry';

// Fetch-specific retry — canonical implementation in packages/utils/fetchWithRetry.ts
export { fetchWithRetry } from '@utils/fetchWithRetry';
