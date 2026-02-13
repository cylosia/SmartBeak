import { PoolClient } from 'pg';

import { ContentItem, ContentStatus } from '../../domain/entities/ContentItem';




/**
* Repository interface for ContentItem persistence.
*

* This allows repositories to participate in parent transactions by passing a PoolClient.
*
* @throws {RepositoryError} Implementations should throw domain-appropriate errors
*/
export interface ContentRepository {
  /**
  * Retrieve a content item by its unique ID
  *
  * @param id - The unique identifier of the content item
  * @param client - Optional database client for transaction context
  * @returns Promise resolving to the content item, or null if not found
  * @throws {Error} If database connection fails or other infrastructure error occurs
  */
  getById(id: string, client?: PoolClient): Promise<ContentItem | null>;

  /**
  * Save or update a content item
  *
  * @param item - The content item to persist
  * @param client - Optional database client for transaction context
  * @returns Promise resolving when save is complete
  * @throws {Error} If persistence operation fails
  */
  save(item: ContentItem, client?: PoolClient): Promise<void>;

  /**
  * List content items filtered by status with pagination
  *
  * @param status - The content status to filter by
  * @param limit - Maximum number of items to return
  * @param offset - Number of items to skip (for pagination)
  * @param domainId - Optional domain filter for multi-tenant scenarios
  * @param orgId - Optional org filter for multi-tenant isolation
  * @param client - Optional database client for transaction context
  * @returns Promise resolving to array of content items (may contain nulls if validation fails)
  * @throws {Error} If query execution fails
  */
  listByStatus(
  status: ContentStatus,
  limit: number,
  offset: number,
  domainId?: string,
  orgId?: string,
  client?: PoolClient
  ): Promise<(ContentItem | null)[]>;

  /**
  * Find content items that are ready to be published
  *
  * Items with 'scheduled' status where publishAt time has been reached
  *
  * @param now - The current datetime to compare against
  * @param domainId - Optional domain filter for multi-tenant scenarios
  * @param client - Optional database client for transaction context
  * @returns Promise resolving to array of publishable content items (may contain nulls)
  * @throws {Error} If query execution fails
  */
  listReadyToPublish(now: Date, domainId?: string, client?: PoolClient): Promise<(ContentItem | null)[]>;

  /**
  * List all content items for a specific domain with optional pagination
  *
  * @param domainId - The domain/tenant identifier
  * @param limit - Maximum number of items to return (defaults to implementation)
  * @param offset - Number of items to skip (defaults to 0)
  * @param client - Optional database client for transaction context
  * @returns Promise resolving to array of content items (may contain nulls)
  * @throws {Error} If query execution fails
  */
  listByDomain(domainId: string, limit?: number, offset?: number, client?: PoolClient): Promise<(ContentItem | null)[]>;

  /**
  * Delete a content item by ID
  *
  * @param id - The unique identifier of the content item to delete
  * @param client - Optional database client for transaction context
  * @returns Promise resolving to the number of rows deleted
  * @throws {Error} If deletion fails or item not found
  */
  delete(id: string, client?: PoolClient): Promise<number>;

  /**
  * Count content items by domain
  *
  * @param domainId - The domain/tenant identifier
  * @param client - Optional database client for transaction context
  * @returns Promise resolving to the count of content items
  * @throws {Error} If query execution fails
  */
  countByDomain(domainId: string, client?: PoolClient): Promise<number>;

  /**
  * Batch save multiple content items
  *
  * @param items - Array of content items to save
  * @param client - Optional database client for transaction context
  * @returns Promise resolving to batch operation result
  * @throws {Error} If persistence operation fails
  */
  batchSave?(items: ContentItem[], client?: PoolClient): Promise<{ saved: number; failed: number; errors: string[] }>;
}

/**
* Custom error class for repository operations
*/
export class RepositoryError extends Error {
  constructor(
  message: string,
  public readonly code: string,
  override readonly cause?: unknown
  ) {
  super(message);
  this["name"] = 'RepositoryError';
  }
}
