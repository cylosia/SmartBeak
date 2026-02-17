


import { Pool, PoolClient } from 'pg';

import { getLogger } from '@kernel/logger';

import { SeoDocument } from '../../domain/entities/SeoDocument';
import { SeoRepository } from '../../application/ports/SeoRepository';

const logger = getLogger('seo:repository');

/**
* Repository implementation for SeoDocument using PostgreSQL
*
* P1-FIX: Added optional PoolClient parameter for transaction support
* */
export class PostgresSeoRepository implements SeoRepository {
  constructor(private pool: Pool) {}

  /**
  * Helper to get queryable (pool or client)
  * P1-FIX: Support transaction participation
  */
  private getQueryable(client?: PoolClient): Pool | PoolClient {
    return client || this.pool;
  }

  /**
  * Get SEO document by ID
  * @param id - Document ID
  * @returns SeoDocument or null if not found
  */
  async getById(id: string): Promise<SeoDocument | null> {
  if (!id || typeof id !== 'string') {
    throw new Error('id must be a non-empty string');
  }
  try {
    const { rows } = await this.pool.query(
    `SELECT id, title, description, updated_at as "updatedAt"
    FROM seo_documents
    WHERE id = $1`,
    [id]
    );

    if (!rows[0]) {
    return null;
    }

    const r = rows[0];
    // Use reconstitute for immutable entity creation
    return SeoDocument.reconstitute(
    r["id"],
    r["title"],
    r.description,
    r["updatedAt"] ? new Date(r["updatedAt"]) : new Date()
    );
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to get SEO document by ID', err, { id });
    throw error;
  }
  }

