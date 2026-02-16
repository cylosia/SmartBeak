-- Rollback: Drop content_media_links junction table and its indexes
DROP INDEX IF EXISTS idx_content_media_links_content_id;
DROP INDEX IF EXISTS idx_content_media_links_media_id;
DROP TABLE IF EXISTS content_media_links CASCADE;
