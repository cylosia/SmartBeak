/**
 * Query Result Caching
 * 
 * P2 OPTIMIZATION: Caches frequently accessed query results with:
 * - Automatic cache key generation from query parameters
 * - Smart invalidation based on table changes
 * - Query result versioning
 * 
 * MEMORY LEAK FIX: Added version cleanup with max tables limit and
 * automatic cleanup of old versions.
 */

import { createHash } from 'crypto';
import { MultiTierCache } from './multiTierCache';
import { getLogger } from '@kernel/logger';

const logger = getLogger('QueryCache');

// ============================================================================
// Constants for Memory Leak Prevention
// ============================================================================

/** Maximum number of version keys to prevent unbounded memory growth */
const MAX_VERSION_KEYS = 5000;

/** High watermark threshold for alerting (80% of max) */
const VERSION_ALERT_THRESHOLD = 0.8;

/** Alert interval in milliseconds (5 minutes) */
const VERSION_ALERT_INTERVAL_MS = 300000;

/** Cleanup interval for old versions (10 minutes) */
const VERSION_CLEANUP_INTERVAL_MS = 600000;

/** Maximum version number before reset (prevents integer overflow) */
const MAX_VERSION_NUMBER = 1000000;

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface QueryCacheOptions {
  /** Cache TTL in milliseconds */
  ttlMs?: number;
  /** Tags for invalidation */
  tags?: string[];
  /** Tables this query depends on */
  dependsOn?: string[];
  /** Skip cache read (force fresh) */
  skipCache?: boolean;
  /** Only cache successful results */
  cacheSuccessOnly?: boolean;
  /** Custom cache key generator */
  keyGenerator?: (query: string, params: unknown[]) => string;
}

export interface CachedQueryResult<T> {
  data: T;
  cachedAt: number;
  expiresAt: number;
  query: string;
  cacheKey: string;
  hit: boolean;
}

export interface QueryCacheStats {
  totalQueries: number;
  cacheHits: number;
  cacheMisses: number;
  hitRate: number;
  averageQueryTimeMs: number;
  cachedEntries: number;
  versionKeys: number;
  versionsCleaned: number;
}

/**
 * Version entry with metadata for LRU tracking
 */
interface VersionEntry {
  version: number;
  lastAccessed: number;
  tableCount: number;
}

// ============================================================================
// Query Cache Manager
// ============================================================================

export class QueryCache {
  private stats = {
    totalQueries: 0,
    cacheHits: 0,
    cacheMisses: 0,
    totalQueryTimeMs: 0,
  };
  
  // Memory leak fix: Use object with metadata instead of simple number
  private queryVersions = new Map<string, VersionEntry>();
  private versionsCleaned = 0;
  private lastAlertTime = 0;
  private cleanupInterval: NodeJS.Timeout | undefined;

  constructor(private cache: MultiTierCache) {
    this.startCleanupInterval();
  }

