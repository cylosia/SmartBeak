-- Rollback: Remove domain-scoped columns from content_items, drop archive tables
DROP INDEX IF EXISTS idx_archive_audit_content;
DROP TABLE IF EXISTS content_archive_audit CASCADE;

DROP INDEX IF EXISTS idx_archive_intents_content;
DROP TABLE IF EXISTS content_archive_intents CASCADE;

DROP INDEX IF EXISTS idx_content_items_domain;
ALTER TABLE content_items DROP COLUMN IF EXISTS archived_at;
ALTER TABLE content_items DROP COLUMN IF EXISTS updated_at;
ALTER TABLE content_items DROP COLUMN IF EXISTS created_at;
ALTER TABLE content_items DROP COLUMN IF EXISTS content_type;
ALTER TABLE content_items DROP COLUMN IF EXISTS domain_id;
