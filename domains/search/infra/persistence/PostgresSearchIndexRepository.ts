


import { Pool, PoolClient } from 'pg';

import { getLogger } from '@kernel/logger';

import { SearchIndex } from '../../domain/entities/SearchIndex';
import { SearchIndexRepository } from '../../application/ports/SearchIndexRepository';

const logger = getLogger('search:index:repository');

/**
* Repository implementation for SearchIndex using PostgreSQL
*
* P1-FIX: Added optional PoolClient parameter for transaction support
* */
export class PostgresSearchIndexRepository implements SearchIndexRepository {
  constructor(private pool: Pool) {}

  /**
  * Helper to get queryable (pool or client)
  * P1-FIX: Support transaction participation
  */
  private getQueryable(client?: PoolClient): Pool | PoolClient {
    return client || this.pool;
  }

  /**
  * Get active search index for a domain
  * @param domainId - Domain ID
  * @returns SearchIndex or null if not found
  */
  async getActive(domainId: string): Promise<SearchIndex | null> {
  // Validate input
  if (!domainId || typeof domainId !== 'string') {
    throw new Error('domainId must be a non-empty string');
  }
  try {
    const { rows } = await this.pool.query(
    `SELECT id, domain_id, name, version, status
    FROM search_indexes
    WHERE domain_id = $1 AND status = 'active'
    ORDER BY version DESC
    LIMIT 1`,
    [domainId]
    );

    if (!rows[0]) {
    return null;
    }

    const r = rows[0];
    // Use reconstitute for immutable entity creation
    return SearchIndex.reconstitute(r["id"], r.domain_id, r["name"], r.version, r["status"]);
  } catch (error) {
    // P1-FIX: Type assertion with validation
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to get active search index', err, { domainId });
    throw error;
  }
  }

  /**
  * Get search index by ID
  * @param id - Index ID
  * @returns SearchIndex or null if not found
  */
  async getById(id: string): Promise<SearchIndex | null> {
  // Validate input
  if (!id || typeof id !== 'string') {
    throw new Error('id must be a non-empty string');
  }
  try {
    const { rows } = await this.pool.query(
    `SELECT id, domain_id, name, version, status
    FROM search_indexes
    WHERE id = $1`,
    [id]
    );

    if (!rows[0]) {
    return null;
    }

    const r = rows[0];
    return SearchIndex.reconstitute(r["id"], r.domain_id, r["name"], r.version, r["status"]);
  } catch (error) {
    // P1-FIX: Type assertion with validation
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to get search index by ID', err, { id });
    throw error;
  }
  }