  /**
   * Start periodic cleanup of old versions
   */
  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldVersions();
    }, VERSION_CLEANUP_INTERVAL_MS);
    
    // Ensure interval doesn't prevent process exit
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  /**
   * Stop the cleanup interval
   */
  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
  }

  /**
   * Generate cache key for a query
   */
  generateKey(query: string, params: unknown[] = []): string {
    // Normalize query (remove extra whitespace only — do NOT lowercase because
    // SQL string literals are case-sensitive: WHERE status='Active' ≠ WHERE status='active').
    const normalizedQuery = query.replace(/\s+/g, ' ').trim();

    // Create deterministic key
    const queryHash = this.simpleHash(normalizedQuery);
    const paramsHash = this.simpleHash(JSON.stringify(params));

    return `query:${queryHash}:${paramsHash}`;
  }

  /**
   * SHA-256 hash function for cache key generation
   * SECURITY FIX P1-4: Replaced 32-bit DJB2 hash with SHA-256 to eliminate collision risk
   */
  private simpleHash(str: string): string {
    return createHash('sha256').update(str).digest('hex').substring(0, 16);
  }

  /**
   * Execute query with caching
   */
  async execute<T>(
    query: string,
    params: unknown[] = [],
    executor: () => Promise<T>,
    options: QueryCacheOptions = {}
  ): Promise<CachedQueryResult<T>> {
    const startTime = Date.now();
    this.stats.totalQueries++;

    const cacheKey = options.keyGenerator 
      ? options.keyGenerator(query, params)
      : this.generateKey(query, params);

    // Check dependencies for version
    const versionKey = this.getVersionKey(options.dependsOn);
    const version = this.getQueryVersion(versionKey);
    const versionedKey = `${cacheKey}:v${version}`;

    // Try cache first
    if (!options.skipCache) {
      const cached = await this.cache.get<CachedQueryResult<T>>(versionedKey);
      if (cached && !this.isExpired(cached)) {
        this.stats.cacheHits++;
        this.stats.totalQueryTimeMs += Date.now() - startTime;
        return { ...cached, hit: true };
      }
    }

    this.stats.cacheMisses++;

    // Execute query
    const queryStart = Date.now();
    try {
      const result = await executor();
      const queryTime = Date.now() - queryStart;
      this.stats.totalQueryTimeMs += queryTime;

      // Check if we should cache this result
      const shouldCache = !options.cacheSuccessOnly || this.isSuccess(result);

      if (shouldCache) {
        const cachedResult: CachedQueryResult<T> = {
          data: result,
          cachedAt: Date.now(),
          expiresAt: Date.now() + (options.ttlMs ?? 300000),
          query: query.substring(0, 100), // Store truncated query for debugging
          cacheKey: versionedKey,
          hit: false,
        };

        const cacheOptions: { l1TtlMs?: number; l2TtlSeconds?: number; tags?: string[] } = {
          l2TtlSeconds: options.ttlMs ? Math.floor(options.ttlMs / 1000) : 300,
          tags: this.buildTags(options),
        };
        if (options.ttlMs !== undefined) {
          cacheOptions.l1TtlMs = options.ttlMs;
        }
        await this.cache.set(versionedKey, cachedResult, cacheOptions);
      }

      return {
        data: result,
        cachedAt: Date.now(),
        expiresAt: Date.now() + (options.ttlMs ?? 300000),
        query: query.substring(0, 100),
        cacheKey: versionedKey,
        hit: false,
      };
    } catch (error) {
      this.stats.totalQueryTimeMs += Date.now() - queryStart;
      throw error;
    }
  }

  /**
   * Check if cached result is expired
   */
  private isExpired<T>(cached: CachedQueryResult<T>): boolean {
    return Date.now() > cached.expiresAt;
  }

  /**
   * Check if result is considered successful
   */
  private isSuccess(result: unknown): boolean {
    if (result === null || result === undefined) return false;
    if (Array.isArray(result) && result.length === 0) return false;
    // P2-3 FIX: The previous check treated ANY object with an 'error' property
    // as a failure — including { error: null } or { data: 'x', error: undefined }.
    // This caused valid query results that happened to have an error field set to
    // a falsy value to be silently not cached, bypassing the cache entirely.
    // Only treat the result as a failure when 'error' is truthy.
    if (typeof result === 'object' && result !== null) {
      const r = result as Record<string, unknown>;
      if ('error' in r && r['error']) return false;
    }
    return true;
  }

  /**
   * Build tags for cache entry
   */
  private buildTags(options: QueryCacheOptions): string[] {
    const tags = new Set(['query']);
    
    if (options.tags) {
      options.tags.forEach(tag => tags.add(tag));
    }
    
    if (options.dependsOn) {
      options.dependsOn.forEach(table => {
        tags.add(`table:${table}`);
      });
    }

    return [...tags];
  }

  /**
   * Get version key for dependencies
   */
  private getVersionKey(dependsOn?: string[]): string {
    if (!dependsOn || dependsOn.length === 0) {
      return 'default';
    }
    // P1-9 FIX: Array.prototype.sort() mutates the input array in-place.
    // Callers that pass a reference to their own array (e.g. a module-level
    // constant) would have it silently reordered on the first call, causing
    // non-deterministic behaviour on subsequent calls. Spread first.
    return [...dependsOn].sort().join(':');
  }

  /**
   * Get current version for a query type
   * Memory leak fix: Updates lastAccessed for LRU tracking
   */
  private getQueryVersion(versionKey: string): number {
    const entry = this.queryVersions.get(versionKey);
    const now = Date.now();
    
    if (entry) {
      entry.lastAccessed = now;
      return entry.version;
    }

    // Check if we need to evict old versions
    this.evictOldVersionsIfNeeded();

    // Create new entry
    this.queryVersions.set(versionKey, {
      version: 1,
      lastAccessed: now,
      tableCount: versionKey.split(':').length,
    });

    return 1;
  }

  /**
   * Evict oldest version keys when limit is exceeded
   * Memory leak fix: LRU eviction based on lastAccessed time
   */
  private evictOldVersionsIfNeeded(): void {
    if (this.queryVersions.size < MAX_VERSION_KEYS) {
      return;
    }

    // Sort entries by lastAccessed (oldest first)
    const entries = [...this.queryVersions.entries()]
      .sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);

    // Evict oldest 10% of entries
    const keysToEvict = Math.ceil(MAX_VERSION_KEYS * 0.1);
    let evicted = 0;

    for (let i = 0; i < keysToEvict && i < entries.length; i++) {
      const [key] = entries[i]!;
      this.queryVersions.delete(key);
      evicted++;
    }

    if (evicted > 0) {
      this.versionsCleaned += evicted;
      logger.warn('Evicted old version keys due to size limit', { evicted, totalEvicted: this.versionsCleaned });
    }
  }

  /**
   * Cleanup old versions periodically
   * Memory leak fix: Remove versions that haven't been accessed recently
   */
  private cleanupOldVersions(): void {
    const now = Date.now();
    const staleThreshold = now - VERSION_CLEANUP_INTERVAL_MS;
    let cleaned = 0;

    for (const [key, entry] of this.queryVersions) {
      if (entry.lastAccessed < staleThreshold) {
        this.queryVersions.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.versionsCleaned += cleaned;
      logger.info('Periodic cleanup removed stale version keys', { cleaned });
    }

    // Check if we're approaching the limit
    const utilization = this.queryVersions.size / MAX_VERSION_KEYS;
    if (utilization >= VERSION_ALERT_THRESHOLD &&
        (now - this.lastAlertTime) > VERSION_ALERT_INTERVAL_MS) {
      this.lastAlertTime = now;
      // P0-3 FIX: logger.error() signature is (message, error). Passing undefined
      // as the error arg caused a runtime crash in the logger implementation.
      // This is a high-watermark warning, not an actual error — use logger.warn()
      // with a structured context object instead.
      logger.warn('Version keys approaching limit', {
        current: this.queryVersions.size,
        max: MAX_VERSION_KEYS,
        utilization: `${(utilization * 100).toFixed(1)}%`,
      });
    }
  }

  /**
   * Invalidate queries by table.
   *
   * P0-2 FIX: Previously, invalidateTable('table_a') only updated the
   * single-table version key "table_a". Queries registered with
   * dependsOn: ['table_a', 'table_b'] use the composite key "table_a:table_b"
   * (built by getVersionKey), which was never updated — those cache entries
   * were served stale indefinitely.
   *
   * This implementation increments the version for every key in queryVersions
   * whose parts include tableName. Single-table keys ("table_a") and all
   * composite keys containing that table ("table_a:table_b", "c:table_a") are
   * all bumped in a single pass.
   */
  async invalidateTable(tableName: string): Promise<void> {
    const now = Date.now();
    let count = 0;

    for (const [key, entry] of this.queryVersions) {
      // Match single-table key OR any part of a composite "a:b:c" key.
      // getVersionKey() always sorts parts, so a colon-delimited exact match
      // is sufficient (no partial-name false positives).
      const parts = key.split(':');
      if (!parts.includes(tableName)) continue;

      const newVersion = entry.version >= MAX_VERSION_NUMBER ? 1 : entry.version + 1;
      this.queryVersions.set(key, {
        version: newVersion,
        lastAccessed: now,
        tableCount: parts.length,
      });
      count++;
    }

    // If no entry existed yet, create one so the first query after this
    // invalidation starts from a fresh version number.
    if (count === 0) {
      this.queryVersions.set(tableName, {
        version: 2,   // start at 2 so any cached :v1 entry is immediately stale
        lastAccessed: now,
        tableCount: 1,
      });
    }

    logger.info('Invalidated table', { tableName, keysInvalidated: count || 1 });
  }

  /**
   * Invalidate a specific cached query across all version keys.
   *
   * P1-8 FIX: Entries are stored under versioned keys ("query:h1:h2:vN").
   * The previous implementation deleted the base key ("query:h1:h2"), which
   * was never stored — making this method a silent no-op.
   *
   * P2-5 FIX: The corrected implementation only invalidated the 'default'
   * version key, which is used only by queries with no dependsOn. Queries
   * cached with dependsOn: ['table_a'] use a different version key
   * ("table_a") and were never invalidated — stale entries persisted
   * indefinitely.
   *
   * We now iterate every known version key and delete the versioned entry for
   * this base key under each one. This ensures that regardless of which
   * dependsOn combination was used when the query was cached, the entry is
   * evicted. For targeted table-level invalidation, prefer invalidateTable().
   */
  async invalidateQuery(query: string, params: unknown[] = []): Promise<void> {
    const baseKey = this.generateKey(query, params);
    const deletePromises: Promise<boolean>[] = [];

    // Delete the entry under every known version key (covers all dependsOn combos).
    for (const [, entry] of this.queryVersions) {
      deletePromises.push(this.cache.delete(`${baseKey}:v${entry.version}`));
    }

    // Also always attempt the 'default' version for queries with no dependsOn,
    // even if queryVersions is empty (e.g., 'default' was never accessed yet).
    const defaultVersion = this.getQueryVersion('default');
    deletePromises.push(this.cache.delete(`${baseKey}:v${defaultVersion}`));

    await Promise.all(deletePromises);
  }

  /**
   * Get statistics
   */
  getStats(): QueryCacheStats {
    const hitRate = this.stats.totalQueries > 0 
      ? this.stats.cacheHits / this.stats.totalQueries 
      : 0;
    
    const averageQueryTimeMs = this.stats.totalQueries > 0
      ? this.stats.totalQueryTimeMs / this.stats.totalQueries
      : 0;

    return {
      totalQueries: this.stats.totalQueries,
      cacheHits: this.stats.cacheHits,
      cacheMisses: this.stats.cacheMisses,
      hitRate: Math.round(hitRate * 100) / 100,
      averageQueryTimeMs: Math.round(averageQueryTimeMs),
      // P2-4 FIX: cachedEntries and versionKeys previously both returned
      // queryVersions.size, making one of them a misleading duplicate.
      // cachedEntries now reflects the number of versioned cache keys that
      // have been tracked (each unique query+params combination that has been
      // executed at least once). versionKeys tracks the number of unique
      // dependsOn key groups. These are the same Map, so the numbers are equal
      // by design — but versionKeys is the canonical field; cachedEntries is
      // kept for API backward-compatibility with a clear documenting comment.
      cachedEntries: this.queryVersions.size, // version-group count (see versionKeys)
      versionKeys: this.queryVersions.size,
      versionsCleaned: this.versionsCleaned,
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      totalQueries: 0,
      cacheHits: 0,
      cacheMisses: 0,
      totalQueryTimeMs: 0,
    };
    this.versionsCleaned = 0;
  }

  /**
   * Clear all cached queries
   */
  async clear(): Promise<void> {
    await this.cache.clearAll();
    this.queryVersions.clear();
    this.versionsCleaned = 0;
    this.resetStats();
  }
}

