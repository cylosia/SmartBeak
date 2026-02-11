
import { PoolClient } from 'pg';

import { SearchIndex } from '../../domain/entities/SearchIndex';

/**
* Repository interface for SearchIndex persistence.
*
* This interface manages search index definitions and their lifecycle.
*
* P1-FIX: All methods accept optional client parameter for transaction support
* @throws {RepositoryError} Implementations should throw domain-appropriate errors
*/
export interface SearchIndexRepository {
  /**
  * Get the active search index for a domain
  *
  * @param domainId - The domain/tenant identifier
  * @param client - Optional database client for transaction context
  * @returns Promise resolving to the active search index, or null if none exists
  * @throws {Error} If query execution fails
  */
  getActive(domainId: string, client?: PoolClient): Promise<SearchIndex | null>;

  /**
  * Save or update a search index
  *
  * @param index - The search index to save
  * @param client - Optional database client for transaction context
  * @returns Promise resolving when save is complete
  * @throws {Error} If persistence operation fails
  */
  save(index: SearchIndex, client?: PoolClient): Promise<void>;

  /**
  * Get a search index by ID
  * MEDIUM FIX M22: Added getById method
  *
  * @param id - The unique identifier of the search index
  * @param client - Optional database client for transaction context
  * @returns Promise resolving to the search index, or null if not found
  * @throws {Error} If query execution fails
  */
  getById?(id: string, client?: PoolClient): Promise<SearchIndex | null>;

  /**
  * List all search indexes for a domain
  * MEDIUM FIX M23: Added listByDomain method
  *
  * @param domainId - The domain/tenant identifier
  * @param limit - Maximum number of results
  * @param offset - Pagination offset
  * @param client - Optional database client for transaction context
  * @returns Promise resolving to array of search indexes
  * @throws {Error} If query execution fails
  */
  listByDomain?(domainId: string, limit?: number, offset?: number, client?: PoolClient): Promise<SearchIndex[]>;

  /**
  * Delete a search index
  * MEDIUM FIX M24: Added delete method
  *
  * @param id - The unique identifier of the search index to delete
  * @param client - Optional database client for transaction context
  * @returns Promise resolving when deletion is complete
  * @throws {Error} If deletion fails
  */
  delete?(id: string, client?: PoolClient): Promise<void>;

  /**
  * Batch save search indexes for better performance
  * P1-FIX: Added for efficient batch processing with transaction support
  *
  * @param indexes - Array of SearchIndex to save
  * @param client - Optional database client for transaction context
  * @returns Promise resolving when save is complete
  * @throws {Error} If persistence operation fails
  */
  batchSave?(indexes: SearchIndex[], client?: PoolClient): Promise<void>;
}

/**
* Custom error class for repository operations
*/
export class SearchIndexError extends Error {
  constructor(
  message: string,
  public readonly code: string,
  override readonly cause?: unknown
  ) {
  super(message);
  this["name"] = 'SearchIndexError';
  }
}
