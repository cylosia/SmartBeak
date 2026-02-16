-- Rollback: Reverse P0 critical fixes (TIMESTAMPTZ, FK cascades, GIN indexes, composite indexes)

-- =====================================================
-- SECTION 4 ROLLBACK: Drop composite indexes
-- =====================================================
DROP INDEX IF EXISTS idx_content_items_domain_status_publish;
DROP INDEX IF EXISTS idx_content_items_domain_updated;
DROP INDEX IF EXISTS idx_notifications_org_user_status;
DROP INDEX IF EXISTS idx_publishing_jobs_domain_status;
DROP INDEX IF EXISTS idx_content_revisions_content_created;
DROP INDEX IF EXISTS idx_notifications_user_status;
DROP INDEX IF EXISTS idx_publishing_jobs_status_attempts;
DROP INDEX IF EXISTS idx_activity_log_org_created;
DROP INDEX IF EXISTS idx_memberships_org_role;
DROP INDEX IF EXISTS idx_search_documents_index_updated;

DO $$ BEGIN
  DROP INDEX IF EXISTS idx_media_assets_domain_type;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  DROP INDEX IF EXISTS idx_diligence_tokens_org_expires;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- =====================================================
-- SECTION 3 ROLLBACK: Drop GIN indexes
-- =====================================================
DROP INDEX IF EXISTS idx_activity_log_metadata_gin;
DROP INDEX IF EXISTS idx_domain_registry_config_gin;
DROP INDEX IF EXISTS idx_notifications_payload_gin;
DROP INDEX IF EXISTS idx_publish_targets_config_gin;
DROP INDEX IF EXISTS idx_search_documents_fields_gin;
DROP INDEX IF EXISTS idx_org_integrations_config_gin;
DROP INDEX IF EXISTS idx_domain_settings_settings_gin;
DROP INDEX IF EXISTS idx_content_items_metadata_gin;
DROP INDEX IF EXISTS idx_publishing_jobs_metadata_gin;
DROP INDEX IF EXISTS idx_notification_attempts_response_gin;
DROP INDEX IF EXISTS idx_notification_dlq_payload_gin;
DROP INDEX IF EXISTS idx_notification_preferences_channels_gin;
DROP INDEX IF EXISTS idx_media_assets_metadata_gin;
DROP INDEX IF EXISTS idx_indexing_jobs_metadata_gin;
DROP INDEX IF EXISTS idx_search_indexes_config_gin;

-- =====================================================
-- SECTION 2 ROLLBACK: Revert FK cascades to original (no cascade)
-- =====================================================
ALTER TABLE subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_org_id_fkey,
  ADD CONSTRAINT subscriptions_org_id_fkey
    FOREIGN KEY (org_id) REFERENCES organizations(id);

ALTER TABLE subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_plan_id_fkey,
  ADD CONSTRAINT subscriptions_plan_id_fkey
    FOREIGN KEY (plan_id) REFERENCES plans(id);

ALTER TABLE usage_alerts
  DROP CONSTRAINT IF EXISTS usage_alerts_org_id_fkey,
  ADD CONSTRAINT usage_alerts_org_id_fkey
    FOREIGN KEY (org_id) REFERENCES organizations(id);

DO $$ BEGIN
  ALTER TABLE org_integrations
    DROP CONSTRAINT IF EXISTS org_integrations_org_id_fkey,
    ADD CONSTRAINT org_integrations_org_id_fkey
      FOREIGN KEY (org_id) REFERENCES organizations(id);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE domain_transfer_log
    DROP CONSTRAINT IF EXISTS domain_transfer_log_domain_id_fkey;
  ALTER TABLE domain_transfer_log
    DROP CONSTRAINT IF EXISTS domain_transfer_log_transferred_by_fkey;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

ALTER TABLE publishing_dlq
  DROP CONSTRAINT IF EXISTS publishing_dlq_publishing_job_id_fkey,
  ADD CONSTRAINT publishing_dlq_publishing_job_id_fkey
    FOREIGN KEY (publishing_job_id) REFERENCES publishing_jobs(id);

ALTER TABLE content_revisions
  DROP CONSTRAINT IF EXISTS content_revisions_content_id_fkey,
  ADD CONSTRAINT content_revisions_content_id_fkey
    FOREIGN KEY (content_id) REFERENCES content_items(id);

-- =====================================================
-- SECTION 1 ROLLBACK: Revert TIMESTAMPTZ back to TIMESTAMP
-- =====================================================
ALTER TABLE organizations
  ALTER COLUMN created_at TYPE TIMESTAMP USING created_at AT TIME ZONE 'UTC';

ALTER TABLE users
  ALTER COLUMN created_at TYPE TIMESTAMP USING created_at AT TIME ZONE 'UTC';

ALTER TABLE memberships
  ALTER COLUMN created_at TYPE TIMESTAMP USING created_at AT TIME ZONE 'UTC';

ALTER TABLE invites
  ALTER COLUMN created_at TYPE TIMESTAMP USING created_at AT TIME ZONE 'UTC';

ALTER TABLE invites
  ALTER COLUMN accepted_at TYPE TIMESTAMP USING accepted_at AT TIME ZONE 'UTC';

ALTER TABLE subscriptions
  ALTER COLUMN created_at TYPE TIMESTAMP USING created_at AT TIME ZONE 'UTC';

ALTER TABLE subscriptions
  ALTER COLUMN grace_until TYPE TIMESTAMP USING grace_until AT TIME ZONE 'UTC';

ALTER TABLE org_usage
  ALTER COLUMN updated_at TYPE TIMESTAMP USING updated_at AT TIME ZONE 'UTC';

ALTER TABLE org_onboarding
  ALTER COLUMN updated_at TYPE TIMESTAMP USING updated_at AT TIME ZONE 'UTC';

ALTER TABLE system_flags
  ALTER COLUMN updated_at TYPE TIMESTAMP USING updated_at AT TIME ZONE 'UTC';

ALTER TABLE usage_alerts
  ALTER COLUMN created_at TYPE TIMESTAMP USING created_at AT TIME ZONE 'UTC';

ALTER TABLE publishing_dlq
  ALTER COLUMN created_at TYPE TIMESTAMP USING created_at AT TIME ZONE 'UTC';

ALTER TABLE domain_activity
  ALTER COLUMN last_publish_at TYPE TIMESTAMP USING last_publish_at AT TIME ZONE 'UTC';

ALTER TABLE domain_activity
  ALTER COLUMN last_content_update_at TYPE TIMESTAMP USING last_content_update_at AT TIME ZONE 'UTC';

ALTER TABLE domain_activity
  ALTER COLUMN updated_at TYPE TIMESTAMP USING updated_at AT TIME ZONE 'UTC';

ALTER TABLE org_integrations
  ALTER COLUMN created_at TYPE TIMESTAMP USING created_at AT TIME ZONE 'UTC';

ALTER TABLE org_integrations
  ALTER COLUMN updated_at TYPE TIMESTAMP USING updated_at AT TIME ZONE 'UTC';

ALTER TABLE domain_settings
  ALTER COLUMN created_at TYPE TIMESTAMP USING created_at AT TIME ZONE 'UTC';

ALTER TABLE domain_settings
  ALTER COLUMN updated_at TYPE TIMESTAMP USING updated_at AT TIME ZONE 'UTC';

ALTER TABLE content_items
  ALTER COLUMN created_at TYPE TIMESTAMP USING created_at AT TIME ZONE 'UTC';
