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

    // FIX(P2): Use snapshot comparison to null out the promise safely.
    // Previously `this.promise = null` was inside the `.catch()` chain return,
    // meaning callers retrying immediately after rejection received the already-
    // settled rejected promise if the microtask queue hadn't drained yet.
    // Now we capture `p` and only clear `this.promise` when it still points to
    // this specific load attempt (not a newer one).
    const p: Promise<T> = this.loader().then(
      (result) => result,
      (err: unknown) => {
        logger.error('Loader failed', err instanceof Error ? err : new Error(String(err)));
        // Only clear if no newer load has started since this one failed
        if (this.promise === p) this.promise = null;
        throw err;
      }
    );
    this.promise = p;
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
  // P1-FIX: Store completed results (not promises) in the LRU cache so TTL
  // eviction only removes settled values — never an in-flight promise.
  // Previously the LRU held Promise<T>: if the TTL (600 s) elapsed while a
  // load was still running, the entry was silently evicted and the next
  // concurrent caller launched a duplicate load, breaking deduplication and
  // creating redundant work / race conditions.
  private cache = new LRUCache<string, T>({ max: 1000, ttl: 600000 });
  // In-flight promises are tracked in a plain Map with no TTL so they survive
  // for the full lifetime of the computation.
  private inFlight = new Map<string, Promise<T>>();
  private circuitBreaker: CircuitBreaker;

  constructor(private loader: (key: string) => Promise<T>) {
    this.circuitBreaker = new CircuitBreaker('ThreadSafeModuleCache', {
      failureThreshold: 5,
      resetTimeoutMs: 30000,
      halfOpenMaxCalls: 3,
    });
  }

  async get(key: string): Promise<T> {
    // 1. Settled result in LRU cache — fastest path.
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    // 2. In-flight deduplication — join an already-running load.
    const flying = this.inFlight.get(key);
    if (flying) {
      return flying;
    }

    // 3. No existing load — start one and register it in the inFlight Map
    //    *synchronously* so any concurrent call arriving before the first
    //    await will see it.
    const promise: Promise<T> = this.circuitBreaker.execute(() => this.loader(key)).then(
      (result) => {
        // Promote the settled value into the LRU cache and retire the in-flight entry.
        this.cache.set(key, result);
        this.inFlight.delete(key);
        return result;
      },
      (err: unknown) => {
        // Remove the in-flight entry so the next caller can retry.
        this.inFlight.delete(key);
        logger.error(`Module cache load failed for key: ${key}`, err instanceof Error ? err : new Error(String(err)));
        throw err;
      }
    );

    this.inFlight.set(key, promise);
    return promise;
  }

  clear(key?: string): void {
    if (key) {
      this.cache.delete(key);
      this.inFlight.delete(key);
    } else {
      this.cache.clear();
      this.inFlight.clear();
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
