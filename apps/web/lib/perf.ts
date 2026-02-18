// P1-FIX: Bounded cache with LRU eviction to prevent unbounded memory growth
export interface CacheEntry<V> {
  value: V;
  timestamp: number;
}

/**
 * P1-FIX: Produce a stable, collision-free cache key.
 * - JSON.stringify([undefined]) === JSON.stringify([null]) === '[null]',
 *   causing null/undefined arg collisions that return wrong cached values.
 * - JSON.stringify throws on circular references, crashing the memoized fn.
 * Fix: replace undefined/symbol/function with unambiguous sentinel strings,
 * and fall back to a unique random key on circular-reference errors so the
 * call always proceeds (cache miss) rather than throwing.
 */
function buildCacheKey(args: unknown[]): string {
  try {
    return JSON.stringify(args, (_k, v) => {
      if (v === undefined) return '__undefined__';
      if (typeof v === 'symbol') return `__symbol_${v.toString()}__`;
      if (typeof v === 'function') return `__fn_${(v as { name?: string }).name ?? 'anonymous'}__`;
      return v;
    });
  } catch {
    // Circular reference or other non-serializable input — return a unique
    // key so the call proceeds without caching (correct behaviour, not a throw).
    return `__non_serializable_${Math.random()}__`;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function memoize<T extends (...args: any[]) => any>(fn: T, maxSize = 1000): T {
  const cache = new Map<string, CacheEntry<ReturnType<T>>>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((...args: any[]) => {
  const key = buildCacheKey(args);
  const now = Date.now();

  const entry = cache.get(key);
  if (entry) {
    // P1-FIX: Update timestamp on access for LRU tracking
    entry.timestamp = now;
    return entry.value;
  }

  const res = fn(...args);

  // P2-FIX: If the return value is a Promise, register a rejection handler so
  // that when it rejects the stale entry is evicted immediately.  Without this,
  // memoize would permanently cache a rejected Promise, causing every subsequent
  // call with the same args to receive an already-rejected Promise — effectively
  // making the function permanently broken for those arguments after one failure.
  if (res instanceof Promise) {
    res.then(undefined, () => { cache.delete(key); });
  }

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
