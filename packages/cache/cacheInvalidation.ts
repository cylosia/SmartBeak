/**
 * Cache Invalidation Strategies
 * 
 * P2 OPTIMIZATION: Provides various cache invalidation strategies:
 * - Tag-based invalidation
 * - Pattern-based invalidation
 * - Time-based invalidation (TTL)
 * - Event-driven invalidation
 */

import { MultiTierCache } from './multiTierCache';
import { getLogger } from '@kernel/logger';

const logger = getLogger('cache-invalidation');

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface InvalidationRule {
  /** Rule identifier */
  id: string;
  /** Tags to match for invalidation */
  tags?: string[];
  /** Key patterns to match (supports wildcards) */
  keyPatterns?: string[];
  /** Condition for invalidation */
  condition?: (key: string, value: unknown) => boolean;
  /** Priority (higher = executed first) */
  priority?: number;
}

export interface InvalidationEvent {
  /** Event type */
  type: string;
  /** Entity type affected */
  entityType: string;
  /** Entity ID (if applicable) */
  entityId?: string;
  /** Related tags to invalidate */
  relatedTags?: string[];
  /** Timestamp */
  timestamp: number;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

export interface InvalidationStrategy {
  /** Strategy name */
  name: string;
  /** Handler function */
  handle(event: InvalidationEvent, cache: MultiTierCache): Promise<void>;
}

export interface CacheInvalidatorOptions {
  /** Default TTL for cached entries */
  defaultTtlMs?: number;
  /** Enable automatic invalidation on events */
  autoInvalidate?: boolean;
  /** Maximum number of rules */
  maxRules?: number;
  /** Maximum event queue size (default: 10000) */
  maxQueueSize?: number;
  /** Queue drop policy when full: 'oldest' | 'newest' (default: 'oldest') */
  queueDropPolicy?: 'oldest' | 'newest';
}

// ============================================================================
// Cache Invalidator Class
// ============================================================================

export class CacheInvalidator {
  private rules: Map<string, InvalidationRule> = new Map();
  private strategies: Map<string, InvalidationStrategy> = new Map();
  private eventQueue: InvalidationEvent[] = [];
  private processingQueue = false;
  private droppedEventCount = 0;
  private readonly options: Required<CacheInvalidatorOptions>;

  constructor(
    private cache: MultiTierCache,
    options: CacheInvalidatorOptions = {}
  ) {
    this.options = {
      defaultTtlMs: options.defaultTtlMs ?? 5 * 60 * 1000, // 5 minutes
      autoInvalidate: options.autoInvalidate ?? true,
      maxRules: options.maxRules ?? 100,
      maxQueueSize: options.maxQueueSize ?? 10000, // P1-FIX: Bounded queue
      queueDropPolicy: options.queueDropPolicy ?? 'oldest',
    };

    // Register default strategies
    this.registerDefaultStrategies();
  }

  private registerDefaultStrategies(): void {
    // Tag-based invalidation strategy
    this.registerStrategy({
      name: 'tag-based',
      handle: async (event, _cache) => {
        if (event.relatedTags && event.relatedTags.length > 0) {
          await this.invalidateByTags(event.relatedTags);
        }
      },
    });

    // Entity-based invalidation strategy
    this.registerStrategy({
      name: 'entity-based',
      handle: async (event, cache) => {
        if (event.entityType && event.entityId) {
          await cache.delete(`${event.entityType}:${event.entityId}`);
        }
      },
    });
  }

  /**
   * Register an invalidation rule
   */
  registerRule(rule: InvalidationRule): void {
    if (this.rules.size >= this.options.maxRules) {
      throw new Error(`Maximum number of rules (${this.options.maxRules}) exceeded`);
    }
    this.rules.set(rule.id, rule);
  }

  /**
   * Unregister an invalidation rule
   */
  unregisterRule(ruleId: string): boolean {
    return this.rules.delete(ruleId);
  }

  /**
   * Register an invalidation strategy
   */
  registerStrategy(strategy: InvalidationStrategy): void {
    this.strategies.set(strategy.name, strategy);
  }

