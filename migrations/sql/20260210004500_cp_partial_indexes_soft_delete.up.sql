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


-- =====================================================
-- 1. EMAIL_SUBSCRIBERS - Active Subscribers Indexes
-- (Skip if table does not exist)
-- =====================================================
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_email_subscribers_active_domain
    ON email_subscribers(domain_id, created_at DESC)
    WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_email_subscribers_active_status
    ON email_subscribers(domain_id, status, updated_at DESC)
    WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_email_subscribers_active_email
    ON email_subscribers(email_hash)
    WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_email_subscribers_active_optin
    ON email_subscribers(domain_id, optin_status, created_at)
    WHERE deleted_at IS NULL AND optin_status IN ('confirmed', 'pending');
EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
END $$;

-- =====================================================
-- 2. CONTENT TABLE - Active Content Indexes
-- (Skip if table does not exist -- actual table is content_items)
-- =====================================================
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_content_active_domain_status
    ON content(domain_id, status, updated_at DESC)
    WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_content_published_active
    ON content(domain_id, published_at DESC)
    WHERE deleted_at IS NULL AND status = 'published';
  CREATE INDEX IF NOT EXISTS idx_content_drafts_active
    ON content(domain_id, updated_at DESC)
    WHERE deleted_at IS NULL AND status = 'draft';
  CREATE INDEX IF NOT EXISTS idx_content_scheduled_active
    ON content(domain_id, scheduled_publish_at)
    WHERE deleted_at IS NULL AND status = 'scheduled';
  CREATE INDEX IF NOT EXISTS idx_content_active_author
    ON content(author_id, updated_at DESC)
    WHERE deleted_at IS NULL;
EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
END $$;

-- =====================================================
-- 3. ADDITIONAL TABLES - Soft Delete Partial Indexes
-- (Skip columns/tables that don't exist)
-- =====================================================

-- DOMAINS - Active domains only (skip if deleted_at column absent)
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_domains_active
    ON domains(org_id, created_at DESC)
    WHERE deleted_at IS NULL;
EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
END $$;

-- MEDIA_ASSETS - Active assets only (skip if column absent)
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_media_assets_active
    ON media_assets(domain_id, created_at DESC)
    WHERE deleted_at IS NULL;
EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
END $$;

-- NOTIFICATIONS - Active notifications (skip if column absent)
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_notifications_active
    ON notifications(user_id, created_at DESC)
    WHERE deleted_at IS NULL AND status != 'archived';
EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
END $$;

-- PUBLISHING_JOBS - Active jobs only (skip if column absent)
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_publishing_jobs_active
    ON publishing_jobs(domain_id, created_at DESC)
    WHERE deleted_at IS NULL;
EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
END $$;

-- ORGANIZATIONS - Active orgs (skip if column absent)
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_organizations_active
    ON organizations(created_at DESC)
    WHERE deleted_at IS NULL;
EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
END $$;

-- =====================================================
-- Update statistics (skip tables that don't exist)
-- =====================================================
DO $$ BEGIN EXECUTE 'ANALYZE email_subscribers'; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'ANALYZE content'; EXCEPTION WHEN undefined_table THEN NULL; END $$;
ANALYZE domains;
ANALYZE media_assets;
ANALYZE notifications;
ANALYZE publishing_jobs;
ANALYZE organizations;
