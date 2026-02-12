// P1-FIX: Bounded cache with LRU eviction to prevent unbounded memory growth
export interface CacheEntry<V> {
  value: V;
  timestamp: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function memoize<T extends (...args: any[]) => any>(fn: T, maxSize = 1000): T {
  const cache = new Map<string, CacheEntry<ReturnType<T>>>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((...args: any[]) => {
  const key = JSON.stringify(args);
  const now = Date.now();

  const entry = cache.get(key);
  if (entry) {
    // P1-FIX: Update timestamp on access for LRU tracking
    entry.timestamp = now;
    return entry.value;
  }

  const res = fn(...args);

  // P1-FIX: Evict oldest entry if at capacity (LRU eviction)
  if (cache.size >= maxSize) {
    let oldestKey: string | undefined;
    let oldestTime = Infinity;

    for (const [k, v] of cache.entries()) {
    if (v.timestamp < oldestTime) {
      oldestTime = v.timestamp;
      oldestKey = k;
    }
    }

    if (oldestKey !== undefined) {
    cache.delete(oldestKey);
    }
  }

  cache.set(key, { value: res, timestamp: now });
  return res;
  }) as T;
}