  /**
   * Invalidate by tags
   */
  async invalidateByTags(tags: string[]): Promise<number> {
    let invalidatedCount = 0;

    // Get all keys from rules that match these tags
    for (const rule of this.rules.values()) {
      if (rule.tags && rule.tags.some(tag => tags.includes(tag))) {
        // Find and delete matching keys
        if (rule.keyPatterns) {
          for (const pattern of rule.keyPatterns) {
            // P1-FIX: Use the returned count of actually-deleted keys instead of
            // always incrementing by 1 regardless of how many keys matched.
            const deleted = await this.invalidateByPattern(pattern);
            invalidatedCount += deleted;
          }
        }
      }
    }

    // P2-FIX: Remove duplicate log — the second line was identical information
    // redundantly logged in a different format.
    logger.info('Invalidated entries by tags', { invalidatedCount, tags });
    return invalidatedCount;
  }

  /**
   * Invalidate by key pattern (glob-style wildcards: * and ?).
   *
   * SECURITY: Escape all regex metacharacters in the literal portions of the
   * pattern BEFORE expanding glob wildcards.  Without escaping, a pattern like
   * `user.(123)*` would be compiled as-is into a regex, causing unexpected
   * matches and potential ReDoS with catastrophic backtracking.
   *
   * @returns Number of keys actually deleted.
   */
  async invalidateByPattern(pattern: string): Promise<number> {
    // Step 1: split on glob wildcards to isolate literal segments
    // Step 2: escape regex metacharacters in each literal segment
    // Step 3: reassemble with .* (for *) or . (for ?)
    const escaped = pattern
      .split(/(\*|\?)/)
      .map((segment, i) => {
        // Odd-indexed segments are the captured wildcard tokens themselves
        if (i % 2 === 1) {
          return segment === '*' ? '.*' : '.';
        }
        // Even-indexed segments are literal text — escape metacharacters
        return segment.replace(/[.+^${}()|[\]\\]/g, '\\$&');
      })
      .join('');
    const regex = new RegExp('^' + escaped + '$');

    const keys = this.cache.getL1Keys();
    const toDelete: string[] = [];
    for (const key of keys) {
      if (regex.test(key)) {
        toDelete.push(key);
      }
    }

    if (toDelete.length > 0) {
      await this.cache.deleteMany(toDelete);
    }

    logger.info(`[CacheInvalidator] Invalidated ${toDelete.length} entries matching pattern: ${pattern}`);
    return toDelete.length;
  }

  /**
   * Invalidate specific key
   */
  async invalidate(key: string): Promise<void> {
    await this.cache.delete(key);
    logger.info(`[CacheInvalidator] Invalidated key: ${key}`);
  }

  /**
   * Invalidate multiple keys
   */
  async invalidateMany(keys: string[]): Promise<void> {
    await this.cache.deleteMany(keys);
    logger.info(`[CacheInvalidator] Invalidated ${keys.length} keys`);
  }

  /**
   * Process an invalidation event
   * P1-FIX: Enforces max queue size with drop policy
   */
  async processEvent(event: InvalidationEvent): Promise<void> {
    if (!this.options.autoInvalidate) {
      // P1-FIX: Enforce max queue size to prevent unbounded memory growth
      if (this.eventQueue.length >= this.options.maxQueueSize) {
        if (this.options.queueDropPolicy === 'oldest') {
          this.eventQueue.shift(); // Remove oldest
          logger.warn('[CacheInvalidator] Dropped oldest event due to queue limit', {
            queueSize: this.eventQueue.length,
            maxSize: this.options.maxQueueSize,
          });
        } else {
          // Drop newest - don't add the event
          this.droppedEventCount++;
          logger.warn('[CacheInvalidator] Dropped new event due to queue limit', {
            droppedCount: this.droppedEventCount,
            maxSize: this.options.maxQueueSize,
          });
          return;
        }
        this.droppedEventCount++;
      }
      this.eventQueue.push(event);
      return;
    }

    await this.handleEvent(event);
  }

