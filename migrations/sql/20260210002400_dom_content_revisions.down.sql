-- Rollback: Drop content_revisions table and its index
DROP INDEX IF EXISTS idx_revisions_content;
DROP TABLE IF EXISTS content_revisions CASCADE;
