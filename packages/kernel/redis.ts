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
      logger.error('Connection error', err);
      // AUDIT-FIX P1-04: On fatal connection errors, reset the singleton
      // so the next getRedis() call creates a fresh connection instead
      // of returning the dead instance forever.
      const fatalPatterns = ['ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET', 'ERR AUTH'];
      if (fatalPatterns.some(p => err.message.includes(p))) {
        logger.warn('Fatal Redis error detected - resetting connection for recovery');
        redis = null;
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
