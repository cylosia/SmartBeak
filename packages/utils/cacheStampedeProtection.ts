import { getLogger } from '@kernel/logger';

/**
* Cache Stampede Protection
* P1-FIX: Prevents cache stampede using in-flight request deduplication
*
* Cache stampede occurs when a cached value expires and multiple concurrent
* requests try to regenerate it simultaneously. This module prevents that
* by deduplicating concurrent requests for the same key.
*/

const logger = getLogger('cache-stampede');

// P1-FIX: In-flight request tracking
export interface InFlightRequest<T> {
  promise: Promise<T>;
  startTime: number;
  requestCount: number;
}

class CacheStampedeProtector {
  private inFlight = new Map<string, InFlightRequest<unknown>>();
  private readonly maxInFlightAge: number;

  constructor(maxInFlightAgeMs: number = 30000) {
  this.maxInFlightAge = maxInFlightAgeMs;
  }

  /**
  * Get or compute a value with stampede protection
  * P1-FIX: Deduplicates concurrent requests for the same key
  *
  * @param key - Cache key
  * @param factory - Factory function to compute the value
  * @param options - Options for stampede protection
  * @returns The cached or computed value
  */
  async getOrCompute<T>(
  key: string,
  factory: () => Promise<T>,
  options: {
    cacheGetter?: () => Promise<T | undefined> | T | undefined;
    cacheSetter?: (value: T) => Promise<void> | void;
    timeoutMs?: number;
    onDedupe?: () => void;
  } = {}
  ): Promise<T> {
  const { cacheGetter, cacheSetter, timeoutMs = 30000, onDedupe } = options;

  // P1-FIX: Check cache first
  if (cacheGetter) {
    const cached = await cacheGetter();
    if (cached !== undefined) {
    return cached;
    }
  }

  // P1-FIX: Check for in-flight request
  const existing = this.inFlight.get(key) as InFlightRequest<T> | undefined;
  if (existing) {
    // Check if in-flight request is not too old
    const age = Date.now() - existing.startTime;
    if (age < this.maxInFlightAge) {
    existing.requestCount++;
    logger.debug(`Deduplicating request for key: ${key} (concurrent: ${existing.requestCount})`);
    onDedupe?.();
    return existing.promise;
    } else {
    // Clean up stale request
    logger.warn(`Cleaning up stale in-flight request for key: ${key} (age: ${age}ms)`);
    this.inFlight.delete(key);
    }
  }

  // P1-FIX: Create new computation with timeout
  const computation = this.createComputation(key, factory, cacheSetter, timeoutMs);

  this.inFlight.set(key, {
    promise: computation,
    startTime: Date.now(),
    requestCount: 1,
  });

  return computation;
  }

  private async createComputation<T>(
  key: string,
  factory: () => Promise<T>,
  cacheSetter: ((value: T) => Promise<void> | void) | undefined,
  timeoutMs: number
  ): Promise<T> {
  try {
    // P1-FIX: Wrap factory with timeout
    const result = await Promise.race([
    factory(),
    new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Cache computation timeout for key: ${key}`)), timeoutMs)
    ),
    ]);

    // P1-FIX: Cache the result
    if (cacheSetter) {
    try {
    await cacheSetter(result);
    } catch (error) {
    logger["error"](`Failed to cache result for key: ${key}`, error as Error);
    }
    }

    return result;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger["error"](`Factory failed for key: ${key}`, err);
    throw error;
  } finally {
    // P1-FIX: Clean up in-flight tracking
    this.inFlight.delete(key);
  }
  }

  /**
  * Get statistics about in-flight requests
  */
  getStats(): {
  inFlightCount: number;
  keys: string[];
  } {
  return {
    inFlightCount: this.inFlight.size,
    keys: [...this.inFlight.keys()],
  };
  }

  /**
  * Clear all in-flight requests (useful for testing)
  */
  clear(): void {
  this.inFlight.clear();
  }
}

// P1-FIX: Global stampede protector instance
const globalStampedeProtector = new CacheStampedeProtector();

/**
* Get or compute a value with global stampede protection
*/
export async function getOrComputeWithStampedeProtection<T>(
  key: string,
  factory: () => Promise<T>,
  options?: Parameters<CacheStampedeProtector['getOrCompute']>[2]
): Promise<T> {
  return globalStampedeProtector.getOrCompute(key, factory, options) as Promise<T>;
}

/**
* Create a new stampede protector (for isolated caches)
*/
export function createStampedeProtector(maxInFlightAgeMs?: number): CacheStampedeProtector {
  return new CacheStampedeProtector(maxInFlightAgeMs);
}

export { CacheStampedeProtector, globalStampedeProtector };
