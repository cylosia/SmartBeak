/**
 * Timeout Configuration
 *
 * Timeout settings for various operations.
 */

import { parseIntEnv } from './env';
import { getLogger } from '@kernel/logger';

const logger = getLogger('config:timeouts');

/**
 * FIXED (TIMEOUT-4.1): Guard against zero/negative timeout values.
 * `TIMEOUT_SHORT_MS=0` passes to pg as `statement_timeout = 0`, which disables the
 * timeout entirely — the exact opposite of the intended behaviour.
 * Values ≤ 0 fall back to the compile-time default and emit a console warning.
 */
function parsePositiveIntEnv(name: string, defaultValue: number): number {
  const parsed = parseIntEnv(name, defaultValue);
  if (parsed <= 0) {
    logger.warn(`Invalid timeout configuration`, { variable: name, value: parsed, default: defaultValue });
    return defaultValue;
  }
  return parsed;
}

export const timeoutConfig = {
  /** Short timeout for health checks in milliseconds */
  short: parsePositiveIntEnv('TIMEOUT_SHORT_MS', 5000),

  /** Medium timeout for normal operations in milliseconds */
  medium: parsePositiveIntEnv('TIMEOUT_MEDIUM_MS', 15000),

  /** Long timeout for complex operations in milliseconds */
  long: parsePositiveIntEnv('TIMEOUT_LONG_MS', 30000),

  /** Extended timeout for uploads/downloads in milliseconds */
  extended: parsePositiveIntEnv('TIMEOUT_EXTENDED_MS', 60000),

  /** Maximum bounded timeout in milliseconds (5 minutes) */
  maxBounded: parsePositiveIntEnv('TIMEOUT_MAX_BOUNDED_MS', 300000),
} as const;

/**
 * Default timeouts for various operations (alias for timeoutConfig)
 */
export const DEFAULT_TIMEOUTS = timeoutConfig;
