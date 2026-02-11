import { getLogger } from '@kernel/logger';

/**
* Retry Utilities
*
* Provides retry logic with exponential backoff, circuit breaker pattern,
* and decorators for making functions retryable.
*/

const logger = getLogger('retry');

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
* Options for retry operations
*/
export interface RetryOptions {
  /** Maximum number of retry attempts */
  maxRetries: number;
  /** Initial delay in milliseconds */
  initialDelayMs: number;
  /** Maximum delay in milliseconds */
  maxDelayMs: number;
  /** Multiplier for exponential backoff */
  backoffMultiplier: number;
  /** Error message patterns to retry */
  retryableErrors?: string[];
  /** Custom function to determine if error is retryable */
  shouldRetry?: (error: Error) => boolean;
  /** Callback invoked on each retry attempt */
  onRetry?: (error: Error, attempt: number) => void;
}

/**
* Options for circuit breaker
*/
export interface CircuitBreakerOptions {
  /** Number of failures before opening circuit */
  failureThreshold: number;
  /** Time in milliseconds before attempting to close */
  resetTimeoutMs: number;
  /** Maximum calls allowed in half-open state */
  halfOpenMaxCalls: number;
}

// ============================================================================
// Constants
// ============================================================================

// P1-FIX: Maximum items to track for retry history to prevent unbounded memory growth
const MAX_RETRY_HISTORY = 1000;

const DEFAULT_OPTIONS: RetryOptions = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  retryableErrors: [
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'timeout',
  'rate limit',
  'too many requests',
  ],
};

// ARCH-FIX: Bounded retry history with TTL-based cleanup to prevent memory leaks
interface RetryHistoryEntry {
  timestamps: number[];
  lastAccessed: number;
}

const retryHistory = new Map<string, RetryHistoryEntry>();
const HISTORY_TTL_MS = 3600000; // 1 hour TTL for history entries
const MAX_HISTORY_KEYS = 10000; // Maximum number of keys to track

/**
* ARCH-FIX: Clean old retry history entries to prevent unbounded growth
* Implements TTL-based eviction and size limits
* @param key - History key
* @param timestamp - Current timestamp
*/
function trackRetryAttempt(key: string, timestamp: number): void {
  const entry = retryHistory.get(key);
  const history = entry ? entry.timestamps : [];
  
  history.push(timestamp);

  // Keep only recent history to prevent memory leak
  if (history.length > MAX_RETRY_HISTORY) {
    history.shift();
  }

  retryHistory.set(key, {
    timestamps: history,
    lastAccessed: timestamp,
  });
  
  // ARCH-FIX: Periodic cleanup of old entries
  if (retryHistory.size > MAX_HISTORY_KEYS) {
    cleanupOldHistoryEntries(timestamp);
  }
}

/**
* ARCH-FIX: Remove old history entries based on TTL
*/
function cleanupOldHistoryEntries(now: number): void {
  const cutoff = now - HISTORY_TTL_MS;
  for (const [key, entry] of retryHistory.entries()) {
    if (entry.lastAccessed < cutoff) {
      retryHistory.delete(key);
    }
  }
}

/**
* Clean old retry history entries
* ARCH-FIX: Uses TTL-based eviction for better memory management
* @param maxAgeMs - Maximum age of entries to keep
*/
export function cleanupRetryHistory(maxAgeMs: number = HISTORY_TTL_MS): void {
  const now = Date.now();
  const cutoff = now - maxAgeMs;
  
  for (const [key, entry] of retryHistory.entries()) {
    // Remove entries that haven't been accessed recently
    if (entry.lastAccessed < cutoff) {
      retryHistory.delete(key);
      continue;
    }
    
    // Also filter timestamps within the entry
    const filtered = entry.timestamps.filter(ts => now - ts < maxAgeMs);
    if (filtered.length === 0) {
      retryHistory.delete(key);
    } else {
      retryHistory.set(key, {
        timestamps: filtered,
        lastAccessed: entry.lastAccessed,
      });
    }
  }
}

const DEFAULT_CIRCUIT_OPTIONS: CircuitBreakerOptions = {
  failureThreshold: 5,
  resetTimeoutMs: 30000,
  halfOpenMaxCalls: 3,
};

