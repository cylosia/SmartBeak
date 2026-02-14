/**
 * @deprecated Import from @kernel/retry directly.
 * This module re-exports resilience utilities for backward compatibility.
 * Circuit breaker implementation for fault tolerance
 * MEDIUM FIX M15: Bounded failures counter
 * Singleton per name: circuit breaker state is shared across all callers
 * using the same name, ensuring failures are tracked globally per service.
 */

// Core resilience utilities — canonical implementations in packages/kernel/retry.ts
export {
  withTimeout,
  CircuitBreaker,
  CircuitOpenError,
  withCircuitBreaker,
  type CircuitBreakerOptions,
} from '@kernel/retry';

// App-specific adapter names (not part of kernel)
const VALID_ADAPTER_NAMES = ['google-analytics', 'facebook', 'gsc', 'vercel', 'instagram', 'youtube', 'pinterest', 'linkedin', 'mailchimp', 'constant-contact', 'aweber'] as const;
export type ValidAdapterName = typeof VALID_ADAPTER_NAMES[number];

// Re-export CircuitBreakerConfig as an alias to CircuitBreakerOptions for backward compat
export type { CircuitBreakerOptions as CircuitBreakerConfig } from '@kernel/retry';

import { CircuitBreaker } from '@kernel/retry';

// ============================================================================
// Singleton Circuit Breaker Registry
// ============================================================================

/**
 * Module-level registry to share circuit breaker state across all callers
 * using the same name. This ensures failure tracking is per-service, not
 * per-adapter-instance.
 */
const circuitBreakerRegistry = new Map<string, CircuitBreaker>();

/**
 * Get the circuit breaker registry (for testing/monitoring)
 */
export function getCircuitBreakerRegistry(): ReadonlyMap<string, CircuitBreaker> {
  return circuitBreakerRegistry;
}

/**
 * Reset the circuit breaker registry (for testing/shutdown)
 */
export function resetCircuitBreakerRegistry(): void {
  circuitBreakerRegistry.clear();
}

/**
 * Execute a function with a singleton circuit breaker, keyed by name.
 * The circuit breaker state (failures, open/closed) is shared across all
 * callers using the same name. The function itself is provided per-call,
 * so each caller can bind its own `this` context.
 *
 * @param name - Circuit breaker name (should identify the dependency/service)
 * @param fn - Function to execute
 * @param failureThreshold - Number of failures before opening (default: 3)
 * @param signal - Optional AbortSignal
 * @returns Function result
 */
export async function executeWithCircuitBreaker<R>(
  name: string,
  fn: () => Promise<R>,
  failureThreshold = 3,
  signal?: AbortSignal
): Promise<R> {
  let breaker = circuitBreakerRegistry.get(name);
  if (!breaker) {
    breaker = new CircuitBreaker(name, {
      failureThreshold,
      resetTimeoutMs: 30000,
      halfOpenMaxCalls: 3,
    });
    circuitBreakerRegistry.set(name, breaker);
  }
  return breaker.execute(fn, signal);
}
