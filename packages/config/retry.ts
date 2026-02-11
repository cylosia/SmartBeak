/**
 * Retry Configuration
 * 
 * Retry settings for failed operations.
 */

import { parseIntEnv } from './env';

export const retryConfig = {
  /** Maximum retry attempts */
  maxRetries: parseIntEnv('RETRY_MAX_RETRIES', 3),

  /** Base delay in milliseconds */
  baseDelayMs: parseIntEnv('RETRY_BASE_DELAY_MS', 1000),

  /** Maximum delay in milliseconds */
  maxDelayMs: parseIntEnv('RETRY_MAX_DELAY_MS', 60000),

  /** Minimum delay in milliseconds */
  minDelayMs: parseIntEnv('RETRY_MIN_DELAY_MS', 100),

  /** Backoff multiplier */
  backoffMultiplier: parseIntEnv('RETRY_BACKOFF_MULTIPLIER', 2),

  /** HTTP status codes that trigger retry */
  retryableStatuses: [408, 429, 500, 502, 503, 504] as number[],

  /** Error codes that trigger retry */
  retryableErrorCodes: ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'],
} as const;
