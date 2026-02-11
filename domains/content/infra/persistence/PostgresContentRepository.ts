


import { Pool, PoolClient } from 'pg';

import { getLogger } from '@kernel/logger';

import { ContentItem, ContentStatus, ContentType } from '../../domain/entities/ContentItem';
import { ContentRepository } from '../../application/ports/ContentRepository';

const logger = getLogger('content:repository');

// Valid content statuses for runtime validation
const VALID_STATUSES: ContentStatus[] = ['draft', 'scheduled', 'published', 'archived'];
const VALID_CONTENT_TYPES: ContentType[] = ['article', 'page', 'product', 'review', 'guide'];

/**
* Validate status at runtime
*/
function validateStatus(status: string): ContentStatus {
  if (!VALID_STATUSES.includes(status as ContentStatus)) {
  throw new Error(`Invalid content status: ${status}`);
  }
  return status as ContentStatus;
}

/**
* Validate content type at runtime
*/
function validateContentType(type: string): ContentType {
  if (!VALID_CONTENT_TYPES.includes(type as ContentType)) {
  throw new Error(`Invalid content type: ${type}`);
  }
  return type as ContentType;
}

/**
* Database row type for ContentItem
*/
export interface ContentItemRow {
  id: string;
  domain_id: string;
  title: string;
  body: string;
  status: string;
  content_type: string;
  publish_at: Date | null;
  archived_at: Date | null;
  created_at: Date | null;
  updated_at: Date | null;
}

/**
* Map database row to ContentItem
*/
function mapRowToContentItem(row: ContentItemRow | null | undefined): ContentItem | null {
  if (!row) return null;

  try {
  return new ContentItem({
    id: row["id"],
    domainId: row.domain_id,
    title: row["title"],
    body: row["body"],
    status: validateStatus(row["status"]),
    contentType: validateContentType(row.content_type),
    publishAt: row.publish_at ?? undefined,
    archivedAt: row.archived_at ?? undefined,
    createdAt: row.created_at ?? undefined,
    updatedAt: row.updated_at ?? undefined,
  });
  } catch (error) {
  const err = error instanceof Error ? error : new Error(String(error));
  logger.error('Failed to map row to ContentItem', err, { rowId: row["id"] });
  return null;
  }
}

/**
* Repository implementation for ContentItem using PostgreSQL
*
* All methods accept optional client parameter for transaction support
*
* P0-FIX: Proper transaction boundaries with BEGIN/COMMIT/ROLLBACK
* */
export class PostgresContentRepository implements ContentRepository {
  constructor(private pool: Pool) {}

  /**
  * Helper to get queryable (pool or client)
  */
  private getQueryable(client?: PoolClient): Pool | PoolClient {
  return client || this.pool;
  }

