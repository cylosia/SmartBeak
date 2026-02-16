-- =====================================================
-- P2 DATABASE OPTIMIZATION: Foreign Key Indexes
-- Issue: Foreign Key Constraints Without Indexes (5 issues)
--
-- Foreign key columns without indexes cause:
-- - Slow cascading deletes
-- - Table locks during parent updates/deletes
-- - Poor query performance on FK lookups
-- =====================================================


-- =====================================================
-- 1. INVITES TABLE - Add missing FK indexes
-- =====================================================
-- Index for org_id (FK to organizations)
CREATE INDEX IF NOT EXISTS idx_invites_org_id
  ON invites(org_id);

-- Index for email lookups (common query pattern)
CREATE INDEX IF NOT EXISTS idx_invites_email
  ON invites(email);

-- Partial index for pending invites (excludes accepted)
CREATE INDEX IF NOT EXISTS idx_invites_pending
  ON invites(org_id, created_at)
  WHERE accepted_at IS NULL;

COMMENT ON INDEX idx_invites_org_id IS
  'FK index: Prevents table locks on organization deletes';
COMMENT ON INDEX idx_invites_pending IS
  'Partial index: Fast queries for pending invites only';

-- =====================================================
-- 2. EMAIL_SUBSCRIBERS TABLE - Add missing FK indexes
-- (Skip if table does not exist)
-- =====================================================
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_email_subscribers_domain_id
    ON email_subscribers(domain_id);
  CREATE INDEX IF NOT EXISTS idx_email_subscribers_org_id
    ON email_subscribers(org_id);
  CREATE INDEX IF NOT EXISTS idx_email_subscribers_email_hash
    ON email_subscribers(email_hash);
  CREATE INDEX IF NOT EXISTS idx_email_subscribers_domain_list
    ON email_subscribers(domain_id, created_at DESC)
    WHERE status != 'deleted';
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- =====================================================
-- 3. CONTENT TABLE - Add missing FK indexes
-- (Skip if table does not exist -- actual table is content_items)
-- =====================================================
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_content_domain_id
    ON content(domain_id);
  CREATE INDEX IF NOT EXISTS idx_content_org_id
    ON content(org_id);
  CREATE INDEX IF NOT EXISTS idx_content_author_id
    ON content(author_id);
  CREATE INDEX IF NOT EXISTS idx_content_published
    ON content(domain_id, published_at DESC)
    WHERE status = 'published' AND deleted_at IS NULL;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- =====================================================
-- 4. PUBLISH_INTENTS TABLE - Add missing FK indexes
-- (Skip if table does not yet exist)
-- =====================================================
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_publish_intents_org_id
    ON publish_intents(org_id);
  CREATE INDEX IF NOT EXISTS idx_publish_intents_domain_id
    ON publish_intents(domain_id);
  CREATE INDEX IF NOT EXISTS idx_publish_intents_draft_id
    ON publish_intents(draft_id);
  CREATE INDEX IF NOT EXISTS idx_publish_intents_status
    ON publish_intents(status, created_at)
    WHERE status IN ('pending', 'scheduled');
  CREATE INDEX IF NOT EXISTS idx_publish_intents_scheduled
    ON publish_intents(scheduled_for)
    WHERE scheduled_for IS NOT NULL AND status = 'scheduled';
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- =====================================================
-- 5. JOB_EXECUTIONS TABLE - Add missing FK indexes
-- (Skip if table does not yet exist)
-- =====================================================
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_job_executions_org_id
    ON job_executions(org_id);
  CREATE INDEX IF NOT EXISTS idx_job_executions_entity_id
    ON job_executions(entity_id)
    WHERE entity_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_job_executions_queue
    ON job_executions(status, created_at)
    WHERE status IN ('pending', 'retrying');
  CREATE INDEX IF NOT EXISTS idx_job_executions_job_type
    ON job_executions(job_type, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_job_executions_idempotency
    ON job_executions(job_type, idempotency_key);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;


-- =====================================================
-- ANALYZE: Update statistics for query planner
-- (Skip tables that don't exist)
-- =====================================================
ANALYZE invites;
DO $$ BEGIN EXECUTE 'ANALYZE email_subscribers'; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'ANALYZE content'; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'ANALYZE publish_intents'; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'ANALYZE job_executions'; EXCEPTION WHEN undefined_table THEN NULL; END $$;
