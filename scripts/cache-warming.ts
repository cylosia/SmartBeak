/**
 * Cache Warming Script
 * 
 * P2 OPTIMIZATION: Pre-loads frequently accessed data into cache
 * Run this during low-traffic periods for optimal cache hit rates
 */

import { MultiTierCache, CacheWarmer, getGlobalCache } from '../packages/cache';
import { getLogger } from '../packages/kernel/logger';

const logger = getLogger('CacheWarming');

// ============================================================================
// Configuration
// ============================================================================

const _rawInterval = parseInt(process.env['CACHE_WARM_INTERVAL_MS'] ?? '300000', 10);
const _rawStart = parseInt(process.env['LOW_TRAFFIC_START_HOUR'] ?? '2', 10);
const _rawEnd = parseInt(process.env['LOW_TRAFFIC_END_HOUR'] ?? '5', 10);

const CACHE_WARMING_CONFIG = {
  redisUrl: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
  intervalMs: Number.isNaN(_rawInterval) ? 300000 : _rawInterval, // 5 minutes default
  lowTrafficHours: {
    start: Number.isNaN(_rawStart) ? 2 : _rawStart, // 2 AM default
    end: Number.isNaN(_rawEnd) ? 5 : _rawEnd,       // 5 AM default
  },
};

// ============================================================================
// Data Sources for Warming
// ============================================================================

interface WarmableDataSource {
  id: string;
  fetch: () => Promise<unknown>;
  cacheKey: string;
  priority: number;
  ttlMs: number;
  tags: string[];
}

// Define hot data sources that should be pre-loaded
const hotDataSources: WarmableDataSource[] = [
  // Example: User preferences (frequently accessed)
  {
    id: 'user-preferences',
    fetch: async () => {
      logger.info('Fetching user preferences for cache warming');
      return { theme: 'dark', language: 'en' };
    },
    cacheKey: 'config:user-preferences',
    priority: 10,
    ttlMs: 300000, // 5 minutes
    tags: ['config', 'user'],
  },
  // Example: Feature flags
  {
    id: 'feature-flags',
    fetch: async () => {
      logger.info('Fetching feature flags for cache warming');
      return { enableNewUI: true, betaFeature: false };
    },
    cacheKey: 'config:feature-flags',
    priority: 9,
    ttlMs: 60000, // 1 minute (frequently changing)
    tags: ['config', 'features'],
  },
  // Example: Reference data
  {
    id: 'reference-data',
    fetch: async () => {
      logger.info('Fetching reference data for cache warming');
      return { categories: [], statuses: [] };
    },
    cacheKey: 'data:reference',
    priority: 8,
    ttlMs: 3600000, // 1 hour (stable data)
    tags: ['data', 'reference'],
  },
  // Example: Dashboard stats (expensive query)
  {
    id: 'dashboard-stats',
    fetch: async () => {
      logger.info('Fetching dashboard stats for cache warming');
      return { totalUsers: 0, activeUsers: 0, revenue: 0 };
    },
    cacheKey: 'analytics:dashboard-stats',
    priority: 7,
    ttlMs: 600000, // 10 minutes
    tags: ['analytics', 'dashboard'],
  },
];

// ============================================================================
// Cache Warming Implementation
// ============================================================================

async function initializeCache(): Promise<MultiTierCache> {
  const cache = getGlobalCache({
    l1MaxSize: 1000,
    l1TtlMs: 60000,
    l2TtlSeconds: 300,
    keyPrefix: 'smartbeak:',
    stampedeProtection: true,
  });

  // Initialize Redis connection
  try {
    await cache.initializeRedis(CACHE_WARMING_CONFIG.redisUrl);
    logger.info('Redis connection established');
  } catch (error) {
    // Sanitize the Redis URL before logging to avoid leaking embedded credentials
    // (e.g. redis://user:password@host:6379).
    const safeUrl = CACHE_WARMING_CONFIG.redisUrl.replace(/:\/\/[^@]+@/, '://<redacted>@');
    logger.warn('Failed to connect to Redis, using memory cache only', {
      redisUrl: safeUrl,
      error: error instanceof Error ? error.message : String(error)
    });
  }

  return cache;
}

function createWarmer(cache: MultiTierCache): CacheWarmer {
  const warmer = new CacheWarmer(cache, {
    intervalMs: CACHE_WARMING_CONFIG.intervalMs,
    maxConcurrent: 5,
    retryAttempts: 3,
    retryDelayMs: 1000,
    warmOnStartup: true,
    warmingWindow: CACHE_WARMING_CONFIG.lowTrafficHours,
  });

  // Register data sources
  hotDataSources.forEach(source => {
    warmer.register({
      id: source.id,
      fetch: source.fetch,
      cacheKey: source.cacheKey,
      priority: source.priority,
      ttlMs: source.ttlMs,
      tags: source.tags,
      enabled: true,
    });
  });

  logger.info('Cache warmer configured', {
    dataSourceCount: hotDataSources.length,
    intervalMs: CACHE_WARMING_CONFIG.intervalMs,
    lowTrafficHours: CACHE_WARMING_CONFIG.lowTrafficHours
  });

  return warmer;
}

// ============================================================================
// Main Execution
// ============================================================================

