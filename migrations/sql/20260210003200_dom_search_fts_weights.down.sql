-- Rollback: Remove weighted tsvector column and partial GIN index from search_documents
DROP INDEX IF EXISTS idx_search_documents_tsv_weighted_active;
ALTER TABLE search_documents DROP COLUMN IF EXISTS tsv_weighted;