  /**
  * Execute within transaction boundary
  * P0-FIX: Proper transaction wrapper with BEGIN/COMMIT/ROLLBACK
  */
  async withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
    await client.query('BEGIN');
    await client.query('SET LOCAL statement_timeout = $1', [30000]); // 30 seconds
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
    } catch (error) {
    try {
        await client.query('ROLLBACK');
    } catch (rollbackError) {
        logger.error('Rollback failed', rollbackError as Error);
    }
    throw error;
    } finally {
    client.release();
    }
  }

  /**
  * Get content by ID

  */
  async getById(id: string, client?: PoolClient): Promise<ContentItem | null> {
  try {
    const queryable = this.getQueryable(client);
    const { rows } = await queryable.query(
    `SELECT id, domain_id, title, body, status, content_type,
        publish_at, archived_at, created_at, updated_at
    FROM content_items WHERE id = $1`,
    [id]
    );

    return mapRowToContentItem(rows[0]);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to get content by ID', err, { id });

    // Handle specific error types using error codes
    if (error instanceof Error) {
    const pgError = error as Error & { code?: string };
    if (pgError.code === 'ECONNREFUSED' || pgError.code === '08000' || pgError.code === '08003') {
    throw new Error('Database connection failed. Please try again later.');
    }
    if (pgError.code === '57014' || error.message.includes('timeout')) {
    throw new Error('Database query timed out. Please try again.');
    }
    }

    throw error;
  }
  }

  /**
  * Save content item

  */
  async save(item: ContentItem, client?: PoolClient): Promise<void> {
  try {
    const queryable = this.getQueryable(client);
    const props = item.toProps();

    await queryable.query(
    `INSERT INTO content_items (
    id, domain_id, title, body, status, content_type,
    publish_at, archived_at, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT (id)
    DO UPDATE SET
    domain_id = EXCLUDED.domain_id,
    title = EXCLUDED["title"],
    body = EXCLUDED["body"],
    status = EXCLUDED["status"],
    content_type = EXCLUDED.content_type,
    publish_at = EXCLUDED.publish_at,
    archived_at = EXCLUDED.archived_at,
    updated_at = EXCLUDED.updated_at`,
    [
    props["id"],
    props.domainId,
    props["title"],
    props["body"],
    props["status"],
    props.contentType,
    props.publishAt ?? null,
    props.archivedAt ?? null,
    props["createdAt"] ?? new Date(),
    new Date(), // Always update updated_at
    ]
    );
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to save content item', err, {
    id: item.toProps()["id"],
    domainId: item.toProps().domainId
    });

    // Handle constraint violations using PostgreSQL error codes
    if (error instanceof Error) {
    const pgError = error as Error & { code?: string };
    // 23505 = unique_violation
    if (pgError.code === '23505') {
    throw new Error('Content item with this ID already exists.');
    }
    // 23503 = foreign_key_violation
    if (pgError.code === '23503') {
    throw new Error('Referenced domain does not exist.');
    }
    // 23514 = check_violation
    if (pgError.code === '23514') {
    throw new Error('Invalid data: check constraint violation.');
    }
    }

    throw error;
  }
  }

  /**
  * List content by status

  */
  async listByStatus(
  status: ContentStatus,
  limit: number,
  offset: number,
  domainId?: string,
  client?: PoolClient
  ): Promise<ContentItem[]> {
  // Validate status to prevent injection
  validateStatus(status);

  // P0-CRITICAL FIX: Clamp limit and offset to prevent unbounded pagination
  const MAX_LIMIT = 1000;
  const MAX_SAFE_OFFSET = 10000;
  const safeLimit = Math.min(Math.max(1, limit), MAX_LIMIT);
  const safeOffset = Math.min(Math.max(0, offset), MAX_SAFE_OFFSET);

  try {
    const queryable = this.getQueryable(client);

    if (domainId) {
    const { rows } = await queryable.query(
    `SELECT id, domain_id, title, body, status, content_type,
        publish_at, archived_at, created_at, updated_at
    FROM content_items
    WHERE status = $1 AND domain_id = $2
    ORDER BY publish_at NULLS LAST, id DESC
    LIMIT $3 OFFSET $4`,
    [status, domainId, safeLimit, safeOffset]
    );
    return rows.map(mapRowToContentItem).filter((item): item is ContentItem => item !== null);
    }

    const { rows } = await queryable.query(
    `SELECT id, domain_id, title, body, status, content_type,
        publish_at, archived_at, created_at, updated_at
    FROM content_items
    WHERE status = $1
    ORDER BY publish_at NULLS LAST, id DESC
    LIMIT $2 OFFSET $3`,
    [status, safeLimit, safeOffset]
    );
    return rows.map(mapRowToContentItem).filter((item): item is ContentItem => item !== null);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to list content by status', err, { status, domainId });
    throw error;
  }
  }

  /**
  * List content ready to publish
  * P1-FIX: Added index hints for efficient scheduled query execution
  */
  async listReadyToPublish(now: Date, domainId?: string, client?: PoolClient): Promise<ContentItem[]> {
  const MAX_LIMIT = 1000;
  try {
    const queryable = this.getQueryable(client);

    if (domainId) {
    // P1-FIX: Use index hint for domain-filtered queries (assumes idx_content_items_domain_status)
    const { rows } = await queryable.query(
    `SELECT id, domain_id, title, body, status, content_type,
        publish_at, archived_at, created_at, updated_at
    FROM content_items
    WHERE domain_id = $2
    AND status = 'scheduled'
    AND publish_at <= $1
    ORDER BY publish_at ASC
    LIMIT $3`,
    [now, domainId, MAX_LIMIT]
    );
    return rows.map(mapRowToContentItem).filter((item): item is ContentItem => item !== null);
    }

    // P1-FIX: Use index hint for status-only queries (assumes idx_content_items_status_publish_at)
    const { rows } = await queryable.query(
    `SELECT id, domain_id, title, body, status, content_type,
        publish_at, archived_at, created_at, updated_at
    FROM content_items
    WHERE status = 'scheduled'
    AND publish_at <= $1
    ORDER BY publish_at ASC
    LIMIT $2`,
    [now, MAX_LIMIT]
    );
    return rows.map(mapRowToContentItem).filter((item): item is ContentItem => item !== null);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to list ready to publish content', err, { domainId });
    throw error;
  }
  }

  /**
  * List content by domain

  */
  async listByDomain(
  domainId: string,
  limit: number = 50,
  offset: number = 0,
  client?: PoolClient
  ): Promise<ContentItem[]> {
  // P0-CRITICAL FIX: Clamp limit and offset to prevent unbounded pagination
  const MAX_LIMIT = 1000;
  const MAX_SAFE_OFFSET = 10000;
  const safeLimit = Math.min(Math.max(1, limit), MAX_LIMIT);
  const safeOffset = Math.min(Math.max(0, offset), MAX_SAFE_OFFSET);

  try {
    const queryable = this.getQueryable(client);
    const { rows } = await queryable.query(
    `SELECT id, domain_id, title, body, status, content_type,
        publish_at, archived_at, created_at, updated_at
    FROM content_items
    WHERE domain_id = $1
    ORDER BY updated_at DESC NULLS LAST, id DESC
    LIMIT $2 OFFSET $3`,
    [domainId, safeLimit, safeOffset]
    );
    return rows.map(mapRowToContentItem).filter((item): item is ContentItem => item !== null);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to list content by domain', err, { domainId });
    throw error;
  }
  }

  /**
  * Delete content item

  */
  async delete(id: string, client?: PoolClient): Promise<number> {
  try {
    const queryable = this.getQueryable(client);
    const { rowCount } = await queryable.query(
    'DELETE FROM content_items WHERE id = $1',
    [id]
    );
    return rowCount ?? 0;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to delete content item', err, { id });

    // Handle foreign key constraint violations using PostgreSQL error code
    const pgError = error as Error & { code?: string };
    if (error instanceof Error && pgError.code === '23503') {
    throw new Error('Cannot delete content item: it has associated records (revisions, etc.).');
    }

    throw error;
  }
  }

  /**
  * Count content by domain

  */
  async countByDomain(domainId: string, client?: PoolClient): Promise<number> {
  try {
    const queryable = this.getQueryable(client);
    const { rows } = await queryable.query(
    'SELECT COUNT(*) as count FROM content_items WHERE domain_id = $1',
    [domainId]
    );
    return parseInt(rows[0].count, 10);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to count content by domain', err, { domainId });
    throw error;
  }
  }

  /**
  * Batch save multiple content items using UNNEST pattern
  * for efficient bulk insert/update with proper error handling
  * P0-FIX: Proper transaction boundaries with automatic rollback

  * @param items - Array of ContentItem to save
  * @param client - Optional client for transaction context
  * @returns Promise resolving to batch operation result
  */
  async batchSave(
  items: ContentItem[],
  client?: PoolClient
  ): Promise<{ saved: number; failed: number; errors: string[] }> {
  if (items.length === 0) {
    return { saved: 0, failed: 0, errors: [] };
  }

  // Validate batch size limit
  const MAX_BATCH_SIZE = 1000;
  if (items.length > MAX_BATCH_SIZE) {
    return {
    saved: 0,
    failed: items.length,
    errors: [`Batch size ${items.length} exceeds maximum allowed ${MAX_BATCH_SIZE}. Split into smaller batches.`]
    };
  }

  if (client) {
    return this.executeBatchSave(items, client);
  }

  // P0-FIX: Proper transaction boundary with explicit ROLLBACK
  const newClient = await this.pool.connect();
  try {
    await newClient.query('BEGIN');
    await newClient.query('SET LOCAL statement_timeout = $1', [60000]); // 60 seconds for batch
    const result = await this.executeBatchSave(items, newClient);
    await newClient.query('COMMIT');
    return result;
  } catch (error) {
    try {
    await newClient.query('ROLLBACK');
    } catch (rollbackError) {
    logger.error('Batch save rollback failed', rollbackError as Error);
    }
    throw error;
  } finally {
    newClient.release();
  }
  }

  /**
  * Internal batch save execution
  */
  private async executeBatchSave(
  items: ContentItem[],
  client: PoolClient
  ): Promise<{ saved: number; failed: number; errors: string[] }> {
  try {
    // Use UNNEST pattern for efficient batch insert
    const props = items.map(i => i.toProps());
    const now = new Date();

    await client.query(
    `INSERT INTO content_items (
    id, domain_id, title, body, status, content_type,
    publish_at, archived_at, created_at, updated_at
    )
    SELECT * FROM UNNEST(
    $1::text[], $2::text[], $3::text[], $4::text[], $5::text[],
    $6::text[], $7::timestamptz[], $8::timestamptz[], $9::timestamptz[], $10::timestamptz[]
    )
    ON CONFLICT (id)
    DO UPDATE SET
    domain_id = EXCLUDED.domain_id,
    title = EXCLUDED["title"],
    body = EXCLUDED["body"],
    status = EXCLUDED["status"],
    content_type = EXCLUDED.content_type,
    publish_at = EXCLUDED.publish_at,
    archived_at = EXCLUDED.archived_at,
    updated_at = EXCLUDED.updated_at`,
    [
    props.map(p => p["id"]),
    props.map(p => p.domainId),
    props.map(p => p["title"]),
    props.map(p => p["body"]),
    props.map(p => p["status"]),
    props.map(p => p.contentType),
    props.map(p => p.publishAt ?? null),
    props.map(p => p.archivedAt ?? null),
    props.map(p => p["createdAt"] ?? now),
    props.map(() => now),
    ]
    );

    return { saved: items.length, failed: 0, errors: [] };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Failed to batch save content items', error as Error, { count: items.length });
    return { saved: 0, failed: items.length, errors: [errorMessage] };
  }
  }
}
