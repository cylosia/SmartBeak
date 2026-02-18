/**
 * Circuit Breaker Configuration
 * 
 * Circuit breaker pattern settings for resilience.
 */

import { parseIntEnv } from './env';

export const circuitBreakerConfig = {
  /** Number of failures before opening circuit */
  failureThreshold: parseIntEnv('CIRCUIT_BREAKER_FAILURE_THRESHOLD', 5),

  /** Time before attempting to close circuit in milliseconds */
  resetTimeoutMs: parseIntEnv('CIRCUIT_BREAKER_RESET_TIMEOUT_MS', 30000),

  /** Maximum calls in half-open state */
  halfOpenMaxCalls: parseIntEnv('CIRCUIT_BREAKER_HALF_OPEN_MAX_CALLS', 3),

  // P1-015 FIX: Default was 300000ms (5 minutes). A 5-minute timeout means each
  // hung dependency request holds a connection for 5 minutes; under concurrent
  // load this exhausts the DB/Redis pool instantly. 30s is the correct default.
  // Override per-deployment with CIRCUIT_BREAKER_TIMEOUT_MS env var if needed.
  /** Default timeout for circuit breaker operations in milliseconds */
  timeoutMs: parseIntEnv('CIRCUIT_BREAKER_TIMEOUT_MS', 30000),
} as const;
