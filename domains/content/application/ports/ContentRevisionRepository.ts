import { PoolClient } from 'pg';

import { ContentRevision } from '../../domain/entities/ContentRevision';




/**
* Repository interface for ContentRevision persistence.
*
* This interface manages historical versions of content items,
* enabling version history and rollback capabilities.
*
* Implementations should handle storage efficiency concerns as
* revision data can grow significantly over time.
*
* P1-FIX: All methods accept optional client parameter for transaction support
*/
export interface ContentRevisionRepository {
  /**
  * Add a new revision to the history
  *
  * @param revision - The revision to persist
  * @param client - Optional database client for transaction participation
  * @returns Promise resolving when the revision is saved
  * @throws {Error} If persistence operation fails
  *
  * @example
  * ```typescript
  * const revision = new ContentRevision('rev-1', 'content-1', 'Title', 'Body', new Date());
  * await repo.add(revision);
  *
  * // Within transaction
  * await repo.add(revision, client);
  * ```
  */
  add(revision: ContentRevision, client?: PoolClient): Promise<void>;

  /**
  * Get a specific revision by ID
  *
  * @param id - Revision ID
  * @param client - Optional database client for transaction participation
  * @returns Promise resolving to the revision or null if not found
  */
  getById(id: string, client?: PoolClient): Promise<ContentRevision | null>;

  /**
  * List revisions for a specific content item, ordered by creation date (newest first)
  *
  * @param contentId - The content item ID to fetch revisions for
  * @param limit - Maximum number of revisions to return
  * @param offset - Number of revisions to skip (for pagination)
  * @param client - Optional database client for transaction participation
  * @returns Promise resolving to array of revisions
  * @throws {Error} If query execution fails
  *
  * @example
  * ```typescript
  * const revisions = await repo.listByContent('content-1', 10);
  * ```
  */
  listByContent(contentId: string, limit: number, offset?: number, client?: PoolClient): Promise<ContentRevision[]>;

  /**
  * Count revisions for a content item
  *
  * @param contentId - Content ID
  * @param client - Optional database client for transaction participation
  * @returns Promise resolving to number of revisions
  */
  countByContent(contentId: string, client?: PoolClient): Promise<number>;

  /**
  * Remove old revisions, keeping only the specified number of most recent ones
  *
  * Use this method for data retention policies and storage management.
  *
  * @param contentId - The content item ID to prune revisions for
  * @param keepLast - Number of most recent revisions to preserve
  * @param client - Optional database client for transaction participation
  * @returns Promise resolving when pruning is complete
  * @throws {Error} If deletion operation fails
  *
  * @example
  * ```typescript
  * // Keep only the last 5 revisions
  * await repo.prune('content-1', 5);
  * ```
  */
  prune(contentId: string, keepLast: number, client?: PoolClient): Promise<void>;

  /**
  * Delete all revisions for a content item
  *
  * @param contentId - Content ID
  * @param client - Optional database client for transaction participation
  * @returns Promise resolving when deletion is complete
  */
  deleteByContent(contentId: string, client?: PoolClient): Promise<void>;
}

/**
* Options for listing revisions
*/
export interface ListRevisionsOptions {
  /** Maximum number of revisions to return */
  limit: number;
  /** Number of revisions to skip (for pagination) */
  offset?: number;
}

/**
* Custom error for revision repository operations
*/
export class RevisionRepositoryError extends Error {
  constructor(
  message: string,
  public readonly operation: 'add' | 'list' | 'prune' | 'get' | 'count' | 'delete',
  public readonly contentId?: string
  ) {
  super(message);
  this["name"] = 'RevisionRepositoryError';
  }
}