async function main(): Promise<void> {
  // CLI header output
  if (process.env['CLI_MODE']) {
    console.log('=================================');
    console.log('Cache Warming Service');
    console.log('=================================');
    console.log('');
  }

  logger.info('Starting cache warming service');

  try {
    // Initialize cache
    logger.info('Initializing cache');
    const cache = await initializeCache();

    // Create and start warmer
    logger.info('Setting up cache warmer');
    const warmer = createWarmer(cache);

    // Initial warming
    logger.info('Performing initial cache warming');
    const stats = await warmer.warm();
    
    logger.info('Initial cache warming complete', {
      totalSources: stats.totalSources,
      warmedSuccessfully: stats.warmedSuccessfully,
      failed: stats.failed,
      skipped: stats.skipped,
      averageWarmTimeMs: stats.averageWarmTimeMs
    });

    // CLI output for results
    if (process.env['CLI_MODE']) {
      console.log('');
      console.log('Initial Warming Results:');
      console.log(`  Total Sources: ${stats.totalSources}`);
      console.log(`  Warmed Successfully: ${stats.warmedSuccessfully}`);
      console.log(`  Failed: ${stats.failed}`);
      console.log(`  Skipped: ${stats.skipped}`);
      console.log(`  Average Warm Time: ${stats.averageWarmTimeMs.toFixed(2)}ms`);
      console.log('');
    }

    // Print cache stats
    const cacheStats = cache.getStats();
    logger.info('Cache statistics', {
      l1HitRate: cacheStats.l1HitRate,
      l2HitRate: cacheStats.l2HitRate,
      overallHitRate: cacheStats.overallHitRate,
      totalRequests: cacheStats.totalRequests
    });

    if (process.env['CLI_MODE']) {
      console.log('Cache Statistics:');
      console.log(`  L1 Hit Rate: ${(cacheStats.l1HitRate * 100).toFixed(1)}%`);
      console.log(`  L2 Hit Rate: ${(cacheStats.l2HitRate * 100).toFixed(1)}%`);
      console.log(`  Overall Hit Rate: ${(cacheStats.overallHitRate * 100).toFixed(1)}%`);
      console.log(`  Total Requests: ${cacheStats.totalRequests}`);
      console.log('');
    }

    // Start continuous warming (if not in one-shot mode)
    const oneShot = process.argv.includes('--one-shot');
    
    if (!oneShot) {
      logger.info('Starting continuous cache warming', {
        intervalMs: CACHE_WARMING_CONFIG.intervalMs,
        lowTrafficWindow: `${CACHE_WARMING_CONFIG.lowTrafficHours.start}:00-${CACHE_WARMING_CONFIG.lowTrafficHours.end}:00`
      });

      if (process.env['CLI_MODE']) {
        console.log('[CacheWarm] Starting continuous warming...');
        console.log(`  Interval: ${CACHE_WARMING_CONFIG.intervalMs}ms`);
        console.log(`  Low Traffic Window: ${CACHE_WARMING_CONFIG.lowTrafficHours.start}:00 - ${CACHE_WARMING_CONFIG.lowTrafficHours.end}:00`);
        console.log('');
        console.log('Press Ctrl+C to stop');
        console.log('');
      }

      warmer.start();

      // Handle graceful shutdown
      // Signal handlers must be synchronous; use void IIFE for async work.
      process.on('SIGINT', () => {
        void (async () => {
          try {
            logger.info('Shutting down cache warming service (SIGINT)');
            warmer.stop();
            await cache.close();
            logger.info('Cache warming service stopped');
            if (process.env['CLI_MODE']) {
              console.log('[CacheWarm] Goodbye!');
            }
          } catch (err) {
            logger.error('Error during SIGINT shutdown', err instanceof Error ? err : new Error(String(err)));
          } finally {
            process.exit(0);
          }
        })();
      });

      process.on('SIGTERM', () => {
        void (async () => {
          try {
            logger.info('Shutting down cache warming service (SIGTERM)');
            warmer.stop();
            await cache.close();
            logger.info('Cache warming service stopped');
            if (process.env['CLI_MODE']) {
              console.log('[CacheWarm] Goodbye!');
            }
          } catch (err) {
            logger.error('Error during SIGTERM shutdown', err instanceof Error ? err : new Error(String(err)));
          } finally {
            process.exit(0);
          }
        })();
      });

      // Keep process alive
      await new Promise(() => {});
    } else {
      logger.info('One-shot mode - exiting after initial warm');
      await cache.close();
      process.exit(0);
    }

  } catch (error) {
    logger.error('Cache warming error', error instanceof Error ? error : undefined);
    process.exit(1);
  }
}

// ============================================================================
// CLI Commands
// ============================================================================

function printUsage(): void {
  console.log('Usage: tsx scripts/cache-warming.ts [options]');
  console.log('');
  console.log('Options:');
  console.log('  --one-shot    Perform single warming cycle and exit');
  console.log('  --help        Show this help message');
  console.log('');
  console.log('Environment Variables:');
  console.log('  REDIS_URL              Redis connection URL');
  console.log('  CACHE_WARM_INTERVAL_MS Warming interval in milliseconds (default: 300000)');
  console.log('  LOW_TRAFFIC_START_HOUR Start hour for low traffic window (default: 2)');
  console.log('  LOW_TRAFFIC_END_HOUR   End hour for low traffic window (default: 5)');
}

// Handle CLI arguments
if (process.argv.includes('--help')) {
  printUsage();
  process.exit(0);
}

// Run main
main().catch((err) => {
  logger.error('Main execution error', err instanceof Error ? err : new Error(String(err)));
  process.exit(1);
});
