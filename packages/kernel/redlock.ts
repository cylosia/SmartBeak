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
  /** Monotonically increasing fencing token for stale-lock detection */
  fencingToken: number;
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
  const fencingKey = `fence:${resource}`;

  // Atomically: SET NX with PX expiration + INCR fencing token.
  // The fencing token is a monotonically increasing counter that allows
  // downstream systems to reject writes from stale lock holders.
  //
  // The fencing key TTL is set to FENCE_KEY_TTL_MULTIPLIER × the lock TTL so
  // the counter survives multiple lock cycles (e.g. retries) but is eventually
  // cleaned up automatically. Without an expiry the fence:* key accumulates
  // forever in Redis for every unique resource ever locked.
  const FENCE_KEY_TTL_MULTIPLIER = 100;
  const luaAcquire = `
    local acquired = redis.call("set", KEYS[1], ARGV[1], "PX", ARGV[2], "NX")
    if acquired then
      local token = redis.call("incr", KEYS[2])
      local fenceTtl = tonumber(ARGV[2]) * tonumber(ARGV[3])
      redis.call("pexpire", KEYS[2], fenceTtl)
      return token
    else
      return -1
    end
  `;

  const result = await redis.eval(luaAcquire, 2, lockKey, fencingKey, lockValue, String(opts.ttl), String(FENCE_KEY_TTL_MULTIPLIER));

  // Validate the Lua script response before trusting it.
  // redis.eval() returns `unknown`. The Lua script returns either -1 (lock not
  // acquired) or a positive integer fencing token (lock acquired).
  //
  // Bug in the previous guard: `typeof result !== 'number' && !Number.isInteger(result)`
  // used `&&`, so a non-integer number like 1.5 bypassed validation entirely:
  //   typeof 1.5 !== 'number'  → false → && short-circuits → block skipped
  //   token = Number(1.5) = 1.5, Number.isFinite(1.5) = true → no throw
  //   1.5 >= 0 → true → phantom lock granted.
  //
  // The correct predicate is `!Number.isInteger(result)` which rejects ALL of:
  //   null, undefined, strings, arrays, floats, Infinity, NaN
  // because Number.isInteger requires typeof === 'number' AND no fractional part.
  if (!Number.isInteger(result)) {
    throw new Error(
      `Unexpected Lua response for lock acquire on "${resource}": expected integer, got ${typeof result} (${JSON.stringify(result)})`
    );
  }
  const token = result as number;

  if (token >= 0) {
    return {
      resource,
      value: lockValue,
      expiration: Date.now() + opts.ttl,
      fencingToken: token,
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

    // Add ±25% jitter to the retry delay to prevent thundering herd when
    // multiple processes are waiting on the same lock simultaneously.
    const jitter = opts.retryDelay * 0.25 * (Math.random() * 2 - 1);
    const delay = Math.max(0, Math.floor(opts.retryDelay + jitter));
    await new Promise(resolve => setTimeout(resolve, delay));
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
 * const result = await withLock('publish:intent:123', async (lock) => {
 *   // lock.fencingToken can be used to validate writes
 *   return await processPublishIntent(intentId);
 * }, { ttl: 10000 });
 * ```
 */
export async function withLock<T>(
  resource: string,
  fn: (lock: Lock) => Promise<T>,
  options: LockOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const lock = await acquireLockWithRetry(resource, opts);

  if (!lock) {
    throw new Error(`Could not acquire lock for resource: ${resource}`);
  }

  try {
    return await fn(lock);
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
