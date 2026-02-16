-- Rollback: Remove publish_at column from content_items
ALTER TABLE content_items DROP COLUMN IF EXISTS publish_at;
