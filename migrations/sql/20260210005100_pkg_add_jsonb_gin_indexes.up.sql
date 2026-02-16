-- P2-MEDIUM: Add GIN indexes for JSONB columns
-- Enables fast queries on JSONB data without full table scans


-- GIN index for email_subscribers.metadata (skip if table absent)
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_email_subscribers_metadata_gin
  ON email_subscribers USING GIN (metadata jsonb_path_ops);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- GIN index for content.metadata (skip if table absent)
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_content_metadata_gin
  ON content USING GIN (metadata jsonb_path_ops);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- GIN index for audit_events.metadata (skip if table absent)
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_audit_events_metadata_gin
  ON audit_events USING GIN (metadata jsonb_path_ops);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- GIN index for job_executions metadata (skip if table absent)
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_job_executions_metadata_gin
  ON job_executions USING GIN (metadata jsonb_path_ops);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- Log completion (skip if tracking table absent)
DO $$ BEGIN
  INSERT INTO _migration_timestamptz_fix (status, completed_at)
  VALUES ('jsonb_gin_indexes_added', now());
EXCEPTION WHEN undefined_table THEN NULL;
END $$;
