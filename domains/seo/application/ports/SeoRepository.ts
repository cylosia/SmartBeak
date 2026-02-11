
import { PoolClient } from 'pg';

import { SeoDocument } from '../../domain/entities/SeoDocument';

/**
* Repository interface for SeoDocument persistence
*
* P1-FIX: All methods accept optional client parameter for transaction support
*/
export interface SeoRepository {
  /**
  * Get SEO document by ID
  * @param id - Document ID
  * @param client - Optional database client for transaction context
  * @returns Promise resolving to SeoDocument or null
  */
  getById(id: string, client?: PoolClient): Promise<SeoDocument | null>;

  /**
  * Save an SEO document
  * @param doc - SeoDocument to save
  * @param client - Optional database client for transaction context
  * @returns Promise resolving when save is complete
  */
  save(doc: SeoDocument, client?: PoolClient): Promise<void>;

  /**
  * List SEO documents with pagination
  * @param limit - Maximum number of results
  * @param offset - Pagination offset
  * @param client - Optional database client for transaction context
  * @returns Promise resolving to array of SeoDocument
  */
  list?(limit?: number, offset?: number, client?: PoolClient): Promise<SeoDocument[]>;

  /**
  * Search SEO documents by title
  * @param query - Search query
  * @param limit - Maximum number of results
  * @param client - Optional database client for transaction context
  * @returns Promise resolving to array of matching SeoDocument
  */
  searchByTitle?(query: string, limit?: number, client?: PoolClient): Promise<SeoDocument[]>;

  /**
  * Batch save SEO documents
  * @param docs - Array of SeoDocument to save
  * @param client - Optional database client for transaction context
  * @returns Promise resolving when save is complete
  */
  batchSave?(docs: SeoDocument[], client?: PoolClient): Promise<void>;

  /**
  * Delete an SEO document
  * @param id - Document ID to delete
  * @param client - Optional database client for transaction context
  * @returns Promise resolving when deletion is complete
  */
  delete?(id: string, client?: PoolClient): Promise<void>;

  /**
  * Close the repository connection
  * @returns Promise resolving when connection is closed
  */
  close?(): Promise<void>;
}
