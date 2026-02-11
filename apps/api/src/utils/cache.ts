import { z } from 'zod';
import { cacheConfig } from '@config';


/**
* Cache Utilities
* Provides type-safe caching utilities with versioning and key generation
*/

// ============================================================================
// Zod Schemas
// ============================================================================

export const CacheKeyPartSchema = z.string().min(1).max(512);

export const CacheKeyPartsSchema = z.array(CacheKeyPartSchema).min(1).max(20);

export const CacheOptionsSchema = z.object({
  version: z.string().min(1).max(20).optional(),
  prefix: z.string().min(1).max(50).optional(),
  separator: z.string().min(1).max(5).default(':'),
  maxLength: z.number().int().min(10).max(2048).default(cacheConfig.maxKeyLength),
});

export const CacheEntrySchema = z.object({
  key: z.string(),
  value: z.unknown(),
  createdAt: z.date(),
  expiresAt: z.date().optional(),
  tags: z.array(z.string()).optional(),
});

export const CacheStatsSchema = z.object({
  hits: z.number().int().min(0),
  misses: z.number().int().min(0),
  size: z.number().int().min(0),
  hitRate: z.number().min(0).max(1),
});

// ============================================================================
// Type Definitions
// ============================================================================

export type CacheKeyPart = z.infer<typeof CacheKeyPartSchema>;
export type CacheKeyParts = z.infer<typeof CacheKeyPartsSchema>;
export type CacheOptions = z.infer<typeof CacheOptionsSchema>;
export type CacheEntry = z.infer<typeof CacheEntrySchema>;
export type CacheStats = z.infer<typeof CacheStatsSchema>;

/**
* Generic cache entry with typed value
*/
export interface TypedCacheEntry<T> {
  key: string;
  value: T;
  createdAt: Date;
  expiresAt?: Date;
  tags?: string[];
}

/**
* Cache provider interface
*/
export interface CacheProvider {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlMs?: number): Promise<void>;
  delete(key: string): Promise<boolean>;
  exists(key: string): Promise<boolean>;
  clear(): Promise<void>;
}

// ============================================================================
// Error Types
// ============================================================================

export class CacheError extends Error {
  constructor(
  message: string,
  public readonly code: string,
  public readonly key?: string
  ) {
  super(message);
  this.name = 'CacheError';
  }
}

export class InvalidCacheKeyError extends CacheError {
  constructor(message: string) {
  super(message, 'INVALID_CACHE_KEY');
  this.name = 'InvalidCacheKeyError';
  }
}

export class CacheKeyTooLongError extends CacheError {
  constructor(key: string, maxLength: number) {
  super(`Cache key exceeds maximum length of ${maxLength}`, 'KEY_TOO_LONG', key);
  this.name = 'CacheKeyTooLongError';
  }
}

// ============================================================================
// Constants
// ============================================================================

/**
* Global cache version - bump this to invalidate all cached data
*/
export const CACHE_VERSION = cacheConfig.version;

/**
* Default cache key prefix
*/
export const DEFAULT_CACHE_PREFIX = cacheConfig.prefix;

/**
* Default separator for cache key parts
*/
export const DEFAULT_SEPARATOR = ':';

// ============================================================================
// Serialization Helpers
// ============================================================================

/**
* Escape special regex characters in a string
* Prevents ReDoS and syntax errors when user input is used in regex
*
* @param string - String to escape
* @returns Escaped string safe for use in RegExp
*/
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
* Recursively sort object keys for consistent serialization
* Includes circular reference detection to prevent infinite loops
*
* @param obj - Value to sort keys for
* @param seen - WeakSet of already-seen objects (for circular reference detection)
* @returns Value with sorted keys
*/
/**
* Type guard to check if value is a plain object
* P2-MEDIUM FIX: Type guard instead of as assertion
*/
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sortKeysDeep(obj: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    // Check for circular reference
    if (seen.has(obj)) {
      return '[Circular]';
    }
    seen.add(obj);
    const result = obj.map(item => sortKeysDeep(item, seen));
    seen.delete(obj);
    return result;
  }

  // P2-MEDIUM FIX: Use type guard instead of as assertion
  if (!isPlainObject(obj)) {
    return obj;
  }

  // Check for circular reference
  if (seen.has(obj)) {
    return '[Circular]';
  }
  seen.add(obj);

  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = sortKeysDeep(obj[key], seen);
  }

  seen.delete(obj);
  return sorted;
}

