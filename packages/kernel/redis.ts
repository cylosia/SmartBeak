/**
 * Redis Client
 * 
 * Centralized Redis connection management for the kernel package.
 * P0-FIX: Created this file to resolve TS2307 errors from missing module.
 */

import Redis from 'ioredis';
import { Mutex } from 'async-mutex';
import { getLogger } from './logger';

// Global Redis instance
let redis: Redis | null = null;
// Mutex prevents concurrent callers from each creating their own Redis
// connection during cold-start or post-error recovery, which would leave
// orphaned connections that are never closed.
const redisMutex = new Mutex();

const logger = getLogger('RedisClient');

/**
 * Get Redis connection
 * Creates a new connection if one doesn't exist.
 * The mutex ensures only one connection is ever created, even under
 * concurrent initialisation (e.g. Lambda cold-start or post-error reset).
 */
export async function getRedis(): Promise<Redis> {
  // Fast path — connection already established
  if (redis) return redis;

  return redisMutex.runExclusive(async () => {
    // Re-check inside the lock: another waiter may have initialised it
    if (redis) return redis;

    const redisUrl = process.env['REDIS_URL'];
    if (!redisUrl) {
      throw new Error('REDIS_URL environment variable is required');
    }

    // SECURITY FIX (Finding 11): Add environment-based key prefix to prevent
    // cross-environment key collisions when prod/staging share the same Redis
    const env = process.env['NODE_ENV'] || 'development';
    const prefix = process.env['CACHE_PREFIX'] || 'cache';

    const newRedis = new Redis(redisUrl, {
      keyPrefix: `${env}:${prefix}:`,
      retryStrategy: (times: number): number => Math.min(times * 50, 2000),
      maxRetriesPerRequest: 3,
    });

    newRedis.on('error', (err: Error) => {
      logger.error('Redis connection error', err);
      // P0-FIX: Acquire the mutex before resetting the singleton to prevent a
      // TOCTOU race where a concurrent getRedis() caller checks `if (redis)`
      // on the fast path (line 29) between the reset here and the mutex re-check
      // inside runExclusive. Without the mutex, multiple callers could each
      // create a new connection after a fatal error, leaking all but one.
      const fatalPatterns = ['ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET', 'ERR AUTH'];
      if (fatalPatterns.some(p => err.message.includes(p))) {
        logger.warn('Fatal Redis error detected, resetting connection for recovery');
        redisMutex.runExclusive(async () => {
          // Only reset if we still hold the same instance — another caller may
          // have already created a fresh connection while we were waiting.
          if (redis === newRedis) {
            try { await newRedis.quit(); } catch { /* ignore quit errors on dead conn */ }
            redis = null;
          }
        }).catch((mutexErr: unknown) => {
          logger.error(
            'Failed to acquire mutex during Redis error recovery',
            mutexErr instanceof Error ? mutexErr : new Error(String(mutexErr))
          );
        });
      }
    });

    redis = newRedis;
    return redis;
  });
}

/**
 * Close Redis connection gracefully
 */
export async function closeRedis(): Promise<void> {
  if (redis) {
    try {
      await redis.quit();
    } catch (err) {
      logger.error('Error closing Redis connection', err as Error);
    }
    redis = null;
  }
}

// F14-FIX: Register Redis shutdown handler for SIGTERM/SIGINT. Without this,
// Redis connections leak on every deploy because closeRedis() existed
// but was never called during graceful shutdown (unlike the DB connection
// which is properly registered via registerShutdownHandler in db.ts).
process.on('SIGTERM', () => {
  logger.info('SIGTERM received - closing Redis connection');
  closeRedis().catch((err) => {
    logger.error('Failed to close Redis during SIGTERM', err instanceof Error ? err : new Error(String(err)));
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received - closing Redis connection');
  closeRedis().catch((err) => {
    logger.error('Failed to close Redis during SIGINT', err instanceof Error ? err : new Error(String(err)));
  });
});

export { Redis };
