/**
 * Cache Warming Strategies
 * 
 * P2 OPTIMIZATION: Pre-loads frequently accessed data into cache
 * during low-traffic periods to prevent cold starts.
 */

import { MultiTierCache } from './multiTierCache';
import { getLogger } from '@kernel/logger';

const logger = getLogger('cache-warming');

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface WarmableDataSource<T = unknown> {
  /** Unique identifier for this data source */
  id: string;
  /** Fetch function to load data */
  fetch: () => Promise<T>;
  /** Cache key generator */
  cacheKey: string;
  /** Priority (higher = warmed first) */
  priority?: number;
  /** TTL in milliseconds */
  ttlMs?: number;
  /** Tags for cache invalidation */
  tags?: string[];
  /** Whether this source is enabled */
  enabled?: boolean;
  /** Condition to check before warming */
  shouldWarm?: () => boolean | Promise<boolean>;
}

export interface CacheWarmingOptions {
  /** Interval between warming cycles (ms) */
  intervalMs?: number;
  /** Maximum concurrent warming operations */
  maxConcurrent?: number;
  /** Retry attempts for failed warming */
  retryAttempts?: number;
  /** Retry delay in ms */
  retryDelayMs?: number;
  /** Whether to warm on startup */
  warmOnStartup?: boolean;
  /** Time window for warming (e.g., low traffic hours) */
  warmingWindow?: {
    startHour: number;
    endHour: number;
  };
}

export interface WarmingStats {
  totalSources: number;
  warmedSuccessfully: number;
  failed: number;
  skipped: number;
  lastWarmedAt: Date | null;
  averageWarmTimeMs: number;
}

// ============================================================================
// Cache Warmer Class
// ============================================================================

export class CacheWarmer {
  private sources = new Map<string, WarmableDataSource>();
  private stats: WarmingStats = {
    totalSources: 0,
    warmedSuccessfully: 0,
    failed: 0,
    skipped: 0,
    lastWarmedAt: null,
    averageWarmTimeMs: 0,
  };
  private intervalId: NodeJS.Timeout | null = null;
  private readonly options: Required<CacheWarmingOptions>;

  constructor(
    private cache: MultiTierCache,
    options: CacheWarmingOptions = {}
  ) {
    this.options = {
      intervalMs: options.intervalMs ?? 5 * 60 * 1000, // 5 minutes
      maxConcurrent: options.maxConcurrent ?? 5,
      retryAttempts: options.retryAttempts ?? 3,
      retryDelayMs: options.retryDelayMs ?? 1000,
      warmOnStartup: options.warmOnStartup ?? false,
      ...(options.warmingWindow !== undefined && { warmingWindow: options.warmingWindow }),
    } as Required<CacheWarmingOptions>;
  }

  /**
   * Register a data source for warming
   */
  register<T>(source: WarmableDataSource<T>): void {
    this.sources.set(source.id, source as WarmableDataSource);
    this.stats.totalSources = this.sources.size;
  }

  /**
   * Unregister a data source
   */
  unregister(id: string): boolean {
    const removed = this.sources.delete(id);
    this.stats.totalSources = this.sources.size;
    return removed;
  }

  /**
   * Check if current time is within warming window
   */
  private isInWarmingWindow(): boolean {
    if (!this.options.warmingWindow) return true;

    const now = new Date();
    const currentHour = now.getHours();
    const { startHour, endHour } = this.options.warmingWindow;

    if (startHour <= endHour) {
      return currentHour >= startHour && currentHour < endHour;
    } else {
      // Window spans midnight
      return currentHour >= startHour || currentHour < endHour;
    }
  }