/**
* Serialize a cache value to string with proper handling of objects, null, and undefined
*
* @param value - Value to serialize
* @returns Serialized string representation
*/
function serializeCacheValue(value: unknown): string {
  if (value === null) return '__null__';
  if (value === undefined) return '__undefined__';
  if (typeof value === 'object') {
  // Sort keys for consistency
  return JSON.stringify(sortKeysDeep(value));
  }
  return String(value);
}

/**
* Escape separator characters in key parts to prevent parsing issues
*
* @param part - Key part to escape
* @returns Escaped key part
*/
function escapeKeyPart(part: string): string {
  return part.replace(/:/g, '\\:');
}

/**
* Unescape separator characters in key parts
*
* @param part - Key part to unescape
* @returns Unescaped key part
*/
function unescapeKeyPart(part: string): string {
  return part.replace(/\\:/g, ':');
}

// ============================================================================
// Key Generation Functions
// ============================================================================

/**
* Generate a cache key from parts with versioning
*
* @param parts - Array of key parts (e.g., ['user', '123', 'profile'])
* @returns Formatted cache key with version prefix
* @throws {InvalidCacheKeyError} When parts array is empty or invalid
*
* @example
* ```typescript
* const key = cacheKey(['user', '123', 'profile']);
* // Returns: 'v2:user:123:profile'
* ```
*/
export function cacheKey(parts: string[]): string {
  // Validate input
  const validatedParts = CacheKeyPartsSchema.safeParse(parts);
  if (!validatedParts.success) {
  throw new InvalidCacheKeyError(
    `Invalid cache key parts: ${validatedParts.error.issues.map((e: { message: string }) => e["message"]).join(', ')}`
  );
  }

  // Escape separator characters in each part to prevent collision issues
  const escapedParts = validatedParts.data.map(escapeKeyPart);

  return [CACHE_VERSION, ...escapedParts].join(DEFAULT_SEPARATOR);
}

/**
* Generate a cache key with custom options
*
* @param parts - Array of key parts
* @param options - Options for key generation
* @returns Formatted cache key
* @throws {InvalidCacheKeyError} When parts array is empty or invalid
* @throws {CacheKeyTooLongError} When generated key exceeds max length
*
* @example
* ```typescript
* const key = cacheKeyWithOptions(
*   ['user', '123'],
*   { version: 'v3', prefix: 'api', separator: '|' }
* );
* // Returns: 'api|v3|user|123'
* ```
*/
export function cacheKeyWithOptions(parts: string[], options: Partial<CacheOptions> = {}): string {
  // Validate inputs
  const validatedParts = CacheKeyPartsSchema.safeParse(parts);
  if (!validatedParts.success) {
  throw new InvalidCacheKeyError(
    `Invalid cache key parts: ${validatedParts.error.issues.map((e: { message: string }) => e["message"]).join(', ')}`
  );
  }

  const validatedOptions = CacheOptionsSchema.parse(options);
  const version = validatedOptions.version ?? CACHE_VERSION;
  const prefix = validatedOptions.prefix ?? DEFAULT_CACHE_PREFIX;
  const separator = validatedOptions.separator ?? DEFAULT_SEPARATOR;

  // Escape separator characters in each part using safe regex construction
  const escapedSeparator = escapeRegExp(separator);
  const escapedParts = validatedParts.data.map((part) =>
  part.replace(new RegExp(escapedSeparator, 'g'), `\\${separator}`)
  );

  // Build key parts
  const keyParts: string[] = [prefix, version, ...escapedParts];
  const key = keyParts.join(separator);

  // Check length
  if (key.length > validatedOptions.maxLength) {
  throw new CacheKeyTooLongError(key, validatedOptions.maxLength);
  }

  return key;
}

/**
* Generate a typed cache key for a specific entity type
*
* @param entityType - Type of entity (e.g., 'user', 'post', 'order')
* @param entityId - Unique identifier for the entity
* @param subKey - Optional sub-key for specific data (e.g., 'profile', 'settings')
* @returns Formatted cache key
*
* @example
* ```typescript
* const key = entityCacheKey('user', '123', 'profile');
* // Returns: 'v2:user:123:profile'
* ```
*/
export function entityCacheKey(entityType: string, entityId: string, subKey?: string): string {
  const parts = [entityType, entityId];
  if (subKey) {
  parts.push(subKey);
  }
  return cacheKey(parts);
}

