-- =====================================================
-- P0-CRITICAL DATABASE FIXES - Batch 2
-- HOSTILE AUDIT FIX: 20260210
-- 
-- This migration addresses:
-- 1. TIMESTAMP WITHOUT TIMEZONE (first 20 columns)
-- 2. MISSING ON DELETE CASCADE (all 8 FKs)
-- 3. JSONB WITHOUT GIN INDEXES (first 15 tables)
-- 4. MISSING COMPOSITE INDEXES (all 12)
-- =====================================================

-- Start transaction

-- =====================================================
-- SECTION 1: TIMESTAMP WITHOUT TIMEZONE FIXES
-- Convert first 20 TIMESTAMP columns to TIMESTAMPTZ
-- =====================================================

-- organizations.created_at
ALTER TABLE organizations 
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';

-- users.created_at  
ALTER TABLE users 
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';

-- memberships.created_at
ALTER TABLE memberships 
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';

-- invites.created_at
ALTER TABLE invites 
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';

-- invites.accepted_at
ALTER TABLE invites 
  ALTER COLUMN accepted_at TYPE TIMESTAMPTZ USING accepted_at AT TIME ZONE 'UTC';

-- subscriptions.created_at
ALTER TABLE subscriptions 
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';

-- subscriptions.grace_until
ALTER TABLE subscriptions 
  ALTER COLUMN grace_until TYPE TIMESTAMPTZ USING grace_until AT TIME ZONE 'UTC';

-- org_usage.updated_at
ALTER TABLE org_usage 
  ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';

-- org_onboarding.updated_at
ALTER TABLE org_onboarding 
  ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';

-- system_flags.updated_at
ALTER TABLE system_flags 
  ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';

-- usage_alerts.created_at
ALTER TABLE usage_alerts 
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';

-- publishing_dlq.created_at
ALTER TABLE publishing_dlq 
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';

-- domain_activity.last_publish_at
ALTER TABLE domain_activity 
  ALTER COLUMN last_publish_at TYPE TIMESTAMPTZ USING last_publish_at AT TIME ZONE 'UTC';

-- domain_activity.last_content_update_at
ALTER TABLE domain_activity 
  ALTER COLUMN last_content_update_at TYPE TIMESTAMPTZ USING last_content_update_at AT TIME ZONE 'UTC';

-- domain_activity.updated_at
ALTER TABLE domain_activity 
  ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';

-- org_integrations.created_at
ALTER TABLE org_integrations 
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';

-- org_integrations.updated_at
ALTER TABLE org_integrations 
  ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';

-- domain_settings.created_at
ALTER TABLE domain_settings 
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';

-- domain_settings.updated_at
ALTER TABLE domain_settings 
  ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';

-- content_items.created_at
ALTER TABLE content_items 
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';

-- =====================================================
-- SECTION 2: MISSING ON DELETE CASCADE (8 Foreign Keys)
-- =====================================================

-- FK 1: subscriptions.org_id
ALTER TABLE subscriptions 
  DROP CONSTRAINT IF EXISTS subscriptions_org_id_fkey,
  ADD CONSTRAINT subscriptions_org_id_fkey 
    FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;

-- FK 2: subscriptions.plan_id  
ALTER TABLE subscriptions 
  DROP CONSTRAINT IF EXISTS subscriptions_plan_id_fkey,
  ADD CONSTRAINT subscriptions_plan_id_fkey 
    FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE SET NULL;

-- FK 3: usage_alerts.org_id
ALTER TABLE usage_alerts 
  DROP CONSTRAINT IF EXISTS usage_alerts_org_id_fkey,
  ADD CONSTRAINT usage_alerts_org_id_fkey 
    FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;

-- FK 4: org_integrations.org_id
ALTER TABLE org_integrations
  DROP CONSTRAINT IF EXISTS org_integrations_org_id_fkey,
  ADD CONSTRAINT org_integrations_org_id_fkey
    FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;

