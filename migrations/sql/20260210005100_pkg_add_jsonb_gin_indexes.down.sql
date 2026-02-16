-- Rollback: Drop JSONB GIN indexes added by this migration

DO $$ BEGIN
  DROP INDEX IF EXISTS idx_email_subscribers_metadata_gin;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  DROP INDEX IF EXISTS idx_content_metadata_gin;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  DROP INDEX IF EXISTS idx_audit_events_metadata_gin;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  DROP INDEX IF EXISTS idx_job_executions_metadata_gin;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
