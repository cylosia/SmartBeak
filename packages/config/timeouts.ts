/**
 * Timeout Configuration
 * 
 * Timeout settings for various operations.
 */

import { parseIntEnv } from './env';

export const timeoutConfig = {
  /** Short timeout for health checks in milliseconds */
  short: parseIntEnv('TIMEOUT_SHORT_MS', 5000),

  /** Medium timeout for normal operations in milliseconds */
  medium: parseIntEnv('TIMEOUT_MEDIUM_MS', 15000),

  /** Long timeout for complex operations in milliseconds */
  long: parseIntEnv('TIMEOUT_LONG_MS', 30000),

  /** Extended timeout for uploads/downloads in milliseconds */
  extended: parseIntEnv('TIMEOUT_EXTENDED_MS', 60000),

  /** Maximum bounded timeout in milliseconds (5 minutes) */
  maxBounded: parseIntEnv('TIMEOUT_MAX_BOUNDED_MS', 300000),
} as const;

/**
 * Default timeouts for various operations (alias for timeoutConfig)
 */
export const DEFAULT_TIMEOUTS = timeoutConfig;
