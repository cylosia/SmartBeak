-- Rollback: Drop content_items indexes added by this migration
DROP INDEX IF EXISTS idx_content_created;
DROP INDEX IF EXISTS idx_content_status;