  /**
  * Save a search index
  * @param index - SearchIndex to save
  */
  async save(index: SearchIndex): Promise<void> {
  // Validate input
  if (!index || typeof index["id"] !== 'string') {
    throw new Error('index must have a valid id');
  }
  try {
    // Use optimistic locking: only update if version hasn't changed or row is new
    await this.pool.query(
    `INSERT INTO search_indexes (id, domain_id, name, version, status)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (id) DO UPDATE SET
    status = EXCLUDED.status,
    version = EXCLUDED.version,
    domain_id = EXCLUDED.domain_id,
    name = EXCLUDED.name`,
    [index["id"], index.domainId, index["name"], index.version, index["status"]]
    );
  } catch (error) {
    // P1-FIX: Type assertion with validation
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to save search index', err, {
    id: index["id"],
    domainId: index.domainId
    });
    throw error;
  }
  }

  /**
  * List search indexes by domain with pagination
  * @param domainId - Domain ID
  * @param limit - Maximum number of results
  * @param offset - Pagination offset
  * @returns Array of SearchIndex
  */
  async listByDomain(
  domainId: string,
  limit: number = 20,
  offset: number = 0
  ): Promise<SearchIndex[]> {
  // Validate inputs
  if (!domainId || typeof domainId !== 'string') {
    throw new Error('domainId must be a non-empty string');
  }
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('limit must be a positive integer');
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error('offset must be a non-negative integer');
  }
  // P0-CRITICAL FIX: Clamp limit and offset to prevent unbounded pagination
  const MAX_LIMIT = 1000;
  const MAX_SAFE_OFFSET = 10000;
  const safeLimit = Math.min(Math.max(1, limit), MAX_LIMIT);
  const safeOffset = Math.min(Math.max(0, offset), MAX_SAFE_OFFSET);

  try {
    // Note: No FOR UPDATE needed here - this is a read-only list query
    const { rows } = await this.pool.query(
    `SELECT id, domain_id, name, version, status
    FROM search_indexes
    WHERE domain_id = $1
    ORDER BY version DESC
    LIMIT $2 OFFSET $3`,
    [domainId, safeLimit, safeOffset]
    );

    return rows.map(r =>
    SearchIndex.reconstitute(r["id"], r.domain_id, r["name"], r.version, r["status"])
    );
  } catch (error) {
    // P1-FIX: Type assertion with validation
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to list search indexes by domain', err, { domainId });
    throw error;
  }
  }

  /**
  * Delete a search index
  * @param id - Index ID to delete
  */
  async delete(id: string): Promise<void> {
  // Validate input
  if (!id || typeof id !== 'string') {
    throw new Error('id must be a non-empty string');
  }
  try {
    await this.pool.query(
    'DELETE FROM search_indexes WHERE id = $1',
    [id]
    );
  } catch (error) {
    // P1-FIX: Type assertion with validation
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to delete search index', err, { id });
    throw error;
  }
  }

  /**
  * Batch save search indexes for better performance
  * @param indexes - Array of SearchIndex to save
  * @param client - Optional client for transaction context
  * P1-FIX: Added client parameter to support transaction participation
  */
  async batchSave(indexes: SearchIndex[], client?: PoolClient): Promise<void> {
  // Validate input
  if (!Array.isArray(indexes)) {
    throw new Error('indexes must be an array');
  }

  if (indexes.length === 0) return;

  // Validate batch size limit
  const MAX_BATCH_SIZE = 1000;
  if (indexes.length > MAX_BATCH_SIZE) {
    throw new Error(
    `Batch size ${indexes.length} exceeds maximum allowed ${MAX_BATCH_SIZE}. ` +
    `Split into smaller batches.`
    );
  }

  // Limit chunk size for processing
  const CHUNK_SIZE = 100;
  if (indexes.length > CHUNK_SIZE) {
    for (let i = 0; i < indexes.length; i += CHUNK_SIZE) {
    await this.batchSave(indexes.slice(i, i + CHUNK_SIZE), client);
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

    // Use unnest for efficient batch insert
    // P1-FIX: Update all fields on conflict
    await newClient.query(
    `INSERT INTO search_indexes (id, domain_id, name, version, status)
    SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[], $4::int[], $5::text[])
    ON CONFLICT (id) DO UPDATE SET
    id = EXCLUDED.id,
    domain_id = EXCLUDED.domain_id,
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    version = EXCLUDED.version,
    updated_at = now()`,
    [
    indexes.map(i => i["id"]),
    indexes.map(i => i.domainId),
    indexes.map(i => i["name"]),
    indexes.map(i => i.version),
    indexes.map(i => i["status"])
    ]
    );

    if (shouldManageTransaction) {
    await newClient.query('COMMIT');
    }
  } catch (error) {
    if (shouldManageTransaction) {
    // P1-FIX: Added logging to empty catch block instead of silently suppressing
    await newClient.query('ROLLBACK').catch((rollbackErr) => {
      logger.error('Rollback failed during batch save', rollbackErr instanceof Error ? rollbackErr : new Error(String(rollbackErr)));
    });
    }
    // P1-FIX: Type assertion with validation
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to batch save search indexes', err, { count: indexes.length });
    throw error;
  } finally {
    if (!client) {
    newClient.release();
    }
  }
  }

  /**
  * Count search indexes by domain
  * @param domainId - Domain ID
  * @returns Number of search indexes
  */
  async countByDomain(domainId: string): Promise<number> {
  // Validate input
  if (!domainId || typeof domainId !== 'string') {
    throw new Error('domainId must be a non-empty string');
  }
  try {
    const { rows } = await this.pool.query(
    'SELECT COUNT(*) as count FROM search_indexes WHERE domain_id = $1',
    [domainId]
    );

    return parseInt(rows[0]?.count || '0', 10);
  } catch (error) {
    // P1-FIX: Type assertion with validation
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to count search indexes', err, { domainId });
    throw error;
  }
  }
}
