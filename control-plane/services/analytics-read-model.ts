


import { Pool } from 'pg';

import { getLogger } from '@kernel/logger';

import { TTLCache } from './cache';

const logger = getLogger('analytics-read-model');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const cache = new TTLCache<AnalyticsContent>({ ttlMs: 60000, maxSize: 5000 });

/**
 * Interface for caches that support clearing
 */
interface ClearableCache<T> {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  clear(): void;
}

/**
 * Type guard to check if cache supports clearing
 */
function isClearableCache<T>(c: unknown): c is ClearableCache<T> {
  return (
    typeof c === 'object' &&
    c !== null &&
    'clear' in c &&
    typeof (c as Record<string, unknown>)["clear"] === 'function'
  );
}

export interface AnalyticsContent {
  content_id: string;
  published_count: number;
  view_count?: number;
  conversion_count?: number;
  revenue?: number;
  last_updated?: Date;
  [key: string]: unknown;
}

export interface ContentStatsResult {
  content_id: string;
  published_count: number;
  view_count: number;
  conversion_count: number;
  revenue: number;
}

export class AnalyticsReadModel {
  constructor(private pool: Pool) {
  if (!pool) {
    throw new Error('Database pool is required');
  }
  }

  /**
  * Gets content statistics with caching.
  *
  * @param contentId - Content ID
  * @returns Content statistics
  * @throws Error if validation fails or database operation fails
  */
  async getContentStats(contentId: string): Promise<ContentStatsResult> {
  // Input validation
  if (!contentId || typeof contentId !== 'string') {
    throw new Error('Valid contentId (string) is required');
  }
  if (!UUID_REGEX.test(contentId)) {
    throw new Error('Invalid contentId format: must be a valid UUID');
  }

  const key = `analytics:${contentId}`;
  const cached = cache.get(key);
  if (cached) {
    return this.normalizeResult(contentId, cached);
  }

  try {
    const { rows } = await this.pool.query<AnalyticsContent>(
    'SELECT * FROM analytics_content WHERE content_id = $1',
    [contentId]
    );

    const result = rows[0] ?? {
    content_id: contentId,
    published_count: 0,
    view_count: 0,
    conversion_count: 0,
    revenue: 0
    };

    cache.set(key, result);
    return this.normalizeResult(contentId, result);
  } catch (error) {
    logger["error"]('Error fetching content stats', error instanceof Error ? error : new Error(String(error)));
    throw new Error(`Failed to fetch content stats: ${error instanceof Error ? error.message : String(error)}`);
  }
  }

  /**
  * Invalidates the cache for a specific content ID.
  *
  * @param contentId - Content ID
  */
  invalidate(contentId: string): void {
  if (!contentId || typeof contentId !== 'string') {
    logger.warn('Invalid contentId provided to invalidate');
    return;
  }
  if (!UUID_REGEX.test(contentId)) {
    logger.warn('Invalid contentId format provided to invalidate');
    return;
  }
  cache.invalidate(`analytics:${contentId}`);
  }

  /**
  * Invalidates all cached analytics data.
  */
  invalidateAll(): void {
  // Check if cache has clear method using proper type guard
  if (isClearableCache(cache)) {
    cache["clear"]();
  }
  }

  /**
  * Gets analytics for multiple content IDs.
  *
  * @param contentIds - Array of content IDs
  * @returns Array of content statistics
  * @throws Error if validation fails or database operation fails
  */
  async getBatchContentStats(contentIds: string[]): Promise<ContentStatsResult[]> {
  if (!Array.isArray(contentIds) || contentIds.length === 0) {
    return [];
  }

  if (!contentIds.every(id => typeof id === 'string')) {
    throw new Error('All contentIds must be strings');
  }

  try {
    const { rows } = await this.pool.query<AnalyticsContent>(
    'SELECT * FROM analytics_content WHERE content_id = ANY($1)',
    [contentIds]
    );

    const resultMap = new Map<string, AnalyticsContent>();
    for (const row of rows) {
    resultMap.set(row.content_id, row);
    }

    return contentIds.map(id => {
    const row = resultMap.get(id);
    return this.normalizeResult(id, row ?? {
    content_id: id,
    published_count: 0,
    view_count: 0,
    conversion_count: 0,
    revenue: 0
    });
    });
  } catch (error) {
    logger["error"]('Error fetching batch content stats', error instanceof Error ? error : new Error(String(error)));
    throw new Error(`Failed to fetch batch content stats: ${error instanceof Error ? error.message : String(error)}`);
  }
  }

  private normalizeResult(contentId: string, data: AnalyticsContent): ContentStatsResult {
  return {
    content_id: contentId,
    published_count: data.published_count ?? 0,
    view_count: data.view_count ?? 0,
    conversion_count: data.conversion_count ?? 0,
    revenue: data.revenue ?? 0
  };
  }

  /**
   * Increments the published count for a content ID.
   *
   * @param contentId - Content ID
   * @throws Error if validation fails or database operation fails
   */
  async incrementPublish(contentId: string): Promise<void> {
  // Input validation
  if (!contentId || typeof contentId !== 'string') {
    throw new Error('Valid contentId (string) is required');
  }
  if (!UUID_REGEX.test(contentId)) {
    throw new Error('Invalid contentId format: must be a valid UUID');
  }

  try {
    await this.pool.query(
    `INSERT INTO analytics_content (content_id, published_count, view_count, conversion_count, revenue, last_updated)
     VALUES ($1, 1, 0, 0, 0, NOW())
     ON CONFLICT (content_id)
     DO UPDATE SET published_count = analytics_content.published_count + 1, last_updated = NOW()`,
    [contentId]
    );
    // Invalidate cache after update
    this.invalidate(contentId);
  } catch (error) {
    logger["error"]("Error incrementing publish count", error instanceof Error ? error : new Error(String(error)));
    throw new Error(`Failed to increment publish count: ${error instanceof Error ? error.message : String(error)}`);
  }
  }
}
