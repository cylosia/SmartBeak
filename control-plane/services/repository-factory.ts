import { Pool } from 'pg';

import { getLogger } from '@kernel/logger';

import { PostgresContentRepository } from '../../domains/content/infra/persistence/PostgresContentRepository';
import { PostgresContentRevisionRepository } from '../../domains/content/infra/persistence/PostgresContentRevisionRepository';
import { resolveDomainDb } from './domain-registry';

﻿import { LRUCache } from 'lru-cache';



/**
* Repository Factory
* Provides singleton instances of repositories with connection pooling
*/

const logger = getLogger('repository-factory');

const repositoryCache = new LRUCache<string, object>({ max: 100 });
const poolCache = new LRUCache<string, Pool>({
  max: 100,
  ttlAutopurge: true,
  allowStale: false,
  updateAgeOnGet: true,
  updateAgeOnHas: true,
});

/**
* Get or create a connection pool for a database
*/
export function getPool(connectionString: string): Pool {
  let pool = poolCache.get(connectionString);
  if (!pool) {
  pool = new Pool({
    max: 20, // Maximum pool size
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,  // P1-FIX: Increased from 2000ms to prevent timeouts under load
  });

  pool.on('error', (err) => {
    logger.error('Pool error', err);
  });

  poolCache.set(connectionString, pool);
  }
  return pool;
}

/**
* Get ContentRepository instance (singleton per domain)
*/
export function getContentRepository(domainId: string = 'content'): PostgresContentRepository {
  const cacheKey = `content:${domainId}`;

  if (!repositoryCache.has(cacheKey)) {
  const connectionString = resolveDomainDb(domainId);
  const pool = getPool(connectionString);
  const repo = new PostgresContentRepository(pool);
  repositoryCache.set(cacheKey, repo);
  }

  return repositoryCache.get(cacheKey) as PostgresContentRepository;
}

/**
* Get ContentRevisionRepository instance
*/
export function getContentRevisionRepository(domainId: string = 'content'): PostgresContentRevisionRepository {
  const cacheKey = `revision:${domainId}`;

  if (!repositoryCache.has(cacheKey)) {
  const connectionString = resolveDomainDb(domainId);
  const pool = getPool(connectionString);
  const repo = new PostgresContentRevisionRepository(pool);
  repositoryCache.set(cacheKey, repo);
  }

  return repositoryCache.get(cacheKey) as PostgresContentRevisionRepository;
}

/**
* Clear all repository instances (useful for testing)
*/
export async function clearRepositoryCache(): Promise<void> {
  repositoryCache["clear"]();

  // Close all pools and await completion
  const poolClosePromises: Promise<void>[] = [];
  for (const [key, pool] of Array.from(poolCache.entries())) {
  poolClosePromises.push(
    pool.end().catch(err => {
    logger.error('Error closing pool', err, { key });
    })
  );
  }

  await Promise.all(poolClosePromises);
  poolCache["clear"]();
}

/**
* Get repository health status
*/
export async function getRepositoryHealth(): Promise<{
  pools: number;
  repositories: number;
  poolStats: Record<string, { total: number; idle: number; waiting: number }>;
}> {
  const poolStats: Record<string, { total: number; idle: number; waiting: number }> = {};

  for (const [key, pool] of Array.from(poolCache.entries())) {
  poolStats[key] = {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
  };
  }

  return {
  pools: poolCache.size,
  repositories: repositoryCache.size,
  poolStats,
  };
}
