-- =====================================================
-- P2 DATABASE OPTIMIZATION: JSONB GIN Indexes
-- Issue: JSONB GIN Indexes Missing (3 issues)
--
-- GIN indexes on JSONB columns enable:
-- - Fast containment queries (@> operator)
-- - Efficient key existence checks (? operator)
-- - Scalable metadata filtering
--
-- Using jsonb_path_ops for smaller, faster indexes
-- when only containment queries are needed.
-- =====================================================


-- =====================================================
-- 1. EMAIL_SUBSCRIBERS - Metadata GIN Index (skip if table absent)
-- =====================================================
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_email_subscribers_metadata_gin
    ON email_subscribers USING GIN (metadata jsonb_path_ops);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- =====================================================
-- 2. CONTENT - Metadata GIN Index (skip if table absent)
-- =====================================================
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_content_metadata_gin
    ON content USING GIN (metadata jsonb_path_ops);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- =====================================================
-- 3. AUDIT_EVENTS - Metadata GIN Index (skip if table absent)
-- =====================================================
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_audit_events_metadata_gin
    ON audit_events USING GIN (metadata jsonb_path_ops);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- =====================================================
-- BONUS: Additional JSONB indexes for related tables
-- =====================================================

-- JOB_EXECUTIONS - Metadata GIN Index (skip if table absent)
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_job_executions_metadata_gin
    ON job_executions USING GIN (metadata jsonb_path_ops);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- PUBLISH_INTENTS - Target Config GIN Index (skip if table absent)
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_publish_intents_target_config_gin
    ON publish_intents USING GIN (target_config jsonb_path_ops);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;


-- =====================================================
-- Update statistics (skip tables that don't exist)
-- =====================================================
DO $$ BEGIN EXECUTE 'ANALYZE email_subscribers'; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'ANALYZE content'; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'ANALYZE audit_events'; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'ANALYZE job_executions'; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'ANALYZE publish_intents'; EXCEPTION WHEN undefined_table THEN NULL; END $$;