-- FK 5: domain_transfer_log.domain_id
ALTER TABLE domain_transfer_log
  DROP CONSTRAINT IF EXISTS domain_transfer_log_domain_id_fkey,
  ADD CONSTRAINT domain_transfer_log_domain_id_fkey
    FOREIGN KEY (domain_id) REFERENCES domain_registry(id) ON DELETE CASCADE;

-- FK 6: domain_transfer_log.transferred_by
ALTER TABLE domain_transfer_log
  DROP CONSTRAINT IF EXISTS domain_transfer_log_transferred_by_fkey,
  ADD CONSTRAINT domain_transfer_log_transferred_by_fkey
    FOREIGN KEY (transferred_by) REFERENCES users(id) ON DELETE SET NULL;

-- FK 7: publishing_dlq.publishing_job_id
ALTER TABLE publishing_dlq
  DROP CONSTRAINT IF EXISTS publishing_dlq_publishing_job_id_fkey,
  ADD CONSTRAINT publishing_dlq_publishing_job_id_fkey
    FOREIGN KEY (publishing_job_id) REFERENCES publishing_jobs(id) ON DELETE CASCADE;

-- FK 8: content_revisions.content_id
ALTER TABLE content_revisions
  DROP CONSTRAINT IF EXISTS content_revisions_content_id_fkey,
  ADD CONSTRAINT content_revisions_content_id_fkey
    FOREIGN KEY (content_id) REFERENCES content_items(id) ON DELETE CASCADE;

-- =====================================================
-- SECTION 3: JSONB GIN INDEXES (First 15 tables)
-- =====================================================

-- 1. activity_log.metadata
CREATE INDEX IF NOT EXISTS idx_activity_log_metadata_gin 
  ON activity_log USING GIN (metadata);

-- 2. domain_registry.custom_config
CREATE INDEX IF NOT EXISTS idx_domain_registry_config_gin 
  ON domain_registry USING GIN (custom_config);

-- 3. notifications.payload
CREATE INDEX IF NOT EXISTS idx_notifications_payload_gin
  ON notifications USING GIN (payload);

-- 4. publish_targets.config
CREATE INDEX IF NOT EXISTS idx_publish_targets_config_gin
  ON publish_targets USING GIN (config);

-- 5. search_documents.fields
CREATE INDEX IF NOT EXISTS idx_search_documents_fields_gin
  ON search_documents USING GIN (fields);

-- 6. org_integrations.config
CREATE INDEX IF NOT EXISTS idx_org_integrations_config_gin
  ON org_integrations USING GIN (config);

-- 7. domain_settings.settings
CREATE INDEX IF NOT EXISTS idx_domain_settings_settings_gin
  ON domain_settings USING GIN (settings);

-- 8. content_items.metadata
CREATE INDEX IF NOT EXISTS idx_content_items_metadata_gin
  ON content_items USING GIN (metadata);

-- 9. publishing_jobs.metadata
CREATE INDEX IF NOT EXISTS idx_publishing_jobs_metadata_gin
  ON publishing_jobs USING GIN (metadata);

-- 10. notification_attempts.response
CREATE INDEX IF NOT EXISTS idx_notification_attempts_response_gin
  ON notification_attempts USING GIN (response);

-- 11. notification_dlq.payload
CREATE INDEX IF NOT EXISTS idx_notification_dlq_payload_gin
  ON notification_dlq USING GIN (payload);

-- 12. notification_preferences.channels
CREATE INDEX IF NOT EXISTS idx_notification_preferences_channels_gin
  ON notification_preferences USING GIN (channels);

-- 13. media_assets.metadata
CREATE INDEX IF NOT EXISTS idx_media_assets_metadata_gin
  ON media_assets USING GIN (metadata);

-- 14. indexing_jobs.metadata
CREATE INDEX IF NOT EXISTS idx_indexing_jobs_metadata_gin
  ON indexing_jobs USING GIN (metadata);

