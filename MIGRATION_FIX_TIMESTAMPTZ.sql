-- =====================================================
-- MIGRATION: Fix TIMESTAMP to TIMESTAMPTZ
-- HOSTILE AUDIT FIX: 20260210_fix_timestamptz.sql
-- 
-- This migration converts all TIMESTAMP columns to TIMESTAMPTZ
-- to ensure timezone-aware timestamp storage.
-- 
-- WARNING: This migration may take time on large tables.
-- Run during maintenance window for production.
-- =====================================================

-- Start transaction
BEGIN;

-- =====================================================
-- Helper function to convert TIMESTAMP to TIMESTAMPTZ
-- =====================================================

CREATE OR REPLACE FUNCTION convert_timestamp_to_timestamptz(
    p_table_name TEXT,
    p_column_name TEXT,
    p_default_value TEXT DEFAULT 'now()',
    p_is_nullable BOOLEAN DEFAULT true
) RETURNS void AS $$
DECLARE
    v_constraint_name TEXT;
    v_default_sql TEXT;
BEGIN
    -- Build default clause
    IF p_default_value IS NOT NULL THEN
        v_default_sql := format(' DEFAULT %s', p_default_value);
    ELSE
        v_default_sql := '';
    END IF;

    -- Step 1: Add new column with temporary name
    EXECUTE format(
        'ALTER TABLE %I ADD COLUMN %I_tz TIMESTAMPTZ %s %s',
        p_table_name,
        p_column_name,
        CASE WHEN NOT p_is_nullable THEN 'NOT NULL' ELSE '' END,
        v_default_sql
    );

    -- Step 2: Migrate data (assume stored as UTC)
    EXECUTE format(
        'UPDATE %I SET %I_tz = %I AT TIME ZONE ''UTC''',
        p_table_name,
        p_column_name,
        p_column_name
    );

    -- Step 3: Drop old column
    EXECUTE format(
        'ALTER TABLE %I DROP COLUMN %I',
        p_table_name,
        p_column_name
    );

    -- Step 4: Rename new column
    EXECUTE format(
        'ALTER TABLE %I RENAME COLUMN %I_tz TO %I',
        p_table_name,
        p_column_name,
        p_column_name
    );

    RAISE NOTICE 'Converted %.% to TIMESTAMPTZ', p_table_name, p_column_name;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- CORE TABLES (Control Plane)
-- =====================================================

-- organizations table
SELECT convert_timestamp_to_timestamptz('organizations', 'created_at', 'now()', false);

-- users table
SELECT convert_timestamp_to_timestamptz('users', 'created_at', 'now()', false);

-- memberships table
SELECT convert_timestamp_to_timestamptz('memberships', 'created_at', 'now()', false);

-- invites table
SELECT convert_timestamp_to_timestamptz('invites', 'created_at', 'now()', false);
SELECT convert_timestamp_to_timestamptz('invites', 'accepted_at', NULL, true);

-- subscriptions table
SELECT convert_timestamp_to_timestamptz('subscriptions', 'grace_until', NULL, true);
SELECT convert_timestamp_to_timestamptz('subscriptions', 'created_at', 'now()', false);

-- org_usage table
SELECT convert_timestamp_to_timestamptz('org_usage', 'updated_at', 'now()', false);

-- org_onboarding table
SELECT convert_timestamp_to_timestamptz('org_onboarding', 'updated_at', 'now()', false);

-- system_flags table
SELECT convert_timestamp_to_timestamptz('system_flags', 'updated_at', 'now()', false);

-- usage_alerts table
SELECT convert_timestamp_to_timestamptz('usage_alerts', 'created_at', 'now()', false);

-- publishing_dlq table
SELECT convert_timestamp_to_timestamptz('publishing_dlq', 'created_at', 'now()', false);

-- domain_activity table
SELECT convert_timestamp_to_timestamptz('domain_activity', 'last_publish_at', NULL, true);
SELECT convert_timestamp_to_timestamptz('domain_activity', 'last_content_update_at', NULL, true);
SELECT convert_timestamp_to_timestamptz('domain_activity', 'updated_at', 'now()', false);

-- org_integrations table
SELECT convert_timestamp_to_timestamptz('org_integrations', 'created_at', 'now()', false);
SELECT convert_timestamp_to_timestamptz('org_integrations', 'updated_at', 'now()', false);

-- domain_settings table
SELECT convert_timestamp_to_timestamptz('domain_settings', 'created_at', 'now()', false);
SELECT convert_timestamp_to_timestamptz('domain_settings', 'updated_at', 'now()', false);

-- =====================================================
-- CONTENT DOMAIN TABLES
-- =====================================================

-- content_items table
SELECT convert_timestamp_to_timestamptz('content_items', 'publish_at', NULL, true);
SELECT convert_timestamp_to_timestamptz('content_items', 'archived_at', NULL, true);
SELECT convert_timestamp_to_timestamptz('content_items', 'created_at', 'now()', false);
SELECT convert_timestamp_to_timestamptz('content_items', 'updated_at', 'now()', false);

-- content_archive_intents table
SELECT convert_timestamp_to_timestamptz('content_archive_intents', 'requested_at', 'now()', false);
SELECT convert_timestamp_to_timestamptz('content_archive_intents', 'approved_at', NULL, true);

