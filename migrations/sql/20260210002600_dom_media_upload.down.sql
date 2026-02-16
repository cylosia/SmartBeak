-- Rollback: Remove upload-related columns from media_assets
ALTER TABLE media_assets DROP COLUMN IF EXISTS status;
ALTER TABLE media_assets DROP COLUMN IF EXISTS mime_type;
ALTER TABLE media_assets DROP COLUMN IF EXISTS storage_key;