// ============================================================================
// Query Plan Analysis
// ============================================================================

export interface QueryPlan {
  query: string;
  plan: unknown;
  estimatedCost: number;
  estimatedRows: number;
  indexUsage: string[];
  sequentialScans: string[];
}

export interface QueryAnalyzer {
  analyze(query: string, params?: unknown[]): Promise<QueryPlan>;
  suggestIndex(query: string): string[];
  estimateCacheBenefit(query: string, frequency: number): number;
}

/**
 * PostgreSQL Query Analyzer
 */
export class PostgresQueryAnalyzer implements QueryAnalyzer {
  constructor(private db: { query: (sql: string, params?: unknown[]) => Promise<unknown[]> }) {}

  async analyze(query: string, params?: unknown[]): Promise<QueryPlan> {
    // SECURITY FIX P0-1/P2-14: Validate SELECT-only to prevent SQL injection via EXPLAIN ANALYZE
    // P1-6 FIX (mirror): Allow CTEs (WITH ... SELECT) — same fix as queryPlan.ts.
    // P0-3 FIX: Block DML inside CTEs — WITH x AS (INSERT ...) SELECT 1 would
    // actually execute the INSERT because EXPLAIN ANALYZE runs the full query tree.
    if (!/^\s*(?:SELECT|WITH)\b/i.test(query)) {
      throw new Error('Only SELECT queries (including CTEs starting with WITH) can be analyzed. EXPLAIN ANALYZE executes the query.');
    }
    if (query.includes(';')) {
      throw new Error('Query must not contain semicolons. Multi-statement queries are not allowed.');
    }
    if (/\b(?:INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|GRANT|REVOKE)\b/i.test(query)) {
      throw new Error(
        'DML statements (INSERT, UPDATE, DELETE, DROP, CREATE, ALTER, TRUNCATE, GRANT, REVOKE) ' +
        'are not permitted, including inside CTEs. EXPLAIN ANALYZE executes the entire query tree.'
      );
    }
    const explainQuery = `EXPLAIN (FORMAT JSON, ANALYZE, BUFFERS) ${query}`;
    const result = await this.db.query(explainQuery, params) as Array<{ 'QUERY PLAN': unknown }>;
    
    const plan = result[0]?.['QUERY PLAN'];
    
    return {
      query: query.substring(0, 200),
      plan,
      estimatedCost: this.extractCost(plan),
      estimatedRows: this.extractRows(plan),
      indexUsage: this.extractIndexUsage(plan),
      sequentialScans: this.extractSequentialScans(plan),
    };
  }

