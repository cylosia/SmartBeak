-- Rollback: Drop content_items table and its indexes
DROP INDEX IF EXISTS idx_content_items_updated_at;
DROP INDEX IF EXISTS idx_content_items_publish_at;
DROP INDEX IF EXISTS idx_content_items_domain_status;
DROP INDEX IF EXISTS idx_content_items_status;
DROP INDEX IF EXISTS idx_content_items_domain_id;
DROP TABLE IF EXISTS content_items CASCADE;