  /**
   * Warm a single data source
   */
  private async warmSource(source: WarmableDataSource): Promise<boolean> {
    // Check if should warm
    if (source.shouldWarm) {
      const shouldWarm = await Promise.resolve(source.shouldWarm());
      if (!shouldWarm) {
        return false;
      }
    }

    let attempts = 0;
    const maxAttempts = this.options.retryAttempts;

    while (attempts < maxAttempts) {
      try {
        const startTime = Date.now();
        const data = await source.fetch();
        const warmTime = Date.now() - startTime;

        const cacheOptions: { l1TtlMs?: number; l2TtlSeconds?: number; tags?: string[] } = {};
        if (source.ttlMs !== undefined) {
          cacheOptions.l1TtlMs = source.ttlMs;
          cacheOptions.l2TtlSeconds = Math.floor(source.ttlMs / 1000);
        }
        if (source.tags !== undefined) {
          cacheOptions.tags = source.tags;
        }
        await this.cache.set(source.cacheKey, data, cacheOptions);

        // Update average warm time
        const totalWarmed = this.stats.warmedSuccessfully;
        this.stats.averageWarmTimeMs = 
          (this.stats.averageWarmTimeMs * totalWarmed + warmTime) / (totalWarmed + 1);

        return true;
      } catch (error) {
        attempts++;
        if (attempts < maxAttempts) {
          await this.delay(this.options.retryDelayMs * attempts);
        }
      }
    }

    return false;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Execute warming for all registered sources
   */
  async warm(): Promise<WarmingStats> {
    if (!this.isInWarmingWindow()) {
      logger.info('[CacheWarmer] Outside warming window, skipping');
      return this.stats;
    }

    logger.info(`[CacheWarmer] Starting cache warming for ${this.sources.size} sources`);
    const startTime = Date.now();

    const enabledSources = Array.from(this.sources.values())
      .filter(s => s.enabled !== false)
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

    // Reset stats for this run
    this.stats.warmedSuccessfully = 0;
    this.stats.failed = 0;
    this.stats.skipped = 0;

    // Process in batches for concurrency control
    const batchSize = this.options.maxConcurrent;
    for (let i = 0; i < enabledSources.length; i += batchSize) {
      const batch = enabledSources.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(async source => {
          const success = await this.warmSource(source);
          if (success) {
            this.stats.warmedSuccessfully++;
          } else if (source.shouldWarm && !(await Promise.resolve(source.shouldWarm()))) {
            this.stats.skipped++;
          } else {
            this.stats.failed++;
          }
          return { source: source.id, success };
        })
      );

      // Log batch results
      results.forEach(({ source, success }) => {
        logger.info(`[CacheWarmer] ${source}: ${success ? 'warmed' : 'failed'}`);
      });
    }

    this.stats.lastWarmedAt = new Date();
    const duration = Date.now() - startTime;
    
    logger.info(
      `[CacheWarmer] Completed in ${duration}ms: ` +
      `${this.stats.warmedSuccessfully} warmed, ` +
      `${this.stats.failed} failed, ` +
      `${this.stats.skipped} skipped`
    );

    return { ...this.stats };
  }

  /**
   * Start automatic warming at intervals
   */
  start(): void {
    if (this.intervalId) {
      logger.warn('[CacheWarmer] Already running');
      return;
    }

    // Initial warm on startup if enabled
    if (this.options.warmOnStartup) {
      this.warm().catch(err => logger.error('Warm failed', err));
    }

    // Schedule regular warming
    this.intervalId = setInterval(() => {
      this.warm().catch(err => logger.error('Warm failed', err));
    }, this.options.intervalMs).unref();

    logger.info(`[CacheWarmer] Started with ${this.options.intervalMs}ms interval`);
  }

  /**
   * Stop automatic warming
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('[CacheWarmer] Stopped');
    }
  }

  /**
   * Get warming statistics
   */
  getStats(): WarmingStats {
    return { ...this.stats };
  }

  /**
   * Get registered sources
   */
  getSources(): WarmableDataSource[] {
    return Array.from(this.sources.values());
  }
}

// ============================================================================
// Common Predefined Warming Strategies
// ============================================================================

export const warmingStrategies = {
  /**
   * Warm during low traffic hours (2 AM - 5 AM)
   */
  lowTrafficHours: (): CacheWarmingOptions['warmingWindow'] => ({
    startHour: 2,
    endHour: 5,
  }),

  /**
   * Warm every 15 minutes for highly dynamic data
   */
  highFrequency: (): CacheWarmingOptions => ({
    intervalMs: 15 * 60 * 1000,
    maxConcurrent: 10,
  }),

  /**
   * Warm hourly for moderately dynamic data
   */
  hourly: (): CacheWarmingOptions => ({
    intervalMs: 60 * 60 * 1000,
    maxConcurrent: 5,
  }),

  /**
   * Warm daily for static reference data
   */
  daily: (): CacheWarmingOptions => ({
    intervalMs: 24 * 60 * 60 * 1000,
    maxConcurrent: 3,
    warmingWindow: {
      startHour: 3,
      endHour: 4,
    },
  }),
};

// ============================================================================
// Helper Functions
// ============================================================================

export function createHotDataWarmer<T>(
  cache: MultiTierCache,
  sources: WarmableDataSource<T>[],
  options?: CacheWarmingOptions
): CacheWarmer {
  const warmer = new CacheWarmer(cache, options);
  sources.forEach(source => warmer.register(source));
  return warmer;
}