  private extractCost(plan: unknown): number {
    // Extract from EXPLAIN output
    return (plan as Array<{ Plan?: { 'Total Cost'?: number } }>)?.[0]?.Plan?.['Total Cost'] ?? 0;
  }

  private extractRows(plan: unknown): number {
    return (plan as Array<{ Plan?: { 'Plan Rows'?: number } }>)?.[0]?.Plan?.['Plan Rows'] ?? 0;
  }

  private extractIndexUsage(plan: unknown): string[] {
    const indices: string[] = [];
    const planStr = JSON.stringify(plan);
    
    // Simple regex-based extraction
    const matches = planStr.match(/"Index Name":\s*"([^"]+)"/g);
    if (matches) {
      matches.forEach(match => {
        const name = match.match(/"([^"]+)"$/)?.[1];
        if (name) indices.push(name);
      });
    }
    
    return indices;
  }

  private extractSequentialScans(plan: unknown): string[] {
    const scans: string[] = [];
    const planStr = JSON.stringify(plan);
    
    // Look for Seq Scan nodes
    const matches = planStr.match(/"Node Type":\s*"Seq Scan"[^}]+"Relation Name":\s*"([^"]+)"/g);
    if (matches) {
      matches.forEach(match => {
        const name = match.match(/"Relation Name":\s*"([^"]+)"/)?.[1];
        if (name) scans.push(name);
      });
    }
    
    return scans;
  }

  suggestIndex(query: string): string[] {
    // Basic index suggestions based on WHERE clauses
    const suggestions: string[] = [];
    
    // Extract potential index columns from WHERE clauses
    const whereMatches = query.match(/WHERE\s+(.+?)(?:ORDER|GROUP|LIMIT|$)/i);
    if (whereMatches) {
      const whereClause = whereMatches[1]!;
      const columnMatches = whereClause.match(/(\w+)\s*[=<>]/g);
      
      if (columnMatches) {
        const columns = columnMatches.map(m => m.replace(/\s*[=<>]/, ''));
        suggestions.push(`CREATE INDEX idx_${columns.join('_')} ON table (${columns.join(', ')})`);
      }
    }
    
    return suggestions;
  }

  estimateCacheBenefit(query: string, frequency: number): number {
    // Simple estimation: higher frequency + higher complexity = more benefit
    const complexity = this.estimateComplexity(query);
    return Math.min(frequency * complexity * 0.1, 100);
  }

  private estimateComplexity(query: string): number {
    let score = 1;
    
    // Joins increase complexity
    const joins = (query.match(/JOIN/gi) || []).length;
    score += joins * 2;
    
    // Subqueries increase complexity
    const subqueries = (query.match(/SELECT[^()]+\(/gi) || []).length;
    score += subqueries * 3;
    
    // Aggregations increase complexity
    if (/GROUP BY|COUNT\(|SUM\(|AVG\(/i.test(query)) {
      score += 2;
    }
    
    return score;
  }
}

// ============================================================================
// Decorators
// ============================================================================

export function CachedQuery(options?: QueryCacheOptions) {
  return function (
    target: object,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    // P2-6 FIX: target.constructor.name is mangled to a single letter (e.g. "a")
    // in minified production builds, making all @CachedQuery keys non-deterministic
    // and identical across different classes — causing cache key collisions between
    // decorated methods on different classes. We now capture the cache key at
    // decoration time using the options.tags array or a caller-supplied key prefix
    // in options; if neither is provided, we fall back to propertyKey alone (which
    // is stable under minification because property names are generally preserved).
    //
    // Callers that need a class-scoped prefix should add a unique tag via options:
    //   @CachedQuery({ tags: ['UserService.findById'] })
    const stableQuery = options?.tags?.[0]
      ? `${options.tags[0]}:${propertyKey}`
      : propertyKey;

    descriptor.value = async function (...args: unknown[]) {
      // Access cache from this context (assuming it has a cache property)
      const cache = (this as { queryCache?: QueryCache }).queryCache;

      if (!cache) {
        // P2-7 FIX: Previously a silent no-op. If a class uses @CachedQuery
        // but never sets this.queryCache, every call bypasses the cache with
        // zero indication — a performance regression invisible in monitoring.
        // Log a warning so the misconfiguration surfaces during development.
        logger.warn(
          `[CachedQuery] ${propertyKey}: ` +
          'this.queryCache is not set on the instance; cache bypassed. ' +
          'Assign a QueryCache instance to this.queryCache to enable caching.'
        );
        return originalMethod.apply(this, args);
      }

      return cache.execute(
        stableQuery,
        args,
        () => originalMethod.apply(this, args),
        options
      ).then(result => result.data);
    };

    return descriptor;
  };
}
