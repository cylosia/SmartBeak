/**
 * Circuit Breaker Configuration
 * 
 * Circuit breaker pattern settings for resilience.
 */

import { parseIntEnv } from './env';

export const circuitBreakerConfig = {
  /** I1-FIX: Circuit breakers enabled by default (was disabled) */
  enabled: process.env['ENABLE_CIRCUIT_BREAKER'] !== 'false',

  /** Number of failures before opening circuit */
  failureThreshold: parseIntEnv('CIRCUIT_BREAKER_FAILURE_THRESHOLD', 5),

  /** Time before attempting to close circuit in milliseconds */
  resetTimeoutMs: parseIntEnv('CIRCUIT_BREAKER_RESET_TIMEOUT_MS', 30000),

  /** Maximum calls in half-open state */
  halfOpenMaxCalls: parseIntEnv('CIRCUIT_BREAKER_HALF_OPEN_MAX_CALLS', 3),

  /** Default timeout for circuit breaker operations in milliseconds */
  timeoutMs: parseIntEnv('CIRCUIT_BREAKER_TIMEOUT_MS', 300000),
} as const;