-- 15. search_indexes.config
CREATE INDEX IF NOT EXISTS idx_search_indexes_config_gin
  ON search_indexes USING GIN (config);

-- =====================================================
-- SECTION 4: COMPOSITE INDEXES (All 12)
-- =====================================================

-- 1. content_items: domain + status + publish_at for scheduling
CREATE INDEX IF NOT EXISTS idx_content_items_domain_status_publish 
  ON content_items (domain_id, status, publish_at) 
  WHERE status = 'scheduled';

-- 2. content_items: domain + updated_at for listing
CREATE INDEX IF NOT EXISTS idx_content_items_domain_updated 
  ON content_items (domain_id, updated_at DESC NULLS LAST);

-- 3. notifications: org + user + status for pending list
CREATE INDEX IF NOT EXISTS idx_notifications_org_user_status
  ON notifications (org_id, user_id, status, created_at)
  WHERE status IN ('pending', 'failed');

-- 4. publishing_jobs: domain + status
CREATE INDEX IF NOT EXISTS idx_publishing_jobs_domain_status
  ON publishing_jobs (domain_id, status, created_at DESC);

-- 5. content_revisions: content_id + created_at
CREATE INDEX IF NOT EXISTS idx_content_revisions_content_created
  ON content_revisions (content_id, created_at DESC);

-- 6. notifications: user + status
CREATE INDEX IF NOT EXISTS idx_notifications_user_status
  ON notifications (user_id, status, created_at DESC);

-- 7. publishing_jobs: status + attempt_count for pending queue
CREATE INDEX IF NOT EXISTS idx_publishing_jobs_status_attempts
  ON publishing_jobs (status, attempt_count ASC, id ASC)
  WHERE status IN ('pending', 'failed');

-- 8. activity_log: org + created_at
CREATE INDEX IF NOT EXISTS idx_activity_log_org_created
  ON activity_log (org_id, created_at DESC);

-- 9. memberships: org_id + role
CREATE INDEX IF NOT EXISTS idx_memberships_org_role
  ON memberships (org_id, role);

-- 10. media_assets: domain + type
CREATE INDEX IF NOT EXISTS idx_media_assets_domain_type
  ON media_assets (domain_id, type, created_at DESC);

-- 11. search_documents: index_id + updated_at
CREATE INDEX IF NOT EXISTS idx_search_documents_index_updated
  ON search_documents (index_id, updated_at DESC);

-- 12. diligence_tokens: org + expires_at
CREATE INDEX IF NOT EXISTS idx_diligence_tokens_org_expires
  ON diligence_tokens (org_id, expires_at);

-- Commit all changes

-- =====================================================
-- SECTION 5: VERIFICATION QUERIES
-- Run after successful commit
-- =====================================================

-- Verify timestamp columns converted
SELECT 
    table_name,
    column_name,
    data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name IN ('created_at', 'updated_at', 'accepted_at', 'grace_until', 
                      'last_publish_at', 'last_content_update_at')
ORDER BY table_name, column_name;

-- Verify foreign keys with ON DELETE actions
SELECT 
    tc.table_name, 
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    rc.delete_rule
FROM information_schema.table_constraints AS tc 
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
JOIN information_schema.referential_constraints AS rc
    ON rc.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_name IN ('subscriptions', 'usage_alerts', 'org_integrations', 
                        'domain_transfer_log', 'publishing_dlq', 'content_revisions');

-- Verify GIN indexes created
SELECT indexname, tablename 
FROM pg_indexes 
WHERE indexname LIKE '%gin%' OR indexname LIKE '%_gin'
ORDER BY tablename, indexname;

-- Verify composite indexes
SELECT indexname, tablename, indexdef
FROM pg_indexes
WHERE indexdef LIKE '%(%%,%%)%' 
  AND schemaname = 'public'
ORDER BY tablename, indexname;
