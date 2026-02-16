-- Rollback: Drop partial indexes for soft deletes

-- Email subscribers partial indexes (may not exist)
DO $$ BEGIN
  DROP INDEX IF EXISTS idx_email_subscribers_active_domain;
  DROP INDEX IF EXISTS idx_email_subscribers_active_status;
  DROP INDEX IF EXISTS idx_email_subscribers_active_email;
  DROP INDEX IF EXISTS idx_email_subscribers_active_optin;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Content partial indexes (may not exist)
DO $$ BEGIN
  DROP INDEX IF EXISTS idx_content_active_domain_status;
  DROP INDEX IF EXISTS idx_content_published_active;
  DROP INDEX IF EXISTS idx_content_drafts_active;
  DROP INDEX IF EXISTS idx_content_scheduled_active;
  DROP INDEX IF EXISTS idx_content_active_author;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Additional soft delete partial indexes (may not exist)
DO $$ BEGIN
  DROP INDEX IF EXISTS idx_domains_active;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  DROP INDEX IF EXISTS idx_media_assets_active;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  DROP INDEX IF EXISTS idx_notifications_active;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  DROP INDEX IF EXISTS idx_publishing_jobs_active;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  DROP INDEX IF EXISTS idx_organizations_active;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
