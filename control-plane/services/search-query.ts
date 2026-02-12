


import { LRUCache } from 'lru-cache';
import { Pool } from 'pg';

import { getLogger } from '@kernel/logger';

import { PostgresSearchDocumentRepository } from '../../domains/search/infra/persistence/PostgresSearchDocumentRepository';

const logger = getLogger('search-query');

export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export interface SearchResult {
  id: string;
  title: string;
  content: string;
  score: number;
}

const CACHE = new LRUCache<string, CacheEntry<SearchResult[]>>({
  max: 5000,
  ttl: 5000,
});

/**
* Search query service
*/
export class SearchQueryService {
  private repo: PostgresSearchDocumentRepository;
  private pool: Pool;

  constructor(pool: Pool) {
  this.pool = pool;
  this.repo = new PostgresSearchDocumentRepository(pool);
  }

  /**
  * Search with caching
  * SECURITY FIX P0 #8: orgId is now required to prevent cross-tenant data leak
  */
  async search(query: string, limit = 20, offset = 0, ctx: { orgId: string; userId: string }): Promise<SearchResult[]> {
  // Validate inputs
  if (!query || typeof query !== 'string') {
    throw new Error('Query must be a non-empty string');
  }

  if (limit < 1 || limit > 100) {
    throw new Error('Limit must be between 1 and 100');
  }

  if (offset < 0) {
    throw new Error('Offset must be non-negative');
  }

  // SECURITY FIX P0 #8: Require orgId for tenant isolation
  if (!ctx.orgId) {
    throw new Error('orgId is required for search');
  }

  const key = `${ctx.orgId}:${ctx.userId}:${query}:${limit}:${offset}`;
  const cached = CACHE.get(key);
  if (cached) {
    return cached.value;
  }

  let results: SearchResult[];
  try {
    results = await this.searchBatched(query, limit, offset, ctx.orgId);
  } catch (error) {
    logger.error('Search error', error instanceof Error ? error : new Error(String(error)));
    throw new Error('Search operation failed');
  }

  CACHE.set(key, { value: results, expiresAt: Date.now() + 5000 });
  return results;
  }

  /**
  * Combines document search with content fetching in a single query
  * SECURITY FIX P0 #8: orgId is now required — no unscoped queries allowed
  */
  private async searchBatched(query: string, limit: number, offset: number, orgId: string): Promise<SearchResult[]> {
  // Use full-text search with tsvector (or similar) in a single query
  const { rows } = await this.pool.query<SearchResult>(
    `SELECT
    sd.id,
    sd.title,
    LEFT(sd.content, 500) as content,
    ts_rank(sd.search_vector, plainto_tsquery('english', $1)) as score
    FROM search_documents sd
    WHERE sd.org_id = $4
    AND sd.search_vector @@ plainto_tsquery('english', $1)
    ORDER BY score DESC
    LIMIT $2 OFFSET $3`,
    [query, limit, offset, orgId]
  );

  return rows;
  }

  /**
  * Get total count for pagination
  * SECURITY FIX P0 #8: orgId is now required
  */
  async searchCount(query: string, orgId: string): Promise<number> {
  if (!query || typeof query !== 'string') {
    throw new Error('Query must be a non-empty string');
  }

  if (!orgId) {
    throw new Error('orgId is required for search');
  }

  const { rows } = await this.pool.query<{ count: string }>(
    `SELECT COUNT(*) as count
    FROM search_documents sd
    WHERE sd.org_id = $2
    AND sd.search_vector @@ plainto_tsquery('english', $1)`,
    [query, orgId]
  );

  return parseInt(rows[0]?.count || '0', 10);
  }

  /**
  * Clear search cache
  */
  clearCache(): void {
  CACHE.clear();
  }

  /**
  * Get cache stats
  */
  getCacheStats(): { size: number; max: number } {
  return {
    size: CACHE.size,
    max: CACHE.max,
  };
  }
}
