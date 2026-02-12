/**
 * Database Query Result Caching
 * 
 * P2 OPTIMIZATION: Caches frequently accessed database query results
 * with automatic invalidation and stale-while-revalidate pattern.
 */

import { createHash } from 'crypto';
import { LRUCache } from 'lru-cache';
import type { Pool, QueryResult, QueryResultRow } from 'pg';
import { getLogger } from '@kernel/logger';

const logger = getLogger('query-cache');

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface DbQueryCacheOptions {
  /** Max cache size */
  maxSize?: number;
  /** Default TTL in milliseconds */
  defaultTtlMs?: number;
  /** Stale-while-revalidate threshold */
  staleThresholdMs?: number;
  /** Tables that trigger invalidation */
  trackedTables?: string[];
  /** Enable query logging */
  enableLogging?: boolean;
}

export interface CachedDbResult<T = unknown> {
  rows: T[];
  rowCount: number;
  cachedAt: number;
  expiresAt: number;
  staleAt: number;
  query: string;
  key: string;
}

export interface QueryCacheEntry {
  query: string;
  params: unknown[];
  tables: string[];
  accessCount: number;
  lastAccessed: number;
}

// ============================================================================
// Database Query Cache
// ============================================================================

export class DbQueryCache {
  private cache: LRUCache<string, CachedDbResult<unknown>>;
  private queryStats = new Map<string, QueryCacheEntry>();
  private tableQueries = new Map<string, Set<string>>();
  private inFlightRefreshes = new Set<string>();
  private hitCount = 0;
  private missCount = 0;
  private readonly options: Required<DbQueryCacheOptions>;

  constructor(options: DbQueryCacheOptions = {}) {
    this.options = {
      maxSize: options.maxSize ?? 1000,
      defaultTtlMs: options.defaultTtlMs ?? 60000, // 1 minute
      staleThresholdMs: options.staleThresholdMs ?? 30000, // 30 seconds stale
      trackedTables: options.trackedTables ?? [],
      enableLogging: options.enableLogging ?? false,
    };

    this.cache = new LRUCache({
      max: this.options.maxSize,
      updateAgeOnGet: true,
      dispose: (value, key) => {
        this.queryStats.delete(key);
      },
    });
  }

  /**
   * Generate cache key from query and params
   * SECURITY FIX P1-4: Use SHA-256 instead of 32-bit DJB2 hash to prevent collisions
   */
  private generateKey(query: string, params: unknown[]): string {
    const normalizedQuery = query.replace(/\s+/g, ' ').trim().toLowerCase();
    return `db:${this.hashString(normalizedQuery)}:${this.hashString(JSON.stringify(params))}`;
  }

  /**
   * SHA-256 hash function for cache key generation
   * SECURITY FIX P1-4: Replaced 32-bit DJB2 hash with SHA-256 to eliminate collision risk
   */
  private hashString(str: string): string {
    return createHash('sha256').update(str).digest('hex').substring(0, 16);
  }

  /**
   * Extract table names from query
   */
  private extractTables(query: string): string[] {
    const tables: string[] = [];
    
    // Match FROM clause
    const fromMatch = query.match(/FROM\s+(\w+)/gi);
    if (fromMatch) {
      fromMatch.forEach(m => {
        const table = m.replace(/FROM\s+/i, '');
        if (table) tables.push(table.toLowerCase());
      });
    }
    
    // Match JOIN clauses
    const joinMatch = query.match(/JOIN\s+(\w+)/gi);
    if (joinMatch) {
      joinMatch.forEach(m => {
        const table = m.replace(/JOIN\s+/i, '');
        if (table) tables.push(table.toLowerCase());
      });
    }
    
    return [...new Set(tables)];
  }

  /**
   * Check if result is stale (for stale-while-revalidate)
   */
  private isStale(result: CachedDbResult<unknown>): boolean {
    return Date.now() > result.staleAt;
  }