/**
* Generate a query cache key
*
* @param queryName - Name of the query
* @param params - Query parameters
* @returns Formatted cache key
*
* @example
* ```typescript
* const key = queryCacheKey('getUsers', { role: 'admin', status: 'active' });
* // Returns: 'v2:query:getUsers:role=admin:status=active'
* ```
*/
export function queryCacheKey(queryName: string, params: Record<string, unknown> = {}): string {
  const paramParts = Object.entries(params)
  .sort(([a], [b]) => a.localeCompare(b)) // Sort for consistency
  .map(([key, value]) => {
    // Serialize value with proper object/null/undefined handling
    const serializedValue = serializeCacheValue(value);
    return `${key}=${serializedValue}`;
  });

  return cacheKey(['query', queryName, ...paramParts]);
}

/**
* Generate a method call cache key
*
* @param serviceName - Name of the service
* @param methodName - Name of the method
* @param args - Method arguments
* @returns Formatted cache key
*/
export function methodCacheKey(
  serviceName: string,
  methodName: string,
  args: unknown[] = []
): string {
  // Distinguish null from undefined to avoid collisions
  const argParts = args.map((arg) => serializeCacheValue(arg));
  return cacheKey(['svc', serviceName, methodName, ...argParts]);
}

// ============================================================================
// Key Parsing and Validation
// ============================================================================

/**
* Parse a cache key into its component parts
* Handles escaped separators correctly
*
* @param key - Cache key to parse
* @returns Array of key parts
*/
export function parseCacheKey(key: string): string[] {
  // Split on separator but respect escaped separators
  const parts: string[] = [];
  let currentPart = '';
  let i = 0;

  while (i < key.length) {
  if (key[i] === '\\' && i + 1 < key.length && key[i + 1] === ':') {
    // Escaped separator - add literal colon
    currentPart += ':';
    i += 2;
  } else if (key[i] === ':') {
    // Unescaped separator - end current part
    parts.push(currentPart);
    currentPart = '';
    i++;
  } else {
    currentPart += key[i];
    i++;
  }
  }

  // Don't forget the last part
  parts.push(currentPart);

  // Unescape each part
  return parts.map(unescapeKeyPart);
}

/**
* Check if a string is a valid cache key format
*
* @param key - Key to validate
* @returns Whether the key appears valid
*/
export function isValidCacheKey(key: string): boolean {
  if (typeof key !== 'string') return false;
  if (key.length === 0 || key.length > 1024) return false;

  const parts = parseCacheKey(key);
  return parts.length >= 2 && parts[0] === CACHE_VERSION;
}

/**
* Extract the version from a cache key
*
* @param key - Cache key
* @returns Version string or undefined if invalid
*/
export function getCacheKeyVersion(key: string): string | undefined {
  const parts = parseCacheKey(key);
  return parts.length > 0 ? parts[0] : undefined;
}

/**
* Check if a cache key matches the current version
*
* @param key - Cache key to check
* @returns Whether the key is current
*/
export function isCurrentCacheVersion(key: string): boolean {
  return getCacheKeyVersion(key) === CACHE_VERSION;
}

// ============================================================================
// Cache Entry Helpers
// ============================================================================

/**
* Create a typed cache entry
*
* @param key - Cache key
* @param value - Value to cache
* @param ttlMs - Optional TTL in milliseconds
* @param tags - Optional tags for cache invalidation
* @returns Typed cache entry
*/
export function createCacheEntry<T>(
  key: string,
  value: T,
  ttlMs?: number,
  tags?: string[]
): TypedCacheEntry<T> {
  const now = new Date();
  const entry: TypedCacheEntry<T> = {
  key,
  value,
  createdAt: now,
  };

  if (ttlMs !== undefined && ttlMs > 0) {
  entry.expiresAt = new Date(now.getTime() + ttlMs);
  }

  return entry;
}

/**
* Check if a cache entry has expired
*
* @param entry - Cache entry to check
* @returns Whether the entry has expired
*/
export function isExpired<T>(entry: TypedCacheEntry<T>): boolean {
  if (!entry.expiresAt) return false;
  return new Date() > entry.expiresAt;
}

/**
* Calculate cache statistics
*
* @param hits - Number of cache hits
* @param misses - Number of cache misses
* @returns Cache statistics
*/
export function calculateCacheStats(hits: number, misses: number): CacheStats {
  const total = hits + misses;
  const hitRate = total > 0 ? hits / total : 0;

  return {
  hits,
  misses,
  size: total,
  hitRate: Math.round(hitRate * 100) / 100, // Round to 2 decimal places
  };
}
