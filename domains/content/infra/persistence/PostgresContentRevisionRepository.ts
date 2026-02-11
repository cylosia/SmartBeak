


import { Pool, PoolClient } from 'pg';

import { getLogger } from '@kernel/logger';

import { ContentRevision } from '../../domain/entities/ContentRevision';
import { ContentRevisionRepository } from '../../application/ports/ContentRevisionRepository';

const logger = getLogger('content:revision:repository');

/**
* Repository implementation for ContentRevision using PostgreSQL
*
* P1-FIX: Added optional client parameter to all methods for transaction support
* This allows repository methods to participate in existing transactions
* */
export class PostgresContentRevisionRepository implements ContentRevisionRepository {
  constructor(private pool: Pool) {}

  /**
  * Get a queryable instance (pool or client)
  * P1-FIX: Helper to use provided client or fall back to pool
  */
  private getQueryable(client?: PoolClient): Pool | PoolClient {
  return client || this.pool;
  }

  /**
  * Add a content revision
  * @param rev - ContentRevision to add
  * @param client - Optional database client for transaction participation
  */
  async add(rev: ContentRevision, client?: PoolClient): Promise<void> {
  // Validate input
  if (!rev || typeof rev["id"] !== 'string') {
    throw new Error('revision must have a valid id');
  }

  const queryable = this.getQueryable(client);

  try {
    await queryable.query(
    `INSERT INTO content_revisions (id, content_id, title, body, created_at)
    VALUES ($1, $2, $3, $4, $5)`,
    [rev["id"], rev.contentId, rev["title"], rev["body"], rev["createdAt"]]
    );
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to add content revision', err, {
    id: rev["id"],
    contentId: rev.contentId
    });
    throw error;
  }
  }

  /**
  * List revisions by content ID with pagination
  * @param contentId - Content ID
  * @param limit - Maximum number of results
  * @param offset - Pagination offset
  * @param client - Optional database client for transaction participation
  * @returns Array of ContentRevision
  */
  async listByContent(
  contentId: string,
  limit: number = 20,
  offset: number = 0,
  client?: PoolClient
  ): Promise<ContentRevision[]> {
  // Validate inputs
  if (!contentId || typeof contentId !== 'string') {
    throw new Error('contentId must be a non-empty string');
  }
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('limit must be a positive integer');
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error('offset must be a non-negative integer');
  }
  // P1-FIX: Clamp limit and offset to prevent unbounded pagination
  const MAX_LIMIT = 100;
  const MAX_SAFE_OFFSET = 10000;
  const safeLimit = Math.min(Math.max(1, limit), MAX_LIMIT);
  const safeOffset = Math.min(Math.max(0, offset), MAX_SAFE_OFFSET);

  const queryable = this.getQueryable(client);

  try {
    const { rows } = await queryable.query(
    `SELECT id, content_id, title, body, created_at
    FROM content_revisions
    WHERE content_id = $1
    ORDER BY created_at DESC
    LIMIT $2 OFFSET $3`,
    [contentId, safeLimit, safeOffset]
    );

    return rows.map(r =>
    ContentRevision.reconstitute(
    r["id"],
    r.content_id,
    r["title"],
    r["body"],
    r.created_at
    )
    );
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to list revisions by content', err, { contentId });
    throw error;
  }
  }

  /**
  * Get a specific revision by ID
  * @param id - Revision ID
  * @param client - Optional database client for transaction participation
  * @returns ContentRevision or null if not found
  */
  async getById(id: string, client?: PoolClient): Promise<ContentRevision | null> {
  // Validate input
  if (!id || typeof id !== 'string') {
    throw new Error('id must be a non-empty string');
  }

  const queryable = this.getQueryable(client);

  try {
    const { rows } = await queryable.query(
    `SELECT id, content_id, title, body, created_at
    FROM content_revisions
    WHERE id = $1`,
    [id]
    );

    if (!rows[0]) {
    return null;
    }

    return ContentRevision.reconstitute(
    rows[0]["id"],
    rows[0].content_id,
    rows[0]["title"],
    rows[0]["body"],
    rows[0].created_at
    );
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to get revision by ID', err, { id });
    throw error;
  }
  }

  /**
  * Prune old revisions, keeping only the last N
  * @param contentId - Content ID
  * @param keepLast - Number of revisions to keep
  * @param client - Optional database client for transaction participation
  */
  async prune(contentId: string, keepLast: number, client?: PoolClient): Promise<void> {
  // Validate inputs
  if (!contentId || typeof contentId !== 'string') {
    throw new Error('contentId must be a non-empty string');
  }

  // Validate keepLast with bounds
  const safeKeepLast = Math.max(1, Math.min(keepLast, 100));

  const queryable = this.getQueryable(client);

  try {
    // Use CTE instead of correlated subquery for better performance
    await queryable.query(
    `WITH keep_ids AS (
    SELECT id FROM content_revisions
    WHERE content_id = $1
    ORDER BY created_at DESC
    LIMIT $2
    )
    DELETE FROM content_revisions
    WHERE content_id = $1
    AND id NOT IN (SELECT id FROM keep_ids)`,
    [contentId, safeKeepLast]
    );
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to prune content revisions', err, { contentId });
    throw error;
  }
  }

  /**
  * Count revisions for a content item
  * @param contentId - Content ID
  * @param client - Optional database client for transaction participation
  * @returns Number of revisions
  */
  async countByContent(contentId: string, client?: PoolClient): Promise<number> {
  // Validate input
  if (!contentId || typeof contentId !== 'string') {
    throw new Error('contentId must be a non-empty string');
  }

  const queryable = this.getQueryable(client);

  try {
    const { rows } = await queryable.query(
    'SELECT COUNT(*) as count FROM content_revisions WHERE content_id = $1',
    [contentId]
    );

    return parseInt(rows[0]?.count || '0', 10);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to count revisions', err, { contentId });
    throw error;
  }
  }

  /**
  * Delete all revisions for a content item
  * @param contentId - Content ID
  * @param client - Optional database client for transaction participation
  */
  async deleteByContent(contentId: string, client?: PoolClient): Promise<void> {
  // Validate input
  if (!contentId || typeof contentId !== 'string') {
    throw new Error('contentId must be a non-empty string');
  }

  const queryable = this.getQueryable(client);

  try {
    await queryable.query(
    'DELETE FROM content_revisions WHERE content_id = $1',
    [contentId]
    );
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to delete revisions by content', err, { contentId });
    throw error;
  }
  }
}
