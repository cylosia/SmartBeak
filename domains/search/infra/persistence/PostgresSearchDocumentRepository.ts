import { SearchDocument } from '../../domain/entities/SearchDocument';
import { buildWeightedTSVector } from '../fts/PostgresFTSAdapter';
import { SearchDocumentRepository, SearchResultRow } from '../../application/ports/SearchDocumentRepository';
import { validateSearchDocumentFields } from '@domain/shared/infra/validation/DatabaseSchemas';
import { getLogger } from '@kernel/logger';
import { Pool, PoolClient } from 'pg';

const logger = getLogger('search:document:repository');

const MAX_LIMIT = 100;
/**
 * Repository implementation for SearchDocument using PostgreSQL
 *
 * DATABASE MIGRATION NOTES:
 *

 *   - search_documents["id"]: TEXT -> UUID
 *   - search_documents.index_id: TEXT -> UUID
 *
 * MEDIUM FIX M1: Recommended Indexes:
 *   - CREATE INDEX idx_search_documents_index_id ON search_documents(index_id);
 *   - CREATE INDEX idx_search_documents_status ON search_documents(status);
 *   - CREATE GIN INDEX idx_search_documents_tsv ON search_documents USING GIN(tsv_weighted);
 *
 * MEDIUM FIX M2: Updated At Triggers:
 *   CREATE TRIGGER update_search_documents_updated_at
 *     BEFORE UPDATE ON search_documents
 *     FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
 */
export class PostgresSearchDocumentRepository implements SearchDocumentRepository {
  constructor(private pool: Pool) {}

  async upsert(doc: SearchDocument, client?: PoolClient): Promise<void> {
    const queryable = client || this.pool;
    try {

      validateSearchDocumentFields(doc.fields);
      const { title, body } = buildWeightedTSVector(doc.fields);
      await queryable.query(`INSERT INTO search_documents (id, index_id, fields, status, tsv_weighted)
    VALUES ($1, $2, $3, $4,
      setweight(to_tsvector('english', $5), 'A') ||
      setweight(to_tsvector('english', $6), 'B')
    )
    ON CONFLICT (id)
    DO UPDATE SET
      fields = $3,
      status = $4,
      tsv_weighted =
      setweight(to_tsvector('english', $5), 'A') ||
      setweight(to_tsvector('english', $6), 'B'),
      updated_at = now()`, [doc.id, doc.indexId, JSON.stringify(doc.fields), doc.status, title, body]);
    }
    catch (error) {
      logger.error('Failed to upsert search document', error as Error, {
        id: doc.id,
        indexId: doc.indexId
      });
      throw error;
    }
  }

  async markDeleted(id: string, client?: PoolClient): Promise<void> {
    const queryable = client || this.pool;
    try {
      await queryable.query(`UPDATE search_documents
    SET status = 'deleted', updated_at = now()
    WHERE id = $1`, [id]);
    }
    catch (error) {
      logger.error('Failed to mark search document as deleted', error as Error, { id });
      throw error;
    }
  }

  // P0-FIX: Added indexId parameter to scope search to a single tenant's index.
  // Without it search returned results from ALL organisations in the system
  // (cross-tenant data leak).
  async search(query: string, indexId: string, limit = 20): Promise<SearchResultRow[]> {
    if (!indexId || typeof indexId !== 'string') {
      throw new Error('indexId must be a non-empty string');
    }

    const safeLimit = Math.min(Math.max(1, limit), MAX_LIMIT);

    // SECURITY FIX: Sanitize FTS query to prevent injection and DoS
    const sanitizedQuery = this.sanitizeFtsQuery(query);

    try {
      const { rows } = await this.pool.query(`SELECT id, fields,
        ts_rank(tsv_weighted, plainto_tsquery('english', $1)) AS rank
    FROM search_documents
    WHERE status = 'indexed'
      AND index_id = $3
      AND tsv_weighted @@ plainto_tsquery('english', $1)
    ORDER BY rank DESC
    LIMIT $2`, [sanitizedQuery, safeLimit, indexId]);
      return rows as SearchResultRow[];
    }
    catch (error) {
      logger.error('Failed to search documents', error as Error, { query: sanitizedQuery, indexId });
      throw error;
    }
  }

