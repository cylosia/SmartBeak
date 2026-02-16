-- Rollback: Remove storage lifecycle columns and index from media_assets
DROP INDEX IF EXISTS idx_media_lifecycle;
ALTER TABLE media_assets DROP COLUMN IF EXISTS storage_class;
ALTER TABLE media_assets DROP COLUMN IF EXISTS last_accessed_at;
