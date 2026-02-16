-- Rollback: Reset autovacuum configuration and drop monitoring objects

-- Drop monitoring views
DROP VIEW IF EXISTS db_table_bloat;
DROP VIEW IF EXISTS db_vacuum_statistics;

-- Drop maintenance log table
DROP INDEX IF EXISTS idx_maintenance_log_operation;
DROP INDEX IF EXISTS idx_maintenance_log_table;
DROP TABLE IF EXISTS db_maintenance_log CASCADE;

-- Reset autovacuum settings on high-churn tables (may not exist)
DO $$ BEGIN
  ALTER TABLE audit_events RESET (
    autovacuum_vacuum_scale_factor,
    autovacuum_vacuum_threshold,
    autovacuum_analyze_scale_factor,
    autovacuum_analyze_threshold,
    autovacuum_vacuum_cost_limit,
    autovacuum_vacuum_cost_delay
  );
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE analytics_events RESET (
    autovacuum_vacuum_scale_factor,
    autovacuum_vacuum_threshold,
    autovacuum_analyze_scale_factor,
    autovacuum_analyze_threshold,
    autovacuum_vacuum_cost_limit,
    autovacuum_vacuum_cost_delay
  );
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE usage_metrics RESET (
    autovacuum_vacuum_scale_factor,
    autovacuum_vacuum_threshold,
    autovacuum_analyze_scale_factor,
    autovacuum_analyze_threshold,
    autovacuum_vacuum_cost_limit
  );
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

ALTER TABLE notifications RESET (
  autovacuum_vacuum_scale_factor,
  autovacuum_vacuum_threshold,
  autovacuum_analyze_scale_factor,
  autovacuum_analyze_threshold
);

ALTER TABLE publishing_jobs RESET (
  autovacuum_vacuum_scale_factor,
  autovacuum_vacuum_threshold,
  autovacuum_analyze_scale_factor,
  autovacuum_analyze_threshold
);

DO $$ BEGIN
  ALTER TABLE job_executions RESET (
    autovacuum_vacuum_scale_factor,
    autovacuum_vacuum_threshold,
    autovacuum_analyze_scale_factor,
    autovacuum_analyze_threshold,
    autovacuum_vacuum_cost_limit,
    autovacuum_vacuum_cost_delay
  );
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE content RESET (
    autovacuum_vacuum_scale_factor,
    autovacuum_vacuum_threshold,
    autovacuum_analyze_scale_factor,
    autovacuum_analyze_threshold
  );
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE email_subscribers RESET (
    autovacuum_vacuum_scale_factor,
    autovacuum_vacuum_threshold,
    autovacuum_analyze_scale_factor,
    autovacuum_analyze_threshold
  );
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

ALTER TABLE content_items RESET (
  autovacuum_vacuum_scale_factor,
  autovacuum_vacuum_threshold,
  autovacuum_analyze_scale_factor,
  autovacuum_analyze_threshold
);

ALTER TABLE organizations RESET (
  autovacuum_vacuum_scale_factor,
  autovacuum_vacuum_threshold,
  autovacuum_analyze_scale_factor,
  autovacuum_analyze_threshold
);

ALTER TABLE users RESET (
  autovacuum_vacuum_scale_factor,
  autovacuum_vacuum_threshold,
  autovacuum_analyze_scale_factor,
  autovacuum_analyze_threshold
);

ALTER TABLE plans RESET (
  autovacuum_vacuum_scale_factor,
  autovacuum_vacuum_threshold,
  autovacuum_analyze_scale_factor,
  autovacuum_analyze_threshold
);
