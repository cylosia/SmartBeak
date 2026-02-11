
import { PoolClient } from 'pg';

import { SearchDocument } from '../../domain/entities/SearchDocument';

/**
* Search result row returned from database queries
*/
export interface SearchResultRow {
  id: string;
  fields: Record<string, unknown>;
  rank: number;
}

/**
* Repository interface for SearchDocument persistence and retrieval.
*
* @throws {RepositoryError} Implementations should throw domain-appropriate errors
*/
export interface SearchDocumentRepository {
  /**
  * Upsert a search document
  *
  * @param doc - The search document to upsert
  * @param client - Optional client for transaction context
  * @returns Promise resolving when upsert is complete
  * @throws {Error} If persistence operation fails
  */
  upsert(doc: SearchDocument, client?: PoolClient): Promise<void>;

  /**
  * Mark a search document as deleted
  *
  * @param id - The unique identifier of the document to mark deleted
  * @param client - Optional client for transaction context
  * @returns Promise resolving when operation is complete
  * @throws {Error} If operation fails
  */
  markDeleted(id: string, client?: PoolClient): Promise<void>;

  /**
  * Search documents by query string
  *
  * @param query - The search query string
  * @param limit - Maximum number of results to return (default: 20, max: 100)
  * @returns Promise resolving to array of search results
  * @throws {Error} If query execution fails
  */
  search(query: string, limit?: number): Promise<SearchResultRow[]>;

  /**
  * Bulk upsert search documents
  *
  * @param docs - Array of SearchDocument to upsert
  * @param client - Optional client for transaction context
  * @returns Promise resolving when operation is complete
  * @throws {Error} If operation fails
  */
  batchUpsert(docs: SearchDocument[], client?: PoolClient): Promise<void>;
}
