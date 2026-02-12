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
 * Get Redis connection
 * Creates a new connection if one doesn't exist
 */
export async function getRedis(): Promise<Redis> {
  if (!redis) {
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
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received - closing Redis connection');
  await closeRedis();
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received - closing Redis connection');
  await closeRedis();
});

export { Redis };
