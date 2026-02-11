-- =====================================================
-- CRITICAL DATABASE FIXES - HOSTILE AUDIT 2026-02-10
-- 
-- WARNING: Test in staging before running in production
-- Some migrations require downtime or CONCURRENTLY option
-- =====================================================

-- Start transaction
BEGIN;

-- =====================================================
-- SECTION 1: FOREIGN KEY CASCADE FIXES
-- Add missing ON DELETE actions
-- =====================================================

-- Fix subscriptions foreign keys
ALTER TABLE subscriptions 
  DROP CONSTRAINT IF EXISTS subscriptions_org_id_fkey,
  ADD CONSTRAINT subscriptions_org_id_fkey 
    FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE subscriptions 
  DROP CONSTRAINT IF EXISTS subscriptions_plan_id_fkey,
  ADD CONSTRAINT subscriptions_plan_id_fkey 
    FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE SET NULL;

-- Fix usage_alerts foreign key
ALTER TABLE usage_alerts 
  DROP CONSTRAINT IF EXISTS usage_alerts_org_id_fkey,
  ADD CONSTRAINT usage_alerts_org_id_fkey 
    FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;

-- Fix org_integrations foreign key  
ALTER TABLE org_integrations
  DROP CONSTRAINT IF EXISTS org_integrations_org_id_fkey,
  ADD CONSTRAINT org_integrations_org_id_fkey
    FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;

-- Fix domain_transfer_log foreign keys
ALTER TABLE domain_transfer_log
  DROP CONSTRAINT IF EXISTS domain_transfer_log_domain_id_fkey,
  ADD CONSTRAINT domain_transfer_log_domain_id_fkey
    FOREIGN KEY (domain_id) REFERENCES domain_registry(id) ON DELETE CASCADE;

ALTER TABLE domain_transfer_log
  DROP CONSTRAINT IF EXISTS domain_transfer_log_transferred_by_fkey,
  ADD CONSTRAINT domain_transfer_log_transferred_by_fkey
    FOREIGN KEY (transferred_by) REFERENCES users(id) ON DELETE SET NULL;

-- =====================================================
-- SECTION 2: GIN INDEXES FOR JSONB COLUMNS
-- Using CONCURRENTLY to avoid locking (run manually)
-- =====================================================

-- Activity log metadata
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activity_log_metadata_gin 
  ON activity_log USING GIN (metadata);

-- Domain registry custom config
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_domain_registry_config_gin 
  ON domain_registry USING GIN (custom_config);

-- Notifications payload  
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_payload_gin
  ON notifications USING GIN (payload);

-- Publishing targets config
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_publish_targets_config_gin
  ON publish_targets USING GIN (config);

-- Search documents fields (if not already indexed by FTS)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_search_documents_fields_gin
  ON search_documents USING GIN (fields);

-- =====================================================
-- SECTION 3: COMPOSITE INDEXES FOR COMMON PATTERNS
-- =====================================================

-- Content items: domain + status + publish_at for scheduling queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_content_items_domain_status_publish 
  ON content_items (domain_id, status, publish_at) 
  WHERE status = 'scheduled';

-- Content items: domain + updated_at for listing
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_content_items_domain_updated 
  ON content_items (domain_id, updated_at DESC NULLS LAST);

-- Notifications: org + user + status for pending list
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_org_user_status
  ON notifications (org_id, user_id, status, created_at)
  WHERE status IN ('pending', 'failed');

-- Publishing jobs: domain + status
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_publishing_jobs_domain_status
  ON publishing_jobs (domain_id, status, created_at DESC);

-- Content revisions: content_id + created_at
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_content_revisions_content_created
  ON content_revisions (content_id, created_at DESC);

-- =====================================================
-- SECTION 4: UNIQUE CONSTRAINTS
-- =====================================================

-- Authors: prevent duplicate names per domain
ALTER TABLE authors 
  ADD CONSTRAINT IF NOT EXISTS uq_authors_domain_name 
  UNIQUE (domain_id, name);

-- Customer profiles: prevent duplicate names per domain  
ALTER TABLE customer_profiles
  ADD CONSTRAINT IF NOT EXISTS uq_customer_profiles_domain_name
  UNIQUE (domain_id, name);

-- Domain registry: buyer_token should be unique
ALTER TABLE domain_registry
  ADD CONSTRAINT IF NOT EXISTS uq_domain_registry_buyer_token
  UNIQUE (buyer_token);

-- =====================================================
-- SECTION 5: NOT NULL CONSTRAINTS
-- =====================================================

-- Content items: content_type should not be null
ALTER TABLE content_items 
  ALTER COLUMN content_type SET NOT NULL,
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET NOT NULL;

-- Organizations: name should not be null  
ALTER TABLE organizations
  ALTER COLUMN name SET NOT NULL;

-- Users: email should not be null
ALTER TABLE users
  ALTER COLUMN email SET NOT NULL;

-- =====================================================
-- SECTION 6: STATEMENT TIMEOUT SETTING
-- Set default for future sessions
-- =====================================================

-- Set default statement timeout (30 seconds)
ALTER DATABASE CURRENT SET statement_timeout = '30s';
ALTER DATABASE CURRENT SET idle_in_transaction_session_timeout = '60s';

-- =====================================================
-- SECTION 7: COMMENTS FOR DOCUMENTATION
-- =====================================================

COMMENT ON TABLE content_items IS 'Content items with timezone-aware timestamps and proper constraints';
COMMENT ON TABLE notifications IS 'Notifications with JSONB payload indexed for queries';
COMMENT ON TABLE activity_log IS 'Activity log with GIN index on metadata for filtering';

-- Commit all changes
COMMIT;

-- =====================================================
-- SECTION 8: POST-MIGRATION VERIFICATION
-- Run these after the above commits successfully
-- =====================================================

-- Verify foreign keys
\echo 'Verifying foreign keys...'
SELECT 
    tc.table_name, 
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name,
    rc.delete_rule
FROM information_schema.table_constraints AS tc 
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
JOIN information_schema.referential_constraints AS rc
    ON rc.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY';

-- Verify indexes
\echo 'Verifying GIN indexes...'
SELECT indexname, tablename 
FROM pg_indexes 
WHERE indexname LIKE '%gin%' OR indexname LIKE '%_gin';

-- Verify composite indexes
\echo 'Verifying composite indexes...'
SELECT indexname, tablename, indexdef
FROM pg_indexes
WHERE indexdef LIKE '%(%%,%%)%' AND schemaname = 'public';

\echo 'Critical fixes applied successfully!'
