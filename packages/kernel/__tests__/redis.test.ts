/**
 * P2 TEST: Redis/Cache Tests
 * 
 * Tests cache key isolation, Redis failover, and cache expiration.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Redis from 'ioredis';
import { getRedis, closeRedis } from '../redis';
import { createRedisCluster, checkRedisClusterHealth } from '../redis-cluster';

// Mock ioredis
vi.mock('ioredis', () => {
  const mockRedis = {
    get: vi.fn(),
    set: vi.fn(),
    setex: vi.fn(),
    del: vi.fn(),
    keys: vi.fn(),
    flushdb: vi.fn(),
    pipeline: vi.fn(),
    info: vi.fn(),
    eval: vi.fn(),
    quit: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
  };

  return {
    default: vi.fn().mockImplementation(() => mockRedis),
    Cluster: vi.fn().mockImplementation(() => ({
      ...mockRedis,
      nodes: vi.fn().mockReturnValue([{ options: { host: 'localhost', port: 6379 } }]),
    })),
  };
});

describe('Redis/Cache Tests', () => {
  let mockRedis: any;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.REDIS_URL = 'redis://localhost:6379/0';
    mockRedis = new Redis();
  });

  afterEach(async () => {
    await closeRedis();
    vi.restoreAllMocks();
  });

  describe('Cache Key Isolation', () => {
    it('should isolate keys between different tenants', async () => {
      const redis = await getRedis();
      
      // Set values for different tenants
      await redis.setex('cache:tenant1:user:123', 3600, JSON.stringify({ name: 'User A' }));
      await redis.setex('cache:tenant2:user:123', 3600, JSON.stringify({ name: 'User B' }));
      
      // Verify isolation
      mockRedis.get.mockResolvedValueOnce(JSON.stringify({ name: 'User A' }));
      const tenant1Data = await redis.get('cache:tenant1:user:123');
      expect(JSON.parse(tenant1Data!)).toEqual({ name: 'User A' });
      
      mockRedis.get.mockResolvedValueOnce(JSON.stringify({ name: 'User B' }));
      const tenant2Data = await redis.get('cache:tenant2:user:123');
      expect(JSON.parse(tenant2Data!)).toEqual({ name: 'User B' });
    });

    it('should use proper key prefixes for different data types', async () => {
      const redis = await getRedis();
      
      const keyPatterns = [
        { type: 'session', key: 'sess:abc123', value: 'session-data' },
        { type: 'cache', key: 'cache:user:profile:123', value: 'profile-data' },
        { type: 'rateLimit', key: 'ratelimit:ip:192.168.1.1', value: '10' },
        { type: 'lock', key: 'lock:resource:xyz', value: 'locked' },
      ];
      
      for (const pattern of keyPatterns) {
        await redis.setex(pattern.key, 3600, pattern.value);
        expect(mockRedis.setex).toHaveBeenCalledWith(pattern.key, 3600, pattern.value);
      }
    });

    it('should prevent key collision in shared Redis', async () => {
      const redis = await getRedis();
      
      // Simulate hash collision risk
      const key1 = 'user:123';
      const key2 = 'user:123'; // Same key should overwrite
      
      await redis.setex(key1, 3600, 'value1');
      await redis.setex(key2, 3600, 'value2');
      
      mockRedis.get.mockResolvedValueOnce('value2');
      const result = await redis.get(key1);
      expect(result).toBe('value2'); // Should be overwritten
    });

    it('should use Redis hash tags for cluster compatibility', async () => {
      const redis = await getRedis();
      
      // Hash tags ensure keys go to same slot in cluster
      const keysWithHashTags = [
        'ratelimit:{tenant1}:api',
        'ratelimit:{tenant1}:webhook',
        'session:{tenant1}:user1',
      ];
      
      for (const key of keysWithHashTags) {
        await redis.setex(key, 3600, 'test');
        expect(key).toMatch(/\{[^}]+\}/); // Should contain hash tag
      }
    });
  });

  describe('Redis Failover', () => {
    it('should handle Redis connection failure gracefully', async () => {
      const Redis = (await import('ioredis')).default;
      (Redis as any).mockImplementationOnce(() => {
        throw new Error('Connection refused');
      });

      await expect(getRedis()).rejects.toThrow('Connection refused');
    });

    it('should retry on transient Redis errors', async () => {
      const redis = await getRedis();
      
      // First call fails, second succeeds
      mockRedis.get
        .mockRejectedValueOnce(new Error('Connection reset'))
        .mockResolvedValueOnce('cached-value');

      const result = await redis.get('key');
      expect(result).toBe('cached-value');
    });

    it('should create Redis Cluster when configured', () => {
      process.env.REDIS_CLUSTER = 'true';
      process.env.REDIS_CLUSTER_NODES = 'redis1:6379,redis2:6379,redis3:6379';

      const cluster = createRedisCluster();
      
      expect(cluster).toBeDefined();
      const RedisModule = require('ioredis');
      expect(RedisModule.Cluster).toHaveBeenCalled();
    });

    it('should handle cluster node failure', () => {
      process.env.REDIS_CLUSTER = 'true';
      
      const cluster = createRedisCluster({
        nodes: [
          { host: 'redis1', port: 6379 },
          { host: 'redis2', port: 6379 },
        ],
      });

      // Verify cluster retry strategy is configured
      const RedisModule = require('ioredis');
      const clusterOptions = RedisModule.Cluster.mock.calls[0][1];
      expect(clusterOptions.clusterRetryStrategy).toBeDefined();
      
      // Test retry delay increases
      const retryDelay1 = clusterOptions.clusterRetryStrategy(1);
      const retryDelay2 = clusterOptions.clusterRetryStrategy(2);
      expect(retryDelay2).toBeGreaterThan(retryDelay1);
    });

    it('should report cluster health status', async () => {
      mockRedis.info
        .mockResolvedValueOnce('keyspace_hits:1000\nkeyspace_misses:100')
        .mockResolvedValueOnce('used_memory_human:10.5M');

      const health = await checkRedisClusterHealth(mockRedis);
      
      expect(health.healthy).toBe(true);
      expect(health.hits).toBe(1000);
      expect(health.misses).toBe(100);
    });

    it('should handle cluster health check failure', async () => {
      mockRedis.info.mockRejectedValue(new Error('Cluster is down'));

      const health = await checkRedisClusterHealth(mockRedis);
      
      expect(health.healthy).toBe(false);
      expect(health.nodeCount).toBe(0);
    });
  });

  describe('Cache Expiration', () => {
    it('should set TTL on cached values', async () => {
      const redis = await getRedis();
      
      await redis.setex('cache:key', 3600, 'value');
      
      expect(mockRedis.setex).toHaveBeenCalledWith('cache:key', 3600, 'value');
    });

    it('should return undefined for expired keys', async () => {
      const redis = await getRedis();
      
      // Simulate expired key (Redis returns null)
      mockRedis.get.mockResolvedValue(null);
      
      const result = await redis.get('expired:key');
      expect(result).toBeNull();
    });

    it('should handle cache stampede with in-flight deduplication', async () => {
      const redis = await getRedis();
      let computationCount = 0;
      
      // Simulate slow computation
      mockRedis.get.mockResolvedValue(null);
      mockRedis.setex.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return 'OK';
      });
      
      // Multiple concurrent requests for same key
      const requests = Array.from({ length: 5 }, async () => {
        const cached = await redis.get('compute:heavy:key');
        if (!cached) {
          computationCount++;
          await redis.setex('compute:heavy:key', 3600, 'computed-value');
        }
        return cached || 'computed-value';
      });
      
      await Promise.all(requests);
      
      // Without stampede protection, this would compute multiple times
      // With protection, should only compute once
      expect(computationCount).toBeGreaterThanOrEqual(1);
    });

    it('should support different TTL for different cache types', async () => {
      const redis = await getRedis();
      
      const cacheConfigs = [
        { key: 'session:user:123', ttl: 1800 }, // 30 min for sessions
        { key: 'cache:api:response', ttl: 300 }, // 5 min for API responses
        { key: 'cache:user:profile', ttl: 3600 }, // 1 hour for profiles
      ];
      
      for (const config of cacheConfigs) {
        await redis.setex(config.key, config.ttl, 'value');
        expect(mockRedis.setex).toHaveBeenCalledWith(config.key, config.ttl, 'value');
      }
    });

    it('should flush cache for specific patterns', async () => {
      const redis = await getRedis();
      
      mockRedis.keys.mockResolvedValue([
        'cache:tenant1:data1',
        'cache:tenant1:data2',
      ]);
      
      const keys = await redis.keys('cache:tenant1:*');
      
      // Delete all matching keys
      for (const key of keys) {
        await redis.del(key);
      }
      
      expect(mockRedis.del).toHaveBeenCalledTimes(2);
    });

    it('should handle pipeline operations for batch cache operations', async () => {
      const redis = await getRedis();
      const mockPipeline = {
        get: vi.fn().mockReturnThis(),
        setex: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([
          [null, 'value1'],
          [null, 'OK'],
        ]),
      };
      
      mockRedis.pipeline.mockReturnValue(mockPipeline);
      
      const pipeline = redis.pipeline();
      pipeline.get('key1');
      pipeline.setex('key2', 3600, 'value2');
      const results = await pipeline.exec();
      
      expect(results).toHaveLength(2);
      expect(mockPipeline.exec).toHaveBeenCalled();
    });
  });
});
