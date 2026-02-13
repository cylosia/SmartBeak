
ALTER TABLE search_documents
ADD COLUMN IF NOT EXISTS tsv tsvector;

CREATE INDEX IF NOT EXISTS idx_search_documents_tsv
ON search_documents USING GIN(tsv);
