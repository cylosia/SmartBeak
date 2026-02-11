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
    
    redis = new Redis(redisUrl, {
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
