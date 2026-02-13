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
// ============================================================================
// Singleton Circuit Breaker Registry
// ============================================================================

/**
 * Module-level registry to share circuit breaker state across all callers
 * using the same name. This ensures failure tracking is per-service, not
 * per-adapter-instance.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const circuitBreakerRegistry = new Map<string, CircuitBreaker<any>>();

/**
 * Get the circuit breaker registry (for testing/monitoring)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getCircuitBreakerRegistry(): ReadonlyMap<string, CircuitBreaker<any>> {
  return circuitBreakerRegistry;
}

/**
 * Reset the circuit breaker registry (for testing/shutdown)
 */
export function resetCircuitBreakerRegistry(): void {
  circuitBreakerRegistry.clear();
}

export class CircuitBreaker<T extends (...args: unknown[]) => Promise<unknown>> {
  fn: T;
  config: CircuitBreakerConfig;
  failures = 0;
  open = false;
  lastFailureTime: number | undefined;
  halfOpenAttempts = 0;
  successCount = 0;
  STATS_RESET_THRESHOLD = 10000;
  private stateLock = new Mutex();
  /**
  * Create a new CircuitBreaker
  * @param fn - Function to wrap (used by legacy withCircuitBreaker; ignored by executeWithCircuitBreaker)
  * @param config - Circuit breaker configuration
  */
  constructor(fn: T, config: CircuitBreakerConfig) {
    this.fn = fn;
    this.config = config;
  }

  /**
  * Execute a function with circuit breaker protection.
  * Accepts the function to execute as a parameter so the CB state (failures,
  * open/closed) can be shared across callers while each caller provides its
  * own function closure (important for correct `this` binding in adapters).
  * @param fn - Function to execute (overrides constructor fn)
  * @param signal - Optional AbortSignal
  * @returns Function result
  * @throws CircuitOpenError if circuit is open
  */
  async executeFn<R>(fn: () => Promise<R>, signal?: AbortSignal): Promise<R> {
    if (signal?.aborted) {
      throw new Error('Circuit breaker execution aborted');
    }

    // Check if we should try closing the circuit - acquire lock for state check
    const shouldAttemptReset = await this.stateLock.runExclusive(() => {
      if (this.open) {
        const timeSinceLastFailure = Date.now() - (this.lastFailureTime || 0);
        if (timeSinceLastFailure < this.config.resetTimeoutMs) {
          return false; // Still open
        }
        // Transition to half-open
        this.open = false;
        emitMetric({ name: 'circuit_half_open', labels: { name: this.config.name } });
      }
      // Track attempts in half-open state
      if (!this.open && this.failures > 0) {
        this.halfOpenAttempts++;
      }
      return true;
    });

    if (!shouldAttemptReset) {
      emitMetric({ name: 'circuit_open_block', labels: { name: this.config.name } });
      throw new CircuitOpenError(`Circuit breaker open for ${this.config.name}`);
    }

    try {
      const result = await fn();
      await this.onSuccess();
      return result;
    }
    catch (error) {
      // Don't count abort-related errors as circuit breaker failures
      if (error instanceof Error && error.name === 'AbortError') {
        throw error;
      }
      await this.onFailure();
      throw error;
    }
  }

