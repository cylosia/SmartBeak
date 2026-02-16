-- Rollback: remove columns added by the up migration

DROP TABLE IF EXISTS domain_transfer_log;

ALTER TABLE search_indexes DROP COLUMN IF EXISTS config;
ALTER TABLE indexing_jobs DROP COLUMN IF EXISTS metadata;
ALTER TABLE media_assets DROP COLUMN IF EXISTS metadata;
ALTER TABLE notification_preferences DROP COLUMN IF EXISTS channels;
ALTER TABLE notification_dlq DROP COLUMN IF EXISTS payload;
ALTER TABLE notification_attempts DROP COLUMN IF EXISTS response;
ALTER TABLE publishing_jobs DROP COLUMN IF EXISTS updated_at;
ALTER TABLE publishing_jobs DROP COLUMN IF EXISTS attempt_count;
ALTER TABLE publishing_jobs DROP COLUMN IF EXISTS metadata;
ALTER TABLE content_items DROP COLUMN IF EXISTS metadata;
ALTER TABLE domain_settings DROP COLUMN IF EXISTS settings;
ALTER TABLE org_integrations DROP COLUMN IF EXISTS config;