-- content_archive_audit table
SELECT convert_timestamp_to_timestamptz('content_archive_audit', 'performed_at', 'now()', false);

-- content_revisions table
SELECT convert_timestamp_to_timestamptz('content_revisions', 'created_at', 'now()', false);

-- =====================================================
-- AUTHOR & CUSTOMER TABLES
-- =====================================================

-- authors table
SELECT convert_timestamp_to_timestamptz('authors', 'created_at', 'now()', false);
SELECT convert_timestamp_to_timestamptz('authors', 'updated_at', 'now()', false);

-- customer_profiles table
SELECT convert_timestamp_to_timestamptz('customer_profiles', 'created_at', 'now()', false);
SELECT convert_timestamp_to_timestamptz('customer_profiles', 'updated_at', 'now()', false);

-- =====================================================
-- DOMAIN TABLES
-- =====================================================

-- domains table
SELECT convert_timestamp_to_timestamptz('domains', 'created_at', 'now()', false);
SELECT convert_timestamp_to_timestamptz('domains', 'updated_at', 'now()', false);
SELECT convert_timestamp_to_timestamptz('domains', 'archived_at', NULL, true);

-- domain_transfers table
SELECT convert_timestamp_to_timestamptz('domain_transfers', 'created_at', 'now()', false);
SELECT convert_timestamp_to_timestamptz('domain_transfers', 'completed_at', NULL, true);
SELECT convert_timestamp_to_timestamptz('domain_transfers', 'expires_at', NULL, true);

-- domain_registry table
SELECT convert_timestamp_to_timestamptz('domain_registry', 'created_at', 'now()', false);
SELECT convert_timestamp_to_timestamptz('domain_registry', 'updated_at', 'now()', false);

-- =====================================================
-- MEDIA TABLES
-- =====================================================

-- media_assets table
SELECT convert_timestamp_to_timestamptz('media_assets', 'last_accessed_at', NULL, true);

-- =====================================================
-- DILIGENCE TABLES
-- =====================================================

-- diligence_tokens table
SELECT convert_timestamp_to_timestamptz('diligence_tokens', 'expires_at', NULL, false);
SELECT convert_timestamp_to_timestamptz('diligence_tokens', 'used_at', NULL, true);
SELECT convert_timestamp_to_timestamptz('diligence_tokens', 'created_at', 'now()', false);

-- =====================================================
-- NOTIFICATION TABLES
-- =====================================================

-- notifications table
SELECT convert_timestamp_to_timestamptz('notifications', 'created_at', 'now()', false);

-- notification_attempts table
SELECT convert_timestamp_to_timestamptz('notification_attempts', 'created_at', 'now()', false);

-- notification_preferences table
SELECT convert_timestamp_to_timestamptz('notification_preferences', 'created_at', 'now()', false);

-- notification_dlq table
SELECT convert_timestamp_to_timestamptz('notification_dlq', 'created_at', 'now()', false);

-- =====================================================
-- PUBLISHING TABLES
-- =====================================================

-- publish_targets table
SELECT convert_timestamp_to_timestamptz('publish_targets', 'created_at', 'now()', false);

-- publishing_jobs table
SELECT convert_timestamp_to_timestamptz('publishing_jobs', 'created_at', 'now()', false);
SELECT convert_timestamp_to_timestamptz('publishing_jobs', 'published_at', NULL, true);

-- publish_attempts table
SELECT convert_timestamp_to_timestamptz('publish_attempts', 'created_at', 'now()', false);

-- =====================================================
-- SEARCH TABLES
-- =====================================================

-- search_indexes table
SELECT convert_timestamp_to_timestamptz('search_indexes', 'created_at', 'now()', false);

-- search_documents table
SELECT convert_timestamp_to_timestamptz('search_documents', 'updated_at', 'now()', false);

-- indexing_jobs table
SELECT convert_timestamp_to_timestamptz('indexing_jobs', 'created_at', 'now()', false);

-- =====================================================
-- ACTIVITY TABLES
-- =====================================================

-- activity_log table
SELECT convert_timestamp_to_timestamptz('activity_log', 'created_at', 'now()', false);

-- =====================================================
-- MONITORING TABLES
-- =====================================================

-- sequence_monitoring_alerts table
SELECT convert_timestamp_to_timestamptz('sequence_monitoring_alerts', 'created_at', 'now()', false);
SELECT convert_timestamp_to_timestamptz('sequence_monitoring_alerts', 'acknowledged_at', NULL, true);

-- =====================================================
-- CLEANUP
-- =====================================================

-- Drop helper function
DROP FUNCTION IF EXISTS convert_timestamp_to_timestamptz(TEXT, TEXT, TEXT, BOOLEAN);

-- Commit transaction
COMMIT;

-- =====================================================
-- VERIFICATION
-- =====================================================

-- Verify all timestamp columns are now timestamptz
SELECT 
    table_name,
    column_name,
    data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name IN ('created_at', 'updated_at', 'archived_at', 'publish_at', 
                      'expires_at', 'used_at', 'performed_at', 'requested_at',
                      'accepted_at', 'approved_at', 'completed_at', 'last_accessed_at',
                      'last_publish_at', 'last_content_update_at')
ORDER BY table_name, column_name;

\echo 'TIMESTAMP to TIMESTAMPTZ migration complete!'
