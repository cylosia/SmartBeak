/**
 * P1-FIX: Redis Cluster Configuration
 * 
 * Provides high availability and automatic failover for Redis.
 * Critical for production environments to prevent single point of failure.
 */

import type { Redis as RedisType, Cluster as ClusterType, RedisOptions, NatMap } from 'ioredis';
import Redis from 'ioredis';
import { getLogger } from '@kernel/logger';

// Environment variable type declarations
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace NodeJS {
    interface ProcessEnv {
      REDIS_CLUSTER?: string;
      REDIS_CLUSTER_NODES?: string;
      REDIS_HOST?: string;
      REDIS_PASSWORD?: string;
    }
  }
}

type RedisOrCluster = RedisType | ClusterType;

const logger = getLogger('database:redis-cluster');

export interface RedisClusterConfig {
  // Cluster nodes: [{ host: 'redis1', port: 6379 }, ...]
  nodes: { host: string; port: number }[];
  // Redis password (if configured)
  password?: string;
  // Enable NAT mapping for Docker/Kubernetes
  natMap?: Record<string, { host: string; port: number }>;
  // Max retries per request
  maxRetriesPerRequest?: number;
  // Enable offline queue
  enableOfflineQueue?: boolean;
  // Scale reads to replicas
  scaleReads?: 'master' | 'slave' | 'all';
}

/**
 * Detect if we should use Redis Cluster
 * Based on environment variable or node count
 */
export function shouldUseCluster(): boolean {
  return process.env['REDIS_CLUSTER'] === 'true' || 
         process.env['REDIS_CLUSTER_NODES'] !== undefined;
}

/**
 * Parse cluster nodes from environment
 * Format: "redis1:6379,redis2:6379,redis3:6379"
 */
export function parseClusterNodes(): { host: string; port: number }[] {
  const nodesEnv = process.env['REDIS_CLUSTER_NODES'];
  if (!nodesEnv) {
    // Default single node for development
    return [{ host: process.env['REDIS_HOST'] || 'localhost', port: 6379 }];
  }

  return nodesEnv.split(',').map(node => {
    const [host, port] = node.trim().split(':');
    return {
      host: (host ?? 'localhost') as string,
      port: parseInt(port!, 10) || 6379,
    };
  });
}

/**
 * Create Redis Cluster client
 * P1-FIX: Provides high availability and automatic failover
 */
export function createRedisCluster(config?: Partial<RedisClusterConfig>): RedisOrCluster {
  const nodes = config?.nodes || parseClusterNodes();
  const isCluster = shouldUseCluster();

  if (!isCluster) {
    logger.info('Using single Redis node (set REDIS_CLUSTER=true for cluster mode)');
    // Return a regular Redis client that implements the same interface
    const redisOptions: RedisOptions = {
      host: nodes[0]?.host || 'localhost',
      port: nodes[0]?.port || 6379,
      keyPrefix: `${process.env['NODE_ENV'] || 'development'}:`,
      maxRetriesPerRequest: config?.maxRetriesPerRequest || 3,
      enableOfflineQueue: config?.enableOfflineQueue ?? true,
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
    };
    const password = config?.password || process.env['REDIS_PASSWORD'];
    if (password) {
      redisOptions.password = password;
    }
    return new Redis(redisOptions);
  }

  logger.info(`Connecting to Redis Cluster with ${nodes.length} nodes`);

  const cluster = new Redis.Cluster(nodes, {
    redisOptions: {
      password: config?.password || process.env['REDIS_PASSWORD'],
      keyPrefix: `${process.env['NODE_ENV'] || 'development'}:`,
      maxRetriesPerRequest: config?.maxRetriesPerRequest || 3,
      enableOfflineQueue: config?.enableOfflineQueue ?? true,
    } as RedisOptions,
    ...(config?.natMap !== undefined && { natMap: config.natMap as NatMap }),
    scaleReads: config?.scaleReads || 'master',
    // P1-FIX: Retry settings for cluster resilience
    clusterRetryStrategy: (times) => {
      const delay = Math.min(times * 100, 3000);
      logger.warn(`Redis Cluster retry attempt ${times}, delay ${delay}ms`);
      return delay;
    },
    // P1-FIX: Enable lazy connections for faster startup
    lazyConnect: true,
  });

  // P1-FIX: Handle cluster events
  cluster.on('connect', () => {
    logger.info('Redis Cluster connected');
  });

  cluster.on('ready', () => {
    logger.info('Redis Cluster ready');
  });

  cluster.on('error', (err) => {
    logger.error('Redis Cluster error', err);
  });

  cluster.on('node error', (err, node) => {
    logger.error(`Redis Cluster node error (${node.options.host}:${node.options.port})`, err);
  });

  return cluster;
}

