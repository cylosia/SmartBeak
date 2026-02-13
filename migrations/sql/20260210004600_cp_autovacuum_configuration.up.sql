-- =====================================================
-- P2 DATABASE OPTIMIZATION: Vacuum/Analyze Configuration
-- Issue: Vacuum/Analyze Configuration (2 issues)
--
-- Autovacuum tuning for high-churn tables:
-- - Prevents transaction ID wraparound
-- - Maintains query performance
-- - Reduces table bloat
-- - Keeps statistics fresh for query planner
-- =====================================================


-- =====================================================
-- 1. HIGH-CHURN TABLES - Aggressive Autovacuum
-- =====================================================

-- AUDIT_EVENTS: Very high insert rate, rarely updated
ALTER TABLE audit_events SET (
  autovacuum_vacuum_scale_factor = 0.05,  -- Vacuum at 5% dead tuples (vs default 20%)
  autovacuum_vacuum_threshold = 1000,     -- Minimum 1000 dead tuples
  autovacuum_analyze_scale_factor = 0.02, -- Analyze at 2% changes
  autovacuum_analyze_threshold = 500,     -- Minimum 500 row changes
  autovacuum_vacuum_cost_limit = 2000,    -- Higher cost limit (faster vacuum)
  autovacuum_vacuum_cost_delay = 2        -- Minimal delay between vacuums
);

COMMENT ON TABLE audit_events IS 
  'High-volume audit log with aggressive autovacuum settings for 5% threshold';

-- ANALYTICS_EVENTS: Very high insert rate
ALTER TABLE analytics_events SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_vacuum_threshold = 1000,
  autovacuum_analyze_scale_factor = 0.02,
  autovacuum_analyze_threshold = 500,
  autovacuum_vacuum_cost_limit = 2000,
  autovacuum_vacuum_cost_delay = 2
);

-- USAGE_METRICS: High-frequency updates
ALTER TABLE usage_metrics SET (
  autovacuum_vacuum_scale_factor = 0.1,
  autovacuum_vacuum_threshold = 500,
  autovacuum_analyze_scale_factor = 0.05,
  autovacuum_analyze_threshold = 250,
  autovacuum_vacuum_cost_limit = 1500
);

-- NOTIFICATIONS: High churn (created, updated frequently)
ALTER TABLE notifications SET (
  autovacuum_vacuum_scale_factor = 0.1,
  autovacuum_vacuum_threshold = 500,
  autovacuum_analyze_scale_factor = 0.05,
  autovacuum_analyze_threshold = 250
);

-- PUBLISHING_JOBS: High churn with status updates
ALTER TABLE publishing_jobs SET (
  autovacuum_vacuum_scale_factor = 0.1,
  autovacuum_vacuum_threshold = 500,
  autovacuum_analyze_scale_factor = 0.05,
  autovacuum_analyze_threshold = 250
);

-- JOB_EXECUTIONS: Very high insert/update rate
ALTER TABLE job_executions SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_vacuum_threshold = 1000,
  autovacuum_analyze_scale_factor = 0.02,
  autovacuum_analyze_threshold = 500,
  autovacuum_vacuum_cost_limit = 2000,
  autovacuum_vacuum_cost_delay = 2
);

-- =====================================================
-- 2. MEDIUM-CHURN TABLES - Standard Autovacuum
-- =====================================================

-- CONTENT: Moderate update rate
ALTER TABLE content SET (
  autovacuum_vacuum_scale_factor = 0.1,
  autovacuum_vacuum_threshold = 500,
  autovacuum_analyze_scale_factor = 0.05,
  autovacuum_analyze_threshold = 250
);

-- EMAIL_SUBSCRIBERS: Moderate churn with soft deletes
ALTER TABLE email_subscribers SET (
  autovacuum_vacuum_scale_factor = 0.1,
  autovacuum_vacuum_threshold = 500,
  autovacuum_analyze_scale_factor = 0.05,
  autovacuum_analyze_threshold = 250
);

-- CONTENT_ITEMS: Moderate update rate
ALTER TABLE content_items SET (
  autovacuum_vacuum_scale_factor = 0.1,
  autovacuum_vacuum_threshold = 500,
  autovacuum_analyze_scale_factor = 0.05,
  autovacuum_analyze_threshold = 250
);

-- =====================================================
-- 3. LOW-CHURN REFERENCE TABLES - Relaxed Autovacuum
-- =====================================================