  /**
  * Execute the wrapped function with circuit breaker protection (legacy API).
  * Uses the function provided in the constructor.
  * @param args - Arguments to pass to the function
  * @returns Function result
  * @throws CircuitOpenError if circuit is open
  */
  async execute(...args: Parameters<T>): Promise<ReturnType<T> extends Promise<infer R> ? R : never> {
    return this.executeFn(() => this.fn(...args) as Promise<ReturnType<T> extends Promise<infer R> ? R : never>);
  }
  /**
  * Handle successful execution
  * P1-FIX: Made async and protected with mutex for thread-safe state updates
  * AUDIT-FIX: Only reset failures during half-open → closed transition,
  * requiring consecutive successes (halfOpenMaxAttempts, default 1)
  */
  async onSuccess(): Promise<void> {
    await this.stateLock.runExclusive(() => {
      if (!this.open && this.failures > 0) {
        // Half-open state: count consecutive successes before closing
        this.successCount++;
        const required = this.config.halfOpenMaxAttempts ?? 1;
        if (this.successCount >= required) {
          this.failures = 0;
          this.halfOpenAttempts = 0;
          this.successCount = 0;
          emitMetric({ name: 'circuit_closed', labels: { name: this.config.name } });
        }
      }
    });
  }
  /**
  * Handle failed execution
  * P1-FIX: Made async and protected with mutex for thread-safe state updates
  */
  async onFailure(): Promise<void> {
    await this.stateLock.runExclusive(() => {
      this.failures++;
      this.successCount = 0; // Reset consecutive success counter
      this.lastFailureTime = Date.now();
      emitMetric({
        name: 'circuit_failure',
        labels: { name: this.config.name, count: this.failures.toString() }
      });
      if (this.failures >= this.config.failureThreshold && !this.open) {
        this.open = true;
        this.halfOpenAttempts = 0;
        emitMetric({ name: 'circuit_open', labels: { name: this.config.name } });
      }
    });
  }
  /**
  * Get current circuit state
  * P1-FIX: Added mutex protection for thread-safe state reads
  * @returns Current state: 'closed', 'open', or 'half-open'
  */
  async getState(): Promise<'closed' | 'open' | 'half-open'> {
    return this.stateLock.runExclusive(() => {
      if (this.open)
        return 'open';
      if (this.failures > 0)
        return 'half-open';
      return 'closed';
    });
  }
}
// ============================================================================
// Circuit Open Error
// ============================================================================
/**
 * Error thrown when circuit breaker is open
 */
export class CircuitOpenError extends Error {
  /**
  * Create a CircuitOpenError
  * @param message - Error message
  */
  constructor(message: string) {
    super(message);
    this.name = 'CircuitOpenError';
  }
}
// ============================================================================
// Factory Functions
// ============================================================================

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
    // Create a placeholder fn for the constructor (not used by executeFn)
    const placeholder = (() => Promise.resolve()) as unknown as (...args: unknown[]) => Promise<unknown>;
    breaker = new CircuitBreaker(placeholder, {
      failureThreshold,
      resetTimeoutMs: 30000,
      name,
    });
    circuitBreakerRegistry.set(name, breaker);
  }
  return breaker.executeFn(fn, signal);
}

/**
 * Factory function for creating circuit breaker wrapped functions.
 * Uses the singleton registry so circuit breaker state is shared
 * across all callers with the same name.
 *
 * @deprecated Use executeWithCircuitBreaker() for new code to avoid
 * capturing stale `this` references in adapter constructors.
 *
 * @param fn - Function to wrap
 * @param failureThreshold - Number of failures before opening (default: 3)
 * @param name - Circuit breaker name (default: 'unknown')
 * @returns Wrapped function
 */
export function withCircuitBreaker<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  failureThreshold = 3,
  name = 'unknown'
): (...args: Parameters<T>) => Promise<ReturnType<T> extends Promise<infer R> ? R : never> {
  // Get or create the singleton breaker for this name
  if (!circuitBreakerRegistry.has(name)) {
    const breaker = new CircuitBreaker(fn, {
      failureThreshold,
      resetTimeoutMs: 30000,
      name,
    });
    circuitBreakerRegistry.set(name, breaker);
  }
  const breaker = circuitBreakerRegistry.get(name)!;
  return ((...args: Parameters<T>) => breaker.executeFn(() => fn(...args) as Promise<ReturnType<T> extends Promise<infer R> ? R : never>)) as (...args: Parameters<T>) => Promise<ReturnType<T> extends Promise<infer R> ? R : never>;
}