  /**
   * Check if result is expired
   */
  private isExpired(result: CachedDbResult<unknown>): boolean {
    return Date.now() > result.expiresAt;
  }

  /**
   * Execute query with caching
   * P2 OPTIMIZATION: Stale-while-revalidate pattern
   */
  async query<T extends QueryResultRow = QueryResultRow>(
    pool: Pool,
    queryText: string,
    params?: unknown[],
    options?: {
      ttlMs?: number;
      forceFresh?: boolean;
    }
  ): Promise<QueryResult<T> & { fromCache: boolean; stale: boolean }> {
    const cacheKey = this.generateKey(queryText, params ?? []);
    const ttlMs = options?.ttlMs ?? this.options.defaultTtlMs;

    // Try cache first (unless forcing fresh)
    if (!options?.forceFresh) {
      const cached = this.cache.get(cacheKey) as CachedDbResult<T> | undefined;
      
      if (cached) {
        this.updateStats(cacheKey, queryText, params ?? []);

        if (!this.isExpired(cached)) {
          this.hitCount++;
          
          // If stale, trigger background refresh (with stampede protection)
          if (this.isStale(cached)) {
            // Only trigger refresh if not already in flight
            if (!this.inFlightRefreshes.has(cacheKey)) {
              this.inFlightRefreshes.add(cacheKey);
              // SECURITY FIX P1-5: Add .catch() to prevent unhandled rejection and key leak
              this.backgroundRefresh<T>(pool, queryText, params, ttlMs, cacheKey)
                .catch(() => { /* error handled inside backgroundRefresh */ })
                .finally(() => this.inFlightRefreshes.delete(cacheKey));
            }
          }

          return {
            rows: cached.rows as T[],
            rowCount: cached.rowCount,
            command: 'SELECT',
            oid: 0,
            fields: [],
            fromCache: true,
            stale: this.isStale(cached),
          };
        }
      }
    }

    this.missCount++;

    // Execute query
    const startTime = Date.now();
    const result = await pool.query<T>(queryText, params);
    const queryTime = Date.now() - startTime;

    // Cache the result
    if (this.shouldCache(queryText, result)) {
      const tables = this.extractTables(queryText);
      const now = Date.now();
      
      const cachedResult: CachedDbResult<T> = {
        rows: result.rows,
        rowCount: result.rowCount ?? 0,
        cachedAt: now,
        expiresAt: now + ttlMs,
        staleAt: now + ttlMs - this.options.staleThresholdMs,
        query: queryText.substring(0, 100),
        key: cacheKey,
      };

      this.cache.set(cacheKey, cachedResult as CachedDbResult<unknown>);
      this.trackQuery(cacheKey, queryText, params ?? [], tables);

      if (this.options.enableLogging) {
        logger.info(`[DbQueryCache] Cached query (${queryTime}ms): ${queryText.substring(0, 50)}...`);
      }
    }

    return {
      ...result,
      fromCache: false,
      stale: false,
    };
  }

  /**
   * Determine if query result should be cached
   */
  private shouldCache<T extends QueryResultRow>(query: string, result: QueryResult<T>): boolean {
    // Don't cache non-SELECT queries
    if (!/^\s*SELECT/i.test(query)) return false;

    // Don't cache empty results
    if (!result.rowCount || result.rowCount === 0) return false;

    // PERFORMANCE FIX P2-3: Estimate size from a sample instead of serializing the entire result
    // This avoids temporarily doubling memory for large result sets
    const sampleSize = Math.min(result.rows.length, 10);
    if (sampleSize > 0) {
      const sampleBytes = JSON.stringify(result.rows.slice(0, sampleSize)).length;
      const estimatedSize = (sampleBytes / sampleSize) * result.rows.length;
      if (estimatedSize > 10 * 1024 * 1024) return false;
    }

    return true;
  }

