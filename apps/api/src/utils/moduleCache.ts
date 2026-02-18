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

  // P2-19 FIX: Removed dead code branch — the previous `if (this.isLoading && this.promise)`
  // check was unreachable because `this.promise` being truthy is already handled above.
  // P1-10 FIX: The `isLoading` flag is also removed; the promise itself is the
  // synchronization primitive. No busy-wait loops are needed.

  // Create the promise — this is the single synchronization point
  this.promise = this.loader().catch((err) => {
    // P1-FIX: Log the error instead of silently suppressing
    logger.error('Loader failed', err instanceof Error ? err : new Error(String(err)));
    // Clear cache on error to allow retry
    this.promise = null;
    throw err;
  });

  return this.promise;
  }

  clear(): void {
  this.promise = null;
  }
}

/**
* Thread-safe module cache using promise-based memoization.
*
* P1-12 FIX: Removed the ineffective boolean `locks` LRUCache. A simple boolean
* flag in single-threaded JS provides no mutual exclusion — between the check
* and the set, other microtasks can interleave. Instead, the cached Promise
* itself acts as the deduplication mechanism: the first caller creates and
* stores the promise, and subsequent callers receive the same promise.
*
* P1-10 FIX: Removed the busy-wait polling loop (`for` with `setTimeout`
* backoff). Callers now always get the in-flight promise directly, with no
* polling delay.
*
* P1-FIX: Added circuit breaker to prevent cascading failures when loader fails.
*/
export class ThreadSafeModuleCache<T> {
  private cache = new LRUCache<string, Promise<T>>({ max: 1000, ttl: 600000 });
  private circuitBreaker: CircuitBreaker;

  constructor(private loader: (key: string) => Promise<T>) {
    this.circuitBreaker = new CircuitBreaker('ThreadSafeModuleCache', {
      failureThreshold: 5,
      resetTimeoutMs: 30000,
      halfOpenMaxCalls: 3,
    });
  }

  async get(key: string): Promise<T> {
  // Return the cached promise if it exists (whether resolved or still pending)
  const cached = this.cache.get(key);
  if (cached) {
    return cached;
  }

  // P1-12 FIX: No lock needed — store the promise synchronously so that any
  // subsequent call within the same microtask tick will see it in the cache.
  const promise = this.circuitBreaker.execute(() => this.loader(key)).catch((err) => {
    // Clear on error so the next call retries
    this.cache.delete(key);
    logger.error(`Module cache load failed for key: ${key}`, err instanceof Error ? err : new Error(String(err)));
    throw err;
  });

  this.cache.set(key, promise);
  return promise;
  }

  clear(key?: string): void {
  if (key) {
    this.cache.delete(key);
  } else {
    this.cache.clear();
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
