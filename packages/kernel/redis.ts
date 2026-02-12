/**
 * Redis Client
 * 
 * Centralized Redis connection management for the kernel package.
 * P0-FIX: Created this file to resolve TS2307 errors from missing module.
 */

import Redis from 'ioredis';
import { getLogger } from './logger';

// Global Redis instance
let redis: Redis | null = null;

const logger = getLogger('RedisClient');

/**
 * Get Redis connection.
 * I5-FIX: Delegates to redis-cluster.ts when REDIS_CLUSTER=true,
 * otherwise creates a standalone client with key prefix.
 * This consolidates the 3 separate Redis client creation paths into one.
 */
export async function getRedis(): Promise<Redis> {
  if (!redis) {
    // I5-FIX: Check if cluster mode should be used
    const useCluster = process.env['REDIS_CLUSTER'] === 'true';
    if (useCluster) {
      try {
        const { shouldUseCluster, getRedisClient } = await import('@database/redis-cluster');
        if (shouldUseCluster()) {
          redis = await getRedisClient() as unknown as Redis;
          logger.info('Using Redis cluster client');
          return redis;
        }
      } catch (err) {
        logger.warn('Failed to initialize Redis cluster, falling back to standalone', err instanceof Error ? err : new Error(String(err)));
      }
    }

    // Standalone mode (default)
    const redisUrl = process.env['REDIS_URL'];
    if (!redisUrl) {
      throw new Error('REDIS_URL environment variable is required');
    }

    // SECURITY FIX (Finding 11): Add environment-based key prefix to prevent
    // cross-environment key collisions when prod/staging share the same Redis
    const env = process.env['NODE_ENV'] || 'development';
    const prefix = process.env['CACHE_PREFIX'] || 'cache';

    redis = new Redis(redisUrl, {
      keyPrefix: `${env}:${prefix}:`,
      retryStrategy: (times: number): number => Math.min(times * 50, 2000),
      maxRetriesPerRequest: 3,
    });

    redis.on('error', (err: Error) => {
      logger.error('Connection error', err);
    });
  }

  return redis;
}

/**
 * Close Redis connection gracefully
 */
export async function closeRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}

export { Redis };