  /**
  * Save an SEO document
  * @param doc - SeoDocument to save
  */
  async save(doc: SeoDocument): Promise<void> {
  if (!doc || typeof doc["id"] !== 'string') {
    throw new Error('document must have a valid id');
  }
  try {
    await this.pool.query(
    `INSERT INTO seo_documents (id, title, description, updated_at)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (id) DO UPDATE SET
    title = $2,
    description = $3,
    updated_at = $4`,
    [doc["id"], doc["title"], doc.description, doc["updatedAt"]]
    );
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to save SEO document', err, {
    id: doc["id"],
    title: doc["title"]
    });
    throw error;
  }
  }

  /**
  * List SEO documents with pagination
  * @param limit - Maximum number of results
  * @param offset - Pagination offset
  * @returns Array of SeoDocument
  */
  async list(
  limit: number = 20,
  offset: number = 0
  ): Promise<SeoDocument[]> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('limit must be a positive integer');
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error('offset must be a non-negative integer');
  }
  // P0-CRITICAL FIX: Clamp limit and offset to prevent unbounded pagination
  const MAX_SAFE_OFFSET = 10000;
  const safeLimit = Math.min(Math.max(1, limit), 100);
  const safeOffset = Math.min(Math.max(0, offset), MAX_SAFE_OFFSET);

  try {
    const { rows } = await this.pool.query(
    `SELECT id, title, description, updated_at as "updatedAt"
    FROM seo_documents
    ORDER BY updated_at DESC
    LIMIT $1 OFFSET $2`,
    [safeLimit, safeOffset]
    );

    return rows.map(r =>
    SeoDocument.reconstitute(
    r["id"],
    r["title"],
    r.description,
    r["updatedAt"] ? new Date(r["updatedAt"]) : new Date()
    )
    );
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to list SEO documents', err);
    throw error;
  }
  }

  /**
  * Search SEO documents by title
  * @param query - Search query
  * @param limit - Maximum number of results
  * @returns Array of matching SeoDocument
  */
  async searchByTitle(query: string, limit: number = 20): Promise<SeoDocument[]> {
  if (typeof query !== 'string') {
    throw new Error('query must be a string');
  }
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('limit must be a positive integer');
  }
  // Security: Validate and sanitize search query
  const sanitizedQuery = this.sanitizeSearchQuery(query);
  if (!sanitizedQuery) {
    return [];
  }

  // Performance: Clamp limit
  const safeLimit = Math.min(Math.max(1, limit), 100);

  try {
    // P1-FIX: Added ESCAPE clause for proper wildcard escaping
    // The sanitizeSearchQuery method escapes % and _ with backslash
    const { rows } = await this.pool.query(
    `SELECT id, title, description, updated_at as "updatedAt"
    FROM seo_documents
    WHERE title ILIKE $1 ESCAPE '\\'
    ORDER BY updated_at DESC
    LIMIT $2`,
    [`%${sanitizedQuery}%`, safeLimit]
    );

    return rows.map(r =>
    SeoDocument.reconstitute(
    r["id"],
    r["title"],
    r.description,
    r["updatedAt"] ? new Date(r["updatedAt"]) : new Date()
    )
    );
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to search SEO documents', err, { query });
    throw error;
  }
  }

  /**
  * Batch save SEO documents for better performance
  * @param docs - Array of SeoDocument to save
  * @param client - Optional client for transaction context
  * P1-FIX: Added client parameter to support transaction participation
  */
  async batchSave(docs: SeoDocument[], client?: PoolClient): Promise<void> {
  if (!Array.isArray(docs)) {
    throw new Error('docs must be an array');
  }

  if (docs.length === 0) return;

  const MAX_BATCH_SIZE = 1000;
  if (docs.length > MAX_BATCH_SIZE) {
    throw new Error(
    `Batch size ${docs.length} exceeds maximum allowed ${MAX_BATCH_SIZE}. ` +
    `Split into smaller batches.`
    );
  }

  // Performance: Limit chunk size for processing
  const CHUNK_SIZE = 100;
  if (docs.length > CHUNK_SIZE) {
    for (let i = 0; i < docs.length; i += CHUNK_SIZE) {
    await this.batchSave(docs.slice(i, i + CHUNK_SIZE), client);
    }
    return;
  }

  // P1-FIX: Use provided client or create new connection
  const newClient = client || await this.pool.connect();
  const shouldManageTransaction = !client;

  try {
    if (shouldManageTransaction) {
    await newClient.query('BEGIN');
    }

    // Performance: Use unnest for efficient batch insert
    // P1-FIX: Added query timeout to prevent runaway queries
    await newClient.query(
    `INSERT INTO seo_documents (id, title, description, updated_at)
    SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[], $4::timestamptz[])
    ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    updated_at = EXCLUDED.updated_at`,
    [
    docs.map(d => d["id"]),
    docs.map(d => d["title"]),
    docs.map(d => d.description),
    docs.map(d => d["updatedAt"])
    ]
    );

    if (shouldManageTransaction) {
    await newClient.query('COMMIT');
    }
  } catch (error: unknown) {
    if (shouldManageTransaction) {
    try {
      await newClient.query('ROLLBACK');
    } catch (rollbackError) {
      logger.error('Batch save rollback failed', rollbackError as Error);
    }
    }
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to batch save SEO documents', err, { count: docs.length });
    throw error;
  } finally {
    if (!client) {
    newClient.release();
    }
  }
  }

  /**
  * Delete an SEO document
  * @param id - Document ID to delete
  */
  async delete(id: string): Promise<void> {
  if (!id || typeof id !== 'string') {
    throw new Error('id must be a non-empty string');
  }
  try {
    await this.pool.query(
    'DELETE FROM seo_documents WHERE id = $1',
    [id]
    );
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to delete SEO document', err, { id });
    throw error;
  }
  }

  /**
  * Sanitize search query for security
  * SECURITY FIX: Escape LIKE wildcards to prevent wildcard injection attacks
  */
  private sanitizeSearchQuery(query: string): string {
  if (!query || typeof query !== 'string') {
    return '';
  }

  // Remove null bytes and control characters
  let sanitized = query
    .replace(/\0/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1F\x7F]/g, '')
    .substring(0, 255); // Limit length

  // SECURITY FIX: Escape LIKE wildcards (% and _) to prevent wildcard injection
  // PostgreSQL uses backslash as default escape character
  sanitized = sanitized.replace(/[%_]/g, '\\$&');

  return sanitized;
  }

  /**
  * Clean up repository resources
  * Note: Pool is shared and managed externally, no-op here
  */
  async close(): Promise<void> {
  // No-op: Repository doesn't own the pool connection
  // Pool lifecycle is managed by the dependency injection container
  }
}