  /**
   * Background refresh for stale-while-revalidate
   */
  private async backgroundRefresh<T extends QueryResultRow>(
    pool: Pool,
    queryText: string,
    params: unknown[] | undefined,
    ttlMs: number,
    cacheKey: string
  ): Promise<void> {
    try {
      const result = await pool.query<T>(queryText, params);
      
      if (this.shouldCache(queryText, result)) {
        const tables = this.extractTables(queryText);
        const now = Date.now();
        
        const cachedResult: CachedDbResult<T> = {
          rows: result.rows,
          rowCount: result.rowCount ?? 0,
          cachedAt: now,
          expiresAt: now + ttlMs,
          staleAt: now + ttlMs - this.options.staleThresholdMs,
          query: queryText.substring(0, 100),
          key: cacheKey,
        };

        this.cache.set(cacheKey, cachedResult as CachedDbResult<unknown>);
        this.trackQuery(cacheKey, queryText, params ?? [], tables);

        if (this.options.enableLogging) {
          logger.info(`[DbQueryCache] Background refresh: ${queryText.substring(0, 50)}...`);
        }
      }
    } catch (error) {
      logger.error('[DbQueryCache] Background refresh failed:', error as Error);
    }
  }

  /**
   * Track query for statistics
   */
  private trackQuery(
    cacheKey: string,
    query: string,
    params: unknown[],
    tables: string[]
  ): void {
    const entry: QueryCacheEntry = {
      query,
      params,
      tables,
      accessCount: 0,
      lastAccessed: Date.now(),
    };

    this.queryStats.set(cacheKey, entry);

    // Track table -> queries mapping
    tables.forEach(table => {
      const queries = this.tableQueries.get(table) ?? new Set();
      queries.add(cacheKey);
      this.tableQueries.set(table, queries);
    });
  }

  /**
   * Update query statistics
   */
  private updateStats(cacheKey: string, query: string, params: unknown[]): void {
    const stats = this.queryStats.get(cacheKey);
    if (stats) {
      stats.accessCount++;
      stats.lastAccessed = Date.now();
    } else {
      const tables = this.extractTables(query);
      this.trackQuery(cacheKey, query, params, tables);
    }
  }

  /**
   * Invalidate cache entries by table
   */
  invalidateTable(tableName: string): void {
    const queries = this.tableQueries.get(tableName.toLowerCase());
    if (queries) {
      queries.forEach(cacheKey => {
        this.cache.delete(cacheKey);
        this.queryStats.delete(cacheKey);
      });
      this.tableQueries.delete(tableName.toLowerCase());
      
      if (this.options.enableLogging) {
        logger.info(`[DbQueryCache] Invalidated ${queries.size} queries for table: ${tableName}`);
      }
    }
  }

  /**
   * Invalidate all cache
   */
  invalidateAll(): void {
    this.cache.clear();
    this.queryStats.clear();
    this.tableQueries.clear();
    
    if (this.options.enableLogging) {
      logger.info('[DbQueryCache] Invalidated all queries');
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    hitRate: number;
    hits: number;
    misses: number;
    size: number;
    trackedTables: number;
  } {
    const total = this.hitCount + this.missCount;
    return {
      hitRate: total > 0 ? this.hitCount / total : 0,
      hits: this.hitCount,
      misses: this.missCount,
      size: this.cache.size,
      trackedTables: this.tableQueries.size,
    };
  }

  /**
   * Get frequently accessed queries
   */
  getHotQueries(limit = 10): Array<{ query: string; accessCount: number }> {
    return [...this.queryStats.entries()]
      .sort((a, b) => b[1].accessCount - a[1].accessCount)
      .slice(0, limit)
      .map(([_, stats]) => ({
        query: stats.query.substring(0, 100),
        accessCount: stats.accessCount,
      }));
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let globalDbCache: DbQueryCache | null = null;

export function getGlobalDbCache(options?: DbQueryCacheOptions): DbQueryCache {
  if (!globalDbCache) {
    globalDbCache = new DbQueryCache(options);
  }
  return globalDbCache;
}