/**
 * Get Redis client (single or cluster)
 * Singleton pattern for reuse across the application
 */
let redisClient: RedisOrCluster | undefined = undefined;

// P0-FIX: Track shutdown state to prevent race conditions
let shutdownPromise: Promise<void> | null = null;
let sigtermRegistered = false;

export async function getRedisClient(): Promise<RedisOrCluster> {
  if (redisClient) {
    return redisClient;
  }

  redisClient = createRedisCluster();
  
  // Ensure connection for non-cluster Redis client
  if (redisClient instanceof Redis && typeof redisClient.connect === 'function') {
    await redisClient.connect();
  }

  // P0-FIX: Register SIGTERM handler only once to prevent multiple registrations
  if (!sigtermRegistered) {
    sigtermRegistered = true;
    
    process.on('SIGTERM', () => {
      if (redisClient && !shutdownPromise) {
        shutdownPromise = redisClient.quit()
          .then(() => { 
            redisClient = undefined; 
            logger.info('[Redis] Connection closed gracefully');
          })
          .catch(err => logger.error('[Redis] Shutdown error', err));
      }
    });
    
    // P0-FIX: Wait for shutdown before process exits to prevent race conditions
    process.on('beforeExit', async () => {
      if (shutdownPromise) {
        await shutdownPromise;
      }
    });
  }

  return redisClient;
}

/**
 * Check Redis Cluster health
 */
export async function checkRedisClusterHealth(
  client: RedisOrCluster
): Promise<{
  healthy: boolean;
  mode: 'cluster' | 'standalone' | 'unknown';
  nodeCount: number;
  usedMemory: string;
  hits: number;
  misses: number;
}> {
  try {
    const info = await client.info('stats');
    const memory = await client.info('memory');
    
    const hits = parseInt(info.match(/keyspace_hits:(\d+)/)?.[1] ?? '0', 10);
    const misses = parseInt(info.match(/keyspace_misses:(\d+)/)?.[1] ?? '0', 10);
    const usedMemory = memory.match(/used_memory_human:(.+)/)?.[1] ?? 'unknown';

    const isCluster = client instanceof Redis.Cluster;
    const nodeCount = isCluster ? client.nodes('master').length : 1;

    return {
      healthy: true,
      mode: isCluster ? 'cluster' : 'standalone',
      nodeCount,
      usedMemory,
      hits,
      misses,
    };
  } catch (error) {
    logger.error('Redis health check failed', error as Error);
    return {
      healthy: false,
      mode: 'unknown' as const,
      nodeCount: 0,
      usedMemory: 'unknown',
      hits: 0,
      misses: 0,
    };
  }
}

/**
 * Execute Lua script on Redis Cluster
 * P1-FIX: Handles Redis Cluster hash slot requirements
 */
export async function executeLuaOnCluster(
  client: RedisOrCluster,
  script: string,
  keys: string[],
  args: (string | number | Buffer)[]
): Promise<unknown> {
  // P1-FIX: For cluster, all keys must be in the same hash slot
  // Use hash tags to ensure this: {tag}:key1, {tag}:key2
  
  if (client instanceof Redis.Cluster) {
    // Cluster mode - keys must hash to same slot
    const hashTag = keys[0]?.match(/\{([^}]+)\}/)?.[1];
    if (keys.length > 1 && !hashTag) {
      logger.warn('Multiple keys without hash tag in cluster mode may fail');
    }
  }

  return client.eval(script, keys.length, ...keys, ...args);
}