// ============================================================================
// Circuit Breaker State
// ============================================================================

export enum CircuitState {
  CLOSED = 'closed',
  OPEN = 'open',
  HALF_OPEN = 'half-open',
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
* Check if error is retryable
* @param error - Error to check
* @param options - Retry options
* @returns Whether the error is retryable
*/
function isRetryableError(error: Error, options: RetryOptions): boolean {
  // Custom check function
  if (options.shouldRetry) {
  return options.shouldRetry(error);
  }

  // Check against known retryable patterns
  const message = error["message"].toLowerCase();
  return options.retryableErrors?.some(pattern =>
  message.includes(pattern.toLowerCase())
  ) ?? false;
}

/**
* Calculate delay with exponential backoff and jitter
* @param attempt - Current attempt number
* @param options - Retry options
* @returns Delay in milliseconds
*/
function calculateDelay(attempt: number, options: RetryOptions): number {
  const exponentialDelay = options.initialDelayMs * Math.pow(options.backoffMultiplier, attempt - 1);
  const cappedDelay = Math.min(exponentialDelay, options.maxDelayMs);

  // Add jitter (�25%) to prevent thundering herd
  const jitter = cappedDelay * 0.25 * (Math.random() * 2 - 1);

  return Math.floor(cappedDelay + jitter);
}

/**
* Sleep for specified milliseconds
* @param ms - Milliseconds to sleep
* @returns Promise that resolves after the delay
*/
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// Retry Functions
// ============================================================================

/**
* Execute function with retry logic
* @param fn - Function to execute
* @param options - Partial retry options
* @returns Promise resolving to function result
* @throws Error if all retries are exhausted
*/
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // P1-FIX: Generate a unique key for this retry operation
  const retryKey = `${fn.name || 'anonymous'}_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  for (let attempt = 1; attempt <= opts.maxRetries + 1; attempt++) {
  try {
    return await fn();
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    const isLastAttempt = attempt > opts.maxRetries;

    if (isLastAttempt || !isRetryableError(err, opts)) {
    throw err;
    }

    const delay = calculateDelay(attempt, opts);

    // P1-FIX: Track retry attempt to prevent unbounded growth
    trackRetryAttempt(retryKey, Date.now());

    logger.warn(`Retry attempt ${attempt}/${opts.maxRetries} after ${delay}ms: ${err["message"]}`, {
    error: err["message"],
    });

    opts.onRetry?.(error as Error, attempt);

    await sleep(delay);
  }
  }

  // Should never reach here
  throw new Error('Retry loop exited unexpectedly');
}

/**
* Create a retryable version of a function
* @param fn - Function to make retryable
* @param options - Partial retry options
* @returns Retryable function
*/
export function makeRetryable<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  options: Partial<RetryOptions> = {}
): T {
  return (async (...args: any[]) => {
  return withRetry(() => fn(...args), options);
  }) as T;
}

/**
* Retry decorator for class methods
* @param options - Retry configuration options
* @returns Method decorator
*/
export function Retryable(options: Partial<RetryOptions> = {}) {
  return function (target: unknown, propertyKey: string, descriptor: PropertyDescriptor) {
  const originalMethod = descriptor.value as (...args: unknown[]) => Promise<unknown>;

  descriptor.value = async function (...args: unknown[]) {
    return withRetry(() => originalMethod.apply(this, args), options);
  };

  return descriptor;
  };
}

// ============================================================================
// Circuit Breaker
// ============================================================================

class AsyncLock {
  private promise: Promise<void> = Promise.resolve();

  async acquire(): Promise<() => void> {
  let release: () => void;
  const newPromise = new Promise<void>((resolve) => {
    release = resolve;
  });
  const wait = this.promise;
  this.promise = this.promise.then(() => newPromise);
  await wait;
  return () => release!();
  }
}

/**
* Circuit breaker for external calls
* Prevents cascading failures by stopping requests to failing services
*/
export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failures = 0;
  private lastFailureTime?: number;
  private halfOpenCalls = 0;

  private readonly stateLock = new AsyncLock();

  /**
  * Create a new CircuitBreaker
  * @param name - Name for this circuit breaker
  * @param options - Circuit breaker options
  */
  constructor(
  private readonly name: string,
  private readonly options: Partial<CircuitBreakerOptions> = {}
  ) {}

  private get opts(): CircuitBreakerOptions {
  return { ...DEFAULT_CIRCUIT_OPTIONS, ...this.options };
  }

  /**
  * Execute a function with circuit breaker protection
  * @param fn - Function to execute
  * @returns Promise resolving to function result
  * @throws Error if circuit is open
  */
  async execute<T>(fn: () => Promise<T>): Promise<T> {

  const release = await this.stateLock.acquire();

  try {
    if (this.state === CircuitState.OPEN) {
    const timeSinceLastFailure = Date.now() - (this.lastFailureTime || 0);

    if (timeSinceLastFailure < this.opts.resetTimeoutMs) {
    throw new Error(`Circuit breaker open for ${this.name}`);
    }

    // Transition to half-open
    this.state = CircuitState.HALF_OPEN;
    this.halfOpenCalls = 0;
    logger.info(`Circuit breaker half-open for ${this.name}`);
    }

    if (this.state === CircuitState.HALF_OPEN) {
    if (this.halfOpenCalls >= this.opts.halfOpenMaxCalls) {
    throw new Error(`Circuit breaker half-open limit reached for ${this.name}`);
    }
    this.halfOpenCalls++;
    }
  } finally {
    release();
  }

  try {
    const result = await fn();
    await this.onSuccess();
    return result;
  } catch (error) {
    // P1-FIX: Pass error to onFailure for classification
    await this.onFailure(error);
    throw error;
  }
  }

  private async onSuccess(): Promise<void> {
  const release = await this.stateLock.acquire();
  try {
    if (this.state === CircuitState.HALF_OPEN) {
    this.state = CircuitState.CLOSED;
    this.failures = 0;
    this.halfOpenCalls = 0;
    logger.info(`Circuit breaker closed for ${this.name}`);
    } else {
    this.failures = 0;
    }
  } finally {
    release();
  }
  }

  /**
   * P1-FIX: Check if error should count toward circuit breaker
   * 4xx client errors should not count as service failures
   */
  private shouldCountFailure(error: unknown): boolean {
    // Don't count 4xx errors - these are client errors, not service failures
    if (error && typeof error === 'object') {
      const err = error as { statusCode?: number; code?: string; message?: string };
      
      // Check for HTTP 4xx status codes
      if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
        return false;
      }
      
      // Check for common 4xx error codes
      if (err.code) {
        const clientErrorCodes = [
          'BAD_REQUEST', 'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND',
          'METHOD_NOT_ALLOWED', 'CONFLICT', 'GONE', 'VALIDATION_ERROR',
          'EINVAL', 'ENOENT' // Common filesystem/client errors
        ];
        if (clientErrorCodes.some(code => err.code?.includes(code))) {
          return false;
        }
      }
      
      // Check error message patterns for 4xx indicators
      if (err.message) {
        const clientErrorPatterns = [
          'bad request', 'unauthorized', 'forbidden', 'not found',
          'validation failed', 'invalid input', 'client error'
        ];
        const lowerMessage = err.message.toLowerCase();
        if (clientErrorPatterns.some(pattern => lowerMessage.includes(pattern))) {
          return false;
        }
      }
    }
    
    return true;
  }

  private async onFailure(error?: unknown): Promise<void> {
  const release = await this.stateLock.acquire();
  try {
    // P1-FIX: Only count failures that are actual service issues
    if (error && !this.shouldCountFailure(error)) {
      logger.debug(`Circuit breaker ignoring client error for ${this.name}`);
      return;
    }
    
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.failures >= this.opts.failureThreshold) {
    this.state = CircuitState.OPEN;
    logger["error"](`Circuit breaker opened for ${this.name} (${this.failures} failures)`);
    }
  } finally {
    release();
  }
  }

  /**
  * Get current circuit state
  * @returns Current circuit state
  */
  getState(): CircuitState {
  return this.state;
  }
}