  private async handleEvent(event: InvalidationEvent): Promise<void> {
    logger.info(`[CacheInvalidator] Processing event: ${event.type} for ${event.entityType}`);

    // Apply matching strategies
    for (const strategy of this.strategies.values()) {
      try {
        await strategy.handle(event, this.cache);
      } catch (error) {
        logger.error(`[CacheInvalidator] Strategy ${strategy.name} failed:`, error as Error);
      }
    }

    // Apply matching rules
    const sortedRules = [...this.rules.values()]
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

    for (const rule of sortedRules) {
      const matchesTags = !rule.tags || rule.tags.some(tag => event.relatedTags?.includes(tag));
      const matchesEntity = !rule.condition || rule.condition(event.entityType, event.entityId);

      if (matchesTags && matchesEntity) {
        if (rule.keyPatterns) {
          for (const pattern of rule.keyPatterns) {
            await this.invalidateByPattern(pattern);
          }
        }
      }
    }
  }

  /**
   * Process queued events
   */
  async processQueue(): Promise<void> {
    if (this.processingQueue) return;
    
    this.processingQueue = true;
    try {
      while (this.eventQueue.length > 0) {
        const event = this.eventQueue.shift();
        if (event) {
          await this.handleEvent(event);
        }
      }
    } finally {
      this.processingQueue = false;
    }
  }

  /**
   * Clear all caches and rules
   */
  async clearAll(): Promise<void> {
    await this.cache.clearAll();
    this.rules.clear();
    this.eventQueue = [];
    logger.info('[CacheInvalidator] Cleared all caches and rules');
  }

  /**
   * Get registered rules
   */
  getRules(): InvalidationRule[] {
    return [...this.rules.values()];
  }

  /**
   * Get event queue length
   */
  getQueueLength(): number {
    return this.eventQueue.length;
  }

  /**
   * Get dropped event count (P1-FIX: monitoring)
   */
  getDroppedEventCount(): number {
    return this.droppedEventCount;
  }

  /**
   * Get queue stats (P1-FIX: monitoring)
   */
  getQueueStats(): { length: number; dropped: number; maxSize: number } {
    return {
      length: this.eventQueue.length,
      dropped: this.droppedEventCount,
      maxSize: this.options.maxQueueSize,
    };
  }
}

// ============================================================================
// Predefined Invalidation Patterns
// ============================================================================

export const invalidationPatterns = {
  /**
   * Invalidate all user-related caches
   */
  userRelated: (userId: string): string[] => [
    `user:${userId}`,
    `user:${userId}:*`,
  ],

  /**
   * Invalidate all domain-related caches
   */
  domainRelated: (domainId: string): string[] => [
    `domain:${domainId}`,
    `domain:${domainId}:*`,
    `*domain*${domainId}*`,
  ],

  /**
   * Invalidate query caches for a table
   */
  tableQueries: (tableName: string): string[] => [
    `query:*${tableName}*`,
    `svc:*${tableName}*`,
  ],

  /**
   * Invalidate all content caches
   */
  contentRelated: (contentId: string): string[] => [
    `content:${contentId}`,
    `content:${contentId}:*`,
  ],
};

// ============================================================================
// Helper Functions
// ============================================================================

export function createEntityInvalidationEvent(
  entityType: string,
  entityId: string,
  action: 'create' | 'update' | 'delete',
  relatedTags?: string[]
): InvalidationEvent {
  return {
    type: `entity:${action}`,
    entityType,
    entityId,
    relatedTags: [
      entityType,
      `${entityType}:${action}`,
      ...(relatedTags || []),
    ],
    timestamp: Date.now(),
  };
}

export function createQueryInvalidationEvent(
  queryName: string,
  params?: Record<string, unknown>
): InvalidationEvent {
  return {
    type: 'query:invalidate',
    entityType: 'query',
    relatedTags: [
      'query',
      `query:${queryName}`,
    ],
    timestamp: Date.now(),
    metadata: { queryName, params },
  };
}
