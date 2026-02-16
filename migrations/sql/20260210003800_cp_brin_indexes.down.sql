-- Rollback: Drop BRIN indexes for time-series data

-- Direct indexes on known tables
DROP INDEX IF EXISTS idx_organizations_created_at_brin;
DROP INDEX IF EXISTS idx_users_created_at_brin;
DROP INDEX IF EXISTS idx_memberships_created_at_brin;
DROP INDEX IF EXISTS idx_invites_created_at_brin;
DROP INDEX IF EXISTS idx_publishing_jobs_created_at_brin;
DROP INDEX IF EXISTS idx_publish_attempts_created_at_brin;
DROP INDEX IF EXISTS idx_notifications_created_at_brin;
DROP INDEX IF EXISTS idx_publishing_dlq_created_at_brin;

-- Indexes on tables that may not exist (wrapped in DO blocks)
DO $$ BEGIN
  DROP INDEX IF EXISTS idx_audit_events_created_at_brin;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  DROP INDEX IF EXISTS idx_analytics_events_created_at_brin;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  DROP INDEX IF EXISTS idx_usage_metrics_recorded_at_brin;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  DROP INDEX IF EXISTS idx_cost_events_created_at_brin;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
