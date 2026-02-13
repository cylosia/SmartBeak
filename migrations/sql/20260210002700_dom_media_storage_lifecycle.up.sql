
ALTER TABLE media_assets
ADD COLUMN IF NOT EXISTS last_accessed_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS storage_class TEXT DEFAULT 'hot';

CREATE INDEX IF NOT EXISTS idx_media_lifecycle
ON media_assets (storage_class, last_accessed_at);