  /**
   * SECURITY FIX: Sanitize Full-Text Search query to prevent injection attacks
   * - Removes FTS operators that could alter query behavior
   * - Limits query length to prevent DoS
   * - Normalizes whitespace
   * @param query - Raw user input query
   * @returns Sanitized query safe for plainto_tsquery
   */
  private sanitizeFtsQuery(query: string): string {
    if (!query || typeof query !== 'string') {
      return '';
    }

    // Limit query length to prevent DoS (PostgreSQL has limits on query complexity)
    const MAX_QUERY_LENGTH = 200;
    let sanitized = query.slice(0, MAX_QUERY_LENGTH).trim();

    // Remove characters that could be used for FTS injection
    // These characters have special meaning in PostgreSQL FTS:
    // & (AND), | (OR), ! (NOT), ( ) for grouping, : for field search, * for prefix
    // Even with plainto_tsquery, we sanitize to be safe
    sanitized = sanitized
      .replace(/[&|!():*]/g, ' ')     // Remove FTS operators
      .replace(/\s+/g, ' ')           // Normalize whitespace
      .trim();

    // Prevent empty queries which could cause errors
    if (!sanitized) {
      return '';
    }

    return sanitized;
  }
  /**
  * MEDIUM FIX M6: Bulk upsert search documents using UNNEST pattern
  * for efficient batch operations
  */
  async batchUpsert(docs: SearchDocument[], client?: PoolClient): Promise<void> {
    if (docs.length === 0)
      return;
        const MAX_BATCH_SIZE = 500; // Lower limit due to TSVector complexity
    if (docs.length > MAX_BATCH_SIZE) {
      throw new Error(`Batch size ${docs.length} exceeds maximum allowed ${MAX_BATCH_SIZE}. ` +
        `Split into smaller batches.`);
    }
    // Validate all fields before starting transaction
    for (const doc of docs) {
      validateSearchDocumentFields(doc.fields);
    }
    // P1-FIX #9: When no client is provided, acquire a dedicated client from the pool.
    // Previously cast this.pool to PoolClient and called BEGIN on it, but Pool.query()
    // runs each query on a random connection - so BEGIN, INSERT, and COMMIT would run
    // on different connections, making the transaction non-atomic.
    const shouldManageTransaction = !client;
    const queryable = client || (shouldManageTransaction ? await this.pool.connect() : this.pool);

    try {
      if (shouldManageTransaction) {
        await (queryable as PoolClient).query('BEGIN');
      }
            const tsvData = docs.map(d => buildWeightedTSVector(d.fields));
      await queryable.query(`INSERT INTO search_documents (id, index_id, fields, status, tsv_weighted)
    SELECT
      id,
      index_id,
      fields,
      status,
      setweight(to_tsvector('english', title), 'A') ||
      setweight(to_tsvector('english', body), 'B')
    FROM UNNEST(
      $1::text[],
      $2::text[],
      $3::jsonb[],
      $4::text[],
      $5::text[],
      $6::text[]
    ) AS t(id, index_id, fields, status, title, body)
    ON CONFLICT (id)
    DO UPDATE SET
      fields = EXCLUDED.fields,
      status = EXCLUDED.status,
      tsv_weighted = EXCLUDED.tsv_weighted,
      updated_at = now()`, [
        docs.map(d => d.id),
        docs.map(d => d.indexId),
        docs.map(d => JSON.stringify(d.fields)),
        docs.map(d => d.status),
        tsvData.map(t => t.title),
        tsvData.map(t => t.body),
      ]);

      if (shouldManageTransaction) {
        await (queryable as PoolClient).query('COMMIT');
      }
    }
    catch (error) {
      if (shouldManageTransaction) {
        // CRITICAL FIX: Log rollback failures instead of silently ignoring
        try {
          await (queryable as PoolClient).query('ROLLBACK');
        } catch (rollbackError) {
          const rollbackErr = rollbackError instanceof Error 
            ? rollbackError 
            : new Error(String(rollbackError));
          
          logger.error(
            'Rollback failed during batch upsert - possible data inconsistency',
            rollbackErr,
            { count: docs.length }
          );
          
          // Chain the errors
          const originalErr = error instanceof Error ? error : new Error(String(error));
          throw new Error(
            `Batch upsert failed: ${originalErr.message}. ` +
            `Additionally, rollback failed: ${rollbackErr.message}`
          );
        }
      }
      logger.error('Failed to batch upsert search documents', error as Error, { count: docs.length });
      throw error;
    } finally {
      // P1-FIX #9: Release the dedicated client back to the pool
      if (shouldManageTransaction) {
        (queryable as PoolClient).release();
      }
    }
  }
}
