/**
 * I1: Circuit Breaker Registry
 *
 * Singleton registry of named circuit breakers for external service calls.
 * Each service gets its own breaker to prevent cascading failures.
 *
 * Usage:
 *   const breaker = getCircuitBreaker('stripe');
 *   const result = await breaker.execute(() => stripe.subscriptions.retrieve(id));
 */

import { CircuitBreaker, CircuitState } from './retry';
import { getLogger } from './logger';

const logger = getLogger('circuit-breakers');

// Circuit breaker registry
const breakers = new Map<string, CircuitBreaker>();

/**
 * Default circuit breaker options.
 * Can be overridden per-service via environment variables:
 *   CB_<SERVICE>_FAILURE_THRESHOLD (e.g., CB_STRIPE_FAILURE_THRESHOLD=3)
 *   CB_<SERVICE>_RESET_TIMEOUT_MS (e.g., CB_STRIPE_RESET_TIMEOUT_MS=60000)
 *   CB_<SERVICE>_HALF_OPEN_MAX_CALLS (e.g., CB_STRIPE_HALF_OPEN_MAX_CALLS=1)
 */
function getOptionsForService(name: string) {
  const envPrefix = `CB_${name.toUpperCase().replace(/-/g, '_')}`;
  return {
    failureThreshold: parseInt(process.env[`${envPrefix}_FAILURE_THRESHOLD`] || '5', 10),
    resetTimeoutMs: parseInt(process.env[`${envPrefix}_RESET_TIMEOUT_MS`] || '30000', 10),
    halfOpenMaxCalls: parseInt(process.env[`${envPrefix}_HALF_OPEN_MAX_CALLS`] || '3', 10),
  };
}

/**
 * Check if circuit breakers are enabled.
 * Defaults to true in production, configurable via ENABLE_CIRCUIT_BREAKER env var.
 */
export function isCircuitBreakerEnabled(): boolean {
  const envValue = process.env['ENABLE_CIRCUIT_BREAKER'];
  if (envValue === 'false') return false;
  if (envValue === 'true') return true;
  // Default: enabled in production, disabled in test
  return process.env['NODE_ENV'] !== 'test';
}

/**
 * Get or create a circuit breaker for a named service.
 * @param name - Service name (e.g., 'stripe', 'clerk', 'redis', 'analytics-db')
 * @returns CircuitBreaker instance
 */
export function getCircuitBreaker(name: string): CircuitBreaker {
  let breaker = breakers.get(name);
  if (!breaker) {
    const options = getOptionsForService(name);
    breaker = new CircuitBreaker(name, options);
    breakers.set(name, breaker);
    logger.info(`Circuit breaker created for ${name}`, options);
  }
  return breaker;
}

/**
 * Execute a function with circuit breaker protection.
 * If circuit breakers are disabled, executes the function directly.
 *
 * @param serviceName - Name of the external service
 * @param fn - Function to execute
 * @returns Result of the function
 */
export async function withCircuitBreaker<T>(
  serviceName: string,
  fn: () => Promise<T>
): Promise<T> {
  if (!isCircuitBreakerEnabled()) {
    return fn();
  }

  const breaker = getCircuitBreaker(serviceName);
  return breaker.execute(fn);
}

/**
 * Get status of all circuit breakers (for monitoring/health checks).
 */
export function getCircuitBreakerStatus(): Record<string, {
  name: string;
  state: CircuitState;
  enabled: boolean;
}> {
  const status: Record<string, {
    name: string;
    state: CircuitState;
    enabled: boolean;
  }> = {};

  const enabled = isCircuitBreakerEnabled();
  for (const [name, breaker] of breakers) {
    status[name] = {
      name,
      state: breaker.getState(),
      enabled,
    };
  }

  return status;
}

/**
 * Reset all circuit breakers (for testing).
 */
export function resetAllCircuitBreakers(): void {
  breakers.clear();
}
