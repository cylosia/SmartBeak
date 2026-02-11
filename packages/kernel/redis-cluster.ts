/**
 * Redis Cluster Configuration
 *
 * Provides Redis Cluster creation and health checking for the kernel package.
 * Modeled on packages/database/redis-cluster.ts for consistency.
 */

import Redis from 'ioredis';
import { getLogger } from './logger';

const logger = getLogger('RedisCluster');

export interface RedisClusterOptions {
  nodes?: { host: string; port: number }[];
  password?: string;
  maxRetriesPerRequest?: number;
}

/**
 * Parse cluster nodes from environment variable.
 * Format: "redis1:6379,redis2:6379,redis3:6379"
 */
function parseClusterNodes(): { host: string; port: number }[] {
  const nodesEnv = process.env['REDIS_CLUSTER_NODES'];
  if (!nodesEnv) {
    return [{ host: 'localhost', port: 6379 }];
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
 * Create a Redis Cluster client.
 */
export function createRedisCluster(options?: RedisClusterOptions): InstanceType<typeof Redis.Cluster> {
  const nodes = options?.nodes || parseClusterNodes();

  const cluster = new Redis.Cluster(nodes, {
    redisOptions: {
      password: options?.password || process.env['REDIS_PASSWORD'],
      maxRetriesPerRequest: options?.maxRetriesPerRequest || 3,
    },
    clusterRetryStrategy: (times: number) => {
      const delay = Math.min(times * 100, 3000);
      logger.warn(`Redis Cluster retry attempt ${times}, delay ${delay}ms`);
      return delay;
    },
    lazyConnect: true,
  });

  cluster.on('error', (err) => {
    logger.error('Redis Cluster error', err);
  });

  return cluster;
}

/**
 * Check Redis Cluster health by parsing INFO stats output.
 */
export async function checkRedisClusterHealth(
  client: Redis | InstanceType<typeof Redis.Cluster>,
): Promise<{
  healthy: boolean;
  hits: number;
  misses: number;
  nodeCount: number;
}> {
  try {
    const info = await client.info('stats');
    const hits = parseInt(info.match(/keyspace_hits:(\d+)/)?.[1] ?? '0', 10);
    const misses = parseInt(info.match(/keyspace_misses:(\d+)/)?.[1] ?? '0', 10);

    const isCluster = client instanceof Redis.Cluster;
    const nodeCount = isCluster ? client.nodes('master').length : 1;

    return { healthy: true, hits, misses, nodeCount };
  } catch (error) {
    logger.error('Redis health check failed', error as Error);
    return { healthy: false, hits: 0, misses: 0, nodeCount: 0 };
  }
}