-- ORGANIZATIONS: Low churn
ALTER TABLE organizations SET (
  autovacuum_vacuum_scale_factor = 0.2,
  autovacuum_vacuum_threshold = 50,
  autovacuum_analyze_scale_factor = 0.1,
  autovacuum_analyze_threshold = 50
);

-- USERS: Low churn (with Clerk)
ALTER TABLE users SET (
  autovacuum_vacuum_scale_factor = 0.2,
  autovacuum_vacuum_threshold = 50,
  autovacuum_analyze_scale_factor = 0.1,
  autovacuum_analyze_threshold = 50
);

-- PLANS: Very low churn (reference data)
ALTER TABLE plans SET (
  autovacuum_vacuum_scale_factor = 0.3,
  autovacuum_vacuum_threshold = 10,
  autovacuum_analyze_scale_factor = 0.1,
  autovacuum_analyze_threshold = 10
);

-- =====================================================
-- 4. MAINTENANCE TRACKING TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS db_maintenance_log (
  id SERIAL PRIMARY KEY,
  table_name TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('vacuum', 'analyze', 'reindex', 'cluster')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  dead_tuples_before INTEGER,
  dead_tuples_after INTEGER,
  table_size_before BIGINT,
  table_size_after BIGINT,
  success BOOLEAN NOT NULL DEFAULT FALSE,
  error_message TEXT,
  executed_by TEXT DEFAULT CURRENT_USER
);

CREATE INDEX IF NOT EXISTS idx_maintenance_log_table 
  ON db_maintenance_log(table_name, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_maintenance_log_operation 
  ON db_maintenance_log(operation, started_at DESC) 
  WHERE success = TRUE;

COMMENT ON TABLE db_maintenance_log IS 
  'Tracks manual and automatic database maintenance operations';

-- =====================================================
-- 5. VACUUM STATISTICS VIEW
-- =====================================================

CREATE OR REPLACE VIEW db_vacuum_statistics AS
SELECT 
  schemaname,
  relname as table_name,
  n_live_tup as live_tuples,
  n_dead_tup as dead_tuples,
  ROUND(n_dead_tup::numeric / NULLIF(n_live_tup, 0) * 100, 2) as dead_tuple_ratio,
  last_vacuum,
  last_autovacuum,
  last_analyze,
  last_autoanalyze,
  vacuum_count,
  autovacuum_count,
  analyze_count,
  autoanalyze_count
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY n_dead_tup DESC;

COMMENT ON VIEW db_vacuum_statistics IS 
  'Current vacuum and table statistics for monitoring bloat';

-- =====================================================
-- 6. BLOAT MONITORING VIEW
-- =====================================================

CREATE OR REPLACE VIEW db_table_bloat AS
SELECT
  schemaname,
  relname as table_name,
  pg_size_pretty(pg_total_relation_size(relid)) as total_size,
  pg_size_pretty(pg_relation_size(relid)) as table_size,
  pg_size_pretty(pg_indexes_size(relid)) as indexes_size,
  n_live_tup,
  n_dead_tup,
  CASE 
    WHEN n_live_tup > 0 THEN ROUND(n_dead_tup::numeric / n_live_tup * 100, 2)
    ELSE 0
  END as bloat_ratio,
  CASE
    WHEN n_dead_tup > 10000 OR (n_live_tup > 0 AND n_dead_tup::numeric / n_live_tup > 0.3)
      THEN 'CRITICAL'
    WHEN n_dead_tup > 5000 OR (n_live_tup > 0 AND n_dead_tup::numeric / n_live_tup > 0.15)
      THEN 'WARNING'
    ELSE 'OK'
  END as status
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY n_dead_tup DESC;

COMMENT ON VIEW db_table_bloat IS 
  'Table bloat assessment with CRITICAL/WARNING/OK status';


-- =====================================================
-- MAINTENANCE PROCEDURES (run manually as needed)
-- =====================================================

/*
-- Manual vacuum of high-churn tables:
VACUUM ANALYZE audit_events;
VACUUM ANALYZE analytics_events;
VACUUM ANALYZE job_executions;

-- Vacuum with full cleanup (acquires exclusive lock):
VACUUM FULL audit_events;  -- WARNING: Locks table!

-- Reindex bloated indexes:
REINDEX INDEX CONCURRENTLY idx_audit_events_created_at;

-- Check vacuum statistics:
SELECT * FROM db_vacuum_statistics WHERE dead_tuple_ratio > 10;

-- Check bloat status:
SELECT * FROM db_table_bloat WHERE status != 'OK';
*/
