import { Mutex } from 'async-mutex';
import { emitMetric } from '../ops/metrics';
import { getLogger } from '@kernel/logger';

const _logger = getLogger('resilience');
// ============================================================================
// Timeout Function
// ============================================================================
/**
 * Execute a promise with a timeout
 * @param promise - Promise to execute
 * @param ms - Timeout in milliseconds
 * @returns Promise result
 * @throws Error if timeout is exceeded
 * MEDIUM FIX M15: Bounded timeout
 */
export async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    const boundedMs = Math.min(Math.max(1, ms), 300000);
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`Timeout exceeded after ${boundedMs}ms`)), boundedMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  }
  finally {
    clearTimeout(timeoutId);
  }
}
// ============================================================================
// Circuit Breaker
// ============================================================================
/**
 * Circuit breaker implementation for fault tolerance
 * MEDIUM FIX M15: Bounded failures counter
 */


export interface CircuitBreakerConfig {
  /** Number of failures before opening the circuit */
  failureThreshold: number;
  /** Time in milliseconds before attempting to close the circuit */
  resetTimeoutMs: number;
  /** Circuit breaker name for metrics */
  name: string;
  /** P1-FIX: Maximum attempts in half-open state before closing or re-opening */
  halfOpenMaxAttempts?: number;
}

const VALID_ADAPTER_NAMES = ['google-analytics', 'facebook', 'gsc', 'vercel', 'instagram', 'youtube', 'pinterest', 'linkedin', 'mailchimp', 'constant-contact', 'aweber'] as const;
export type ValidAdapterName = typeof VALID_ADAPTER_NAMES[number];

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
  * @param fn - Function to wrap
  * @param config - Circuit breaker configuration
  */
  constructor(fn: T, config: CircuitBreakerConfig) {
    this.fn = fn;
    this.config = config;
  }
  /**
  * Execute the wrapped function with circuit breaker protection
  * @param args - Arguments to pass to the function
  * @returns Function result
  * @throws CircuitOpenError if circuit is open
  */
  async execute(...args: Parameters<T>): Promise<ReturnType<T> extends Promise<infer R> ? R : never> {
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
      const result = await this.fn(...args);
      await this.onSuccess();
      return result as ReturnType<T> extends Promise<infer R> ? R : never;
    }
    catch (error) {
      await this.onFailure();
      throw error;
    }
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
// Factory Function
// ============================================================================
/**
 * Factory function for creating circuit breaker wrapped functions
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
  const breaker = new CircuitBreaker(fn, {
    failureThreshold,
    resetTimeoutMs: 30000, // 30 seconds
    name,
  });
  return ((...args: Parameters<T>) => breaker.execute(...args)) as (...args: Parameters<T>) => Promise<ReturnType<T> extends Promise<infer R> ? R : never>;
}
