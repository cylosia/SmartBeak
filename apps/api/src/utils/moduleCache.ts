import { LRUCache } from 'lru-cache';
import { getLogger } from '@kernel/logger';
import { CircuitBreaker } from '@kernel/retry';

const logger = getLogger('ModuleCache');

/**
* Simple async module cache utility
* Prevents repeated dynamic imports by caching the module promise
*
* FIX: Fixed race condition by using Promise-based memoization pattern
* Multiple concurrent calls now correctly share the same promise
*/
export class ModuleCache<T> {
  private promise: Promise<T> | null = null;
  private isLoading = false;
  private loader: () => Promise<T>;

  constructor(loader: () => Promise<T>) {
  this.loader = loader;
  }

  async get(): Promise<T> {
  // P1-FIX: Atomic check-and-set pattern prevents race condition
  // If promise already exists, return it immediately (shared by all concurrent calls)
  if (this.promise) {
    return this.promise;
  }

  // P2-10 FIX: Replaced busy-wait polling loop with shared Promise pattern.
  // The old while(isLoading) { await setTimeout(10) } loop burned CPU and
  // could stack overflow via recursive this.get() calls.
  if (this.isLoading && this.promise) {
    return this.promise;
  }

  // P1-FIX: Atomic initialization - set flag BEFORE creating promise
  this.isLoading = true;

  try {
    // Create the promise - this is now protected by the isLoading flag
    this.promise = this.loader().catch((err) => {
    // P1-FIX: Log the error instead of silently suppressing
    logger.error('Loader failed', err instanceof Error ? err : new Error(String(err)));
    // Clear cache on error to allow retry
    this.promise = null;
    this.isLoading = false;
    throw err;
    });

    return this.promise;
  } catch (err) {
    // P1-FIX: Ensure flag is cleared on synchronous errors
    this.isLoading = false;
    throw err;
  }
  }

  clear(): void {
  this.promise = null;
  this.isLoading = false;
  }
}

/**
* FIX: Thread-safe module cache with locking mechanism
* Prevents race conditions in multi-threaded environments
* 
* P1-FIX: Added circuit breaker to prevent cascading failures when loader fails
*/
export class ThreadSafeModuleCache<T> {
  private cache = new LRUCache<string, Promise<T>>({ max: 1000, ttl: 600000 });
  private locks = new LRUCache<string, boolean>({ max: 1000, ttl: 60000 });
  private circuitBreaker: CircuitBreaker;

  constructor(private loader: (key: string) => Promise<T>) {
    // P1-FIX: Initialize circuit breaker to protect against cascading failures
    this.circuitBreaker = new CircuitBreaker('ThreadSafeModuleCache', {
      failureThreshold: 5,
      resetTimeoutMs: 30000,
      halfOpenMaxCalls: 3,
    });
  }

  async get(key: string): Promise<T> {
  // Check if already cached
  const cached = this.cache.get(key);
  if (cached) {
    return cached;
  }

  if (this.locks.get(key)) {
    // Wait for the existing promise with exponential backoff
    for (let attempts = 0; attempts < 10; attempts++) {
    const existing = this.cache.get(key);
    if (existing) return existing;
    // Exponential backoff: 10ms, 20ms, 40ms...
    await new Promise(resolve => setTimeout(resolve, 10 * Math.pow(2, attempts)));
    }
    // If still not available after retries, proceed with new load
  }

  // Acquire lock
  this.locks.set(key, true);

  // P0-FIX: Use try-finally to ensure lock is always released
  // P1-FIX: Wrap loader with circuit breaker for failure protection
  try {
    const promise = this.circuitBreaker.execute(() => this.loader(key)).catch((err) => {
      // Clear on error
      this.cache.delete(key);
      // P1-FIX: Log circuit breaker failures
      logger.error(`Module cache load failed for key: ${key}`, err instanceof Error ? err : new Error(String(err)));
      throw err;
    });

    this.cache.set(key, promise);
    return promise;
  } catch (error) {
    throw error;
  } finally {
    // P0-FIX: Always release lock, even if loader throws
    this.locks.delete(key);
  }
  }

  clear(key?: string): void {
  if (key) {
    this.cache.delete(key);
    this.locks.delete(key);
  } else {
    this.cache.clear();
    this.locks.clear();
  }
  }
}

/**
* Helper function to create a cached module loader
* Usage:
*   const dbModule = createModuleCache(() => import('../../../web/lib/db'));
*   const { pool } = await dbModule.get();
*/
export function createModuleCache<T>(loader: () => Promise<T>): ModuleCache<T> {
  return new ModuleCache<T>(loader);
}
