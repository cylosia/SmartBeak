-- Rollback: Remove tsvector column and GIN index from search_documents
DROP INDEX IF EXISTS idx_search_documents_tsv;
ALTER TABLE search_documents DROP COLUMN IF EXISTS tsv;
