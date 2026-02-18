/**
* LRU (Least Recently Used) Cache with size limits
* Prevents unbounded memory growth
*/

export interface LRUCacheOptions {
  maxSize: number;
  ttlMs: number | undefined; // Optional TTL for entries
}

export interface CacheEntry<V> {
  value: V;
  createdAt: number;
}

export class LRUCache<K, V> {
  private cache: Map<K, CacheEntry<V>>;
  private readonly maxSize: number;
  private readonly ttlMs: number | undefined;

  constructor(options: LRUCacheOptions) {
  if (options.maxSize <= 0) {
    throw new Error(`LRUCache maxSize must be > 0, got ${options.maxSize}`);
  }
  this.cache = new Map();
  this.maxSize = options.maxSize;
  this.ttlMs = options.ttlMs;
  }

  /**
  * Get value from cache
  * @param key - Cache key
  * @returns Value or undefined if not found/expired
  */
  get(key: K): V | undefined {
  const entry = this.cache.get(key);

  if (!entry) {
    return undefined;
  }

  // Absolute TTL check — uses createdAt, not a sliding window
  const now = Date.now();
  if (this.ttlMs !== undefined && now - entry.createdAt > this.ttlMs) {
    this.cache.delete(key);
    return undefined;
  }

  // Move to end (most recently used) — preserve original createdAt for absolute TTL
  this.cache.delete(key);
  this.cache.set(key, entry);

  return entry.value;
  }

  /**
  * Set value in cache
  * @param key - Cache key
  * @param value - Value to cache
  */
  set(key: K, value: V): void {
  // Remove if exists (to update position)
  if (this.cache.has(key)) {
    this.cache.delete(key);
  }

  // Evict oldest if at capacity
  if (this.cache.size >= this.maxSize) {
    const firstKey = this.cache.keys().next().value;
    if (firstKey !== undefined) {
    this.cache.delete(firstKey);
    }
  }

  this.cache.set(key, {
    value,
    createdAt: Date.now(),
  });
  }

  /**
  * Check if key exists in cache
  * @param key - Cache key
  * @returns True if exists and not expired
  */
  has(key: K): boolean {
  const entry = this.cache.get(key);
  if (!entry) return false;
  if (this.ttlMs !== undefined && Date.now() - entry.createdAt > this.ttlMs) {
    this.cache.delete(key);
    return false;
  }
  return true;
  }

  /**
  * Delete entry from cache
  * @param key - Cache key
  * @returns True if entry was deleted
  */
  delete(key: K): boolean {
  return this.cache.delete(key);
  }

  /**
  * Clear all entries
  */
  clear(): void {
  this.cache.clear();
  }

  /**
  * Get current cache size (excludes expired entries via cleanup)
  */
  get size(): number {
  if (this.ttlMs !== undefined) {
    this.cleanup();
  }
  return this.cache.size;
  }

  /**
  * Get all keys (for testing/debugging)
  */
  keys(): IterableIterator<K> {
  return this.cache.keys();
  }

  /**
  * Returns an iterable of key-value pairs
  */
  *entries(): Generator<[K, V]> {
  for (const [key, entry] of this.cache.entries()) {
    yield [key, entry.value];
  }
  }

  /**
  * Returns an iterable of values
  */
  *values(): Generator<V> {
  for (const entry of this.cache.values()) {
    yield entry.value;
  }
  }

  /**
  * Clean up expired entries
  * @returns Number of entries removed
  */
  cleanup(): number {
  if (this.ttlMs === undefined) return 0;

  const now = Date.now();
  const keysToDelete: K[] = [];

  for (const [key, entry] of this.cache.entries()) {
    if (now - entry.createdAt > this.ttlMs) {
    keysToDelete.push(key);
    }
  }

  for (const key of keysToDelete) {
    this.cache.delete(key);
  }

  return keysToDelete.length;
  }
}

/**
* Create a bounded Map with size limit
* Throws when size limit is exceeded
*/
export class BoundedMap<K, V> extends Map<K, V> {
  private readonly maxSize: number;

  constructor(maxSize: number, entries?: readonly (readonly [K, V])[] | null) {
  super();
  this.maxSize = maxSize;
  // Validate entries through overridden set() to enforce size limit
  if (entries) {
    for (const [k, v] of entries) {
    this.set(k, v);
    }
  }
  }

  override set(key: K, value: V): this {
  if (!this.has(key) && this.size >= this.maxSize) {
    throw new Error(`Map size limit (${this.maxSize}) exceeded`);
  }
  return super.set(key, value);
  }
}

/**
* Create a bounded Array with size limit
* Automatically evicts oldest items when limit is exceeded
*/
export class BoundedArray<T> {
  private readonly items: T[];
  private readonly maxSize: number;

  constructor(maxSize: number, ...initialItems: T[]) {
  this.maxSize = maxSize;
  this.items = initialItems.slice(0, maxSize);
  }

  push(...newItems: T[]): number {
  for (const item of newItems) {
    if (this.items.length >= this.maxSize) {
    this.items.shift();
    }
    this.items.push(item);
  }
  return this.items.length;
  }

  unshift(...newItems: T[]): number {
  const available = this.maxSize - this.items.length;
  const toAdd = newItems.slice(0, available);
  this.items.unshift(...toAdd);
  return this.items.length;
  }

  get length(): number {
  return this.items.length;
  }

  get(index: number): T | undefined {
  return this.items[index];
  }

  toArray(): T[] {
  return [...this.items];
  }

  [Symbol.iterator](): Iterator<T> {
  return this.items[Symbol.iterator]();
  }
}
