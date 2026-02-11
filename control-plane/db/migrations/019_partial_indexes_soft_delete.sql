-- =====================================================
-- P2 DATABASE OPTIMIZATION: Partial Indexes for Soft Deletes
-- Issue: Partial Indexes for Soft Deletes (2 issues)
--
-- Partial indexes excluding deleted records:
-- - Are smaller (exclude ~20-30% of soft-deleted rows)
-- - Are faster to scan and maintain
-- - Automatically filter out deleted data
--
-- Best practice: Include deleted_at IS NULL in indexes
-- for tables with soft delete patterns.
-- =====================================================

BEGIN;

-- =====================================================
-- 1. EMAIL_SUBSCRIBERS - Active Subscribers Indexes
-- =====================================================

-- Primary lookup for active subscribers by domain
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_email_subscribers_active_domain 
  ON email_subscribers(domain_id, created_at DESC) 
  WHERE deleted_at IS NULL;

-- Status-based queries for active subscribers only
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_email_subscribers_active_status 
  ON email_subscribers(domain_id, status, updated_at DESC) 
  WHERE deleted_at IS NULL;

-- Active subscribers by email hash (for lookups)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_email_subscribers_active_email 
  ON email_subscribers(email_hash) 
  WHERE deleted_at IS NULL;

-- Opt-in status for active subscribers
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_email_subscribers_active_optin 
  ON email_subscribers(domain_id, optin_status, created_at) 
  WHERE deleted_at IS NULL AND optin_status IN ('confirmed', 'pending');

COMMENT ON INDEX idx_email_subscribers_active_domain IS 
  'Partial index: Active subscribers only, excludes soft-deleted records';
COMMENT ON INDEX idx_email_subscribers_active_status IS 
  'Partial index: Active subscribers filtered by status';

-- =====================================================
-- 2. CONTENT TABLE - Active Content Indexes
-- =====================================================

-- Active content by domain and status
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_content_active_domain_status 
  ON content(domain_id, status, updated_at DESC) 
  WHERE deleted_at IS NULL;

-- Published content only (most common query)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_content_published_active 
  ON content(domain_id, published_at DESC) 
  WHERE deleted_at IS NULL AND status = 'published';

-- Draft content for editing
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_content_drafts_active 
  ON content(domain_id, updated_at DESC) 
  WHERE deleted_at IS NULL AND status = 'draft';

-- Scheduled content (for publishing jobs)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_content_scheduled_active 
  ON content(domain_id, scheduled_publish_at) 
  WHERE deleted_at IS NULL AND status = 'scheduled';

-- Content by author (active only)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_content_active_author 
  ON content(author_id, updated_at DESC) 
  WHERE deleted_at IS NULL;

COMMENT ON INDEX idx_content_published_active IS 
  'Partial index: Published content only, excludes deleted/archived';
COMMENT ON INDEX idx_content_drafts_active IS 
  'Partial index: Draft content for editor UI';

-- =====================================================
-- 3. ADDITIONAL TABLES - Soft Delete Partial Indexes
-- =====================================================

-- DOMAINS - Active domains only
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_domains_active 
  ON domains(org_id, created_at DESC) 
  WHERE deleted_at IS NULL;

-- MEDIA_ASSETS - Active assets only
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_media_assets_active 
  ON media_assets(domain_id, created_at DESC) 
  WHERE deleted_at IS NULL;

-- NOTIFICATIONS - Active notifications (if soft-deleted)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_active 
  ON notifications(user_id, created_at DESC) 
  WHERE deleted_at IS NULL AND status != 'archived';

-- PUBLISHING_JOBS - Active jobs only
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_publishing_jobs_active 
  ON publishing_jobs(domain_id, created_at DESC) 
  WHERE deleted_at IS NULL;

-- ORGANIZATIONS - Active orgs (for platform admin)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_organizations_active 
  ON organizations(created_at DESC) 
  WHERE deleted_at IS NULL;

COMMENT ON INDEX idx_domains_active IS 
  'Partial index: Active domains only, excludes deleted domains';
COMMENT ON INDEX idx_organizations_active IS 
  'Partial index: Active organizations for admin queries';

COMMIT;

-- =====================================================
-- SIZE COMPARISON (run after some data accumulation)
-- =====================================================

/*
-- Compare partial vs full index sizes:
SELECT 
    schemaname,
    tablename,
    indexname,
    pg_size_pretty(pg_relation_size(indexrelid)) as index_size,
    idx_scan as index_scans,
    idx_tup_read as tuples_read,
    idx_tup_fetch as tuples_fetched
FROM pg_stat_user_indexes
WHERE indexname LIKE '%active%' OR indexname LIKE '%_active'
ORDER BY pg_relation_size(indexrelid) DESC;
*/

-- Update statistics for partial indexes
ANALYZE email_subscribers;
ANALYZE content;
ANALYZE domains;
ANALYZE media_assets;
ANALYZE notifications;
ANALYZE publishing_jobs;
ANALYZE organizations;
