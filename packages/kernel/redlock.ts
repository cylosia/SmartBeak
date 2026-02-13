/**
 * Distributed Locking with Redlock
 * 
 * P0-FIX: Implements distributed locking using Redis to prevent race conditions
 * across multiple worker processes. Critical for:
 * - Preventing duplicate job execution
 * - Ensuring idempotency across distributed workers
 * - Coordinating access to shared resources
 */

import { randomBytes } from 'crypto';
import { getRedis } from './redis';
import { getLogger } from './logger';

const redlockLogger = getLogger('redlock');

export interface Lock {
  resource: string;
  value: string;
  expiration: number;
}

export interface LockOptions {
  // Lock TTL in milliseconds (default: 10000)
  ttl?: number;
  // Retry delay in milliseconds (default: 200)
  retryDelay?: number;
  // Maximum retry attempts (default: 10)
  retryCount?: number;
}

const DEFAULT_OPTIONS: Required<LockOptions> = {
  ttl: 10000,
  retryDelay: 200,
  retryCount: 10,
};

/**
 * Generate a unique lock value using timestamp and random component
 */
function generateLockValue(): string {
  return `${Date.now()}-${randomBytes(16).toString('hex')}-${process.pid}`;
}

/**
 * Acquire a distributed lock
 * 
 * @param resource - Resource identifier to lock (e.g., 'publish:intent:123')
 * @param options - Lock options
 * @returns Lock object if acquired, null if failed
 * 
 * @example
 * ```typescript
 * const lock = await acquireLock('publish:intent:abc-123', { ttl: 5000 });
 * if (!lock) {
 *   throw new Error('Could not acquire lock - job already running');
 * }
 * try {
 *   await processJob();
 * } finally {
 *   await releaseLock(lock);
 * }
 * ```
 */
export async function acquireLock(
  resource: string,
  options: LockOptions = {}
): Promise<Lock | null> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const redis = await getRedis();
  const lockValue = generateLockValue();
  const lockKey = `lock:${resource}`;

  // P0-FIX: Use NX (only set if not exists) with PX (millisecond expiration)
  // This is atomic and race-condition safe
  const acquired = await redis.set(lockKey, lockValue, 'PX', opts.ttl, 'NX');

  if (acquired === 'OK') {
    return {
      resource,
      value: lockValue,
      expiration: Date.now() + opts.ttl,
    };
  }

  return null;
}

/**
 * Acquire lock with retry
 * 
 * @param resource - Resource identifier to lock
 * @param options - Lock options with retry
 * @returns Lock object if acquired, null if failed after retries
 */
export async function acquireLockWithRetry(
  resource: string,
  options: LockOptions = {}
): Promise<Lock | null> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  for (let attempt = 0; attempt < opts.retryCount; attempt++) {
    const lock = await acquireLock(resource, opts);
    if (lock) return lock;
    
    // Wait before retry
    await new Promise(resolve => setTimeout(resolve, opts.retryDelay));
  }

  return null;
}

/**
 * Release a distributed lock
 * 
 * P0-FIX: Uses Lua script for atomic check-and-delete to ensure
 * we only delete our own lock (not someone else's if TTL expired and re-acquired)
 * 
 * @param lock - Lock object returned by acquireLock
 * @returns true if released, false if lock was not held or expired
 */
export async function releaseLock(lock: Lock): Promise<boolean> {
  const redis = await getRedis();
  const lockKey = `lock:${lock.resource}`;

  // P0-FIX: Atomic check-and-delete using Lua
  // Only delete if the value matches (prevents deleting someone else's lock)
  const luaScript = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    else
      return 0
    end
  `;

  const result = await redis.eval(luaScript, 1, lockKey, lock.value);
  return result === 1;
}

/**
 * Extend lock expiration
 * 
 * @param lock - Existing lock
 * @param additionalTtl - Additional milliseconds to add
 * @returns true if extended, false if lock expired or was taken by another
 */
export async function extendLock(
  lock: Lock,
  additionalTtl: number
): Promise<boolean> {
  const redis = await getRedis();
  const lockKey = `lock:${lock.resource}`;

  // Atomic check-and-extend
  const luaScript = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("pexpire", KEYS[1], ARGV[2])
    else
      return 0
    end
  `;

  const result = await redis.eval(
    luaScript,
    1,
    lockKey,
    lock.value,
    String(additionalTtl)
  );

  if (result === 1) {
    lock.expiration = Date.now() + additionalTtl;
    return true;
  }

  return false;
}

/**
 * Execute function with distributed lock
 * 
 * @param resource - Resource to lock
 * @param fn - Function to execute while holding lock
 * @param options - Lock options
 * @returns Function result
 * @throws Error if lock cannot be acquired or function throws
 * 
 * @example
 * ```typescript
 * const result = await withLock('publish:intent:123', async () => {
 *   return await processPublishIntent(intentId);
 * }, { ttl: 10000 });
 * ```
 */
export async function withLock<T>(
  resource: string,
  fn: () => Promise<T>,
  options: LockOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const lock = await acquireLockWithRetry(resource, opts);

  if (!lock) {
    throw new Error(`Could not acquire lock for resource: ${resource}`);
  }

  try {
    return await fn();
  } finally {
    // Always release lock, even if function throws
    await releaseLock(lock).catch(err => {
      // AUDIT-FIX P2-03: Use structured logger instead of console.error
      redlockLogger.error(`Failed to release lock for ${resource}`, err instanceof Error ? err : new Error(String(err)));
    });
  }
}

/**
 * Check if a resource is currently locked
 * 
 * @param resource - Resource identifier
 * @returns true if locked, false if available
 */
export async function isLocked(resource: string): Promise<boolean> {
  const redis = await getRedis();
  const lockKey = `lock:${resource}`;
  const exists = await redis.exists(lockKey);
  return exists === 1;
}

/**
 * Get lock information
 * 
 * @param resource - Resource identifier
 * @returns Lock value and TTL if locked, null otherwise
 */
export async function getLockInfo(resource: string): Promise<{
  value: string;
  ttl: number;
} | null> {
  const redis = await getRedis();
  const lockKey = `lock:${resource}`;

  const [value, ttl] = await Promise.all([
    redis.get(lockKey),
    redis.pttl(lockKey),
  ]);

  if (!value || ttl === -2) {
    return null;
  }

  return {
    value,
    ttl: ttl === -1 ? 0 : ttl, // -1 means no TTL, convert to 0
  };
}
