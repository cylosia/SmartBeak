


import { LRUCache } from 'lru-cache';
import { Pool } from 'pg';

import { getLogger } from '@kernel/logger';
import { DB } from '@kernel/constants';
import { withContext, ValidationError } from '@errors';

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

const SEARCH_CACHE_TTL_MS = 5000;

const CACHE = new LRUCache<string, CacheEntry<SearchResult[]>>({
  max: 5000,
  ttl: SEARCH_CACHE_TTL_MS,
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
    throw new ValidationError('Query must be a non-empty string');
  }

  if (limit < 1 || limit > 100) {
    throw new ValidationError('Limit must be between 1 and 100');
  }

  if (offset < 0) {
    throw new ValidationError('Offset must be non-negative');
  }

  // P2 FIX: Cap OFFSET to prevent deep-page O(n) table scans
  if (offset > DB.MAX_OFFSET) {
    throw new ValidationError(`Offset exceeds maximum safe value (${DB.MAX_OFFSET}). Use cursor-based pagination for large result sets.`);
  }

  // SECURITY FIX P0 #8: Require orgId for tenant isolation
  if (!ctx.orgId) {
    throw new ValidationError('orgId is required for search');
  }

  // P1-FIX: Removed ctx.userId from cache key. Search results are already org-scoped
  // (query filters by org_id), so including userId caused 1000-user orgs to have
  // 1000x more cache entries for identical queries, fragmenting the LRU cache.
  const key = `${ctx.orgId}:${query}:${limit}:${offset}`;
  const cached = CACHE.get(key);
  if (cached) {
    return cached.value;
  }

  let results: SearchResult[];
  try {
    results = await this.searchBatched(query, limit, offset, ctx.orgId);
  } catch (error) {
    logger.error('Search error', error instanceof Error ? error : new Error(String(error)));
    throw withContext(error, {
    operation: 'search',
    resource: 'documents',
    metadata: { query, limit, offset, orgId: ctx.orgId },
    });
  }

  CACHE.set(key, { value: results, expiresAt: Date.now() + SEARCH_CACHE_TTL_MS });
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
    throw new ValidationError('Query must be a non-empty string');
  }

  if (!orgId) {
    throw new ValidationError('orgId is required for search');
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
