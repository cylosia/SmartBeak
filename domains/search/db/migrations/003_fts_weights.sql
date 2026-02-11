
-- Add weighted tsvector components (title/body)
ALTER TABLE search_documents
ADD COLUMN IF NOT EXISTS tsv_weighted tsvector;

-- Backfill weighted vector using common fields (safe default)
UPDATE search_documents
SET tsv_weighted =
  setweight(to_tsvector('english', coalesce(fields->>'title','')), 'A') ||
  setweight(to_tsvector('english', coalesce(fields->>'body','')), 'B');

-- Partial GIN index for active (indexed) docs only
CREATE INDEX IF NOT EXISTS idx_search_documents_tsv_weighted_active
ON search_documents USING GIN(tsv_weighted)
WHERE status='indexed';
