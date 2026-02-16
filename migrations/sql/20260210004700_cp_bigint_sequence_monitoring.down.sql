-- Rollback: Drop bigint sequence monitoring objects (views, functions, table)

-- Drop views first (depend on v_sequence_health)
DROP VIEW IF EXISTS v_critical_sequences;

-- Drop functions (depend on v_sequence_health and sequence_monitoring_alerts)
DROP FUNCTION IF EXISTS estimate_sequence_reset_date(TEXT, INTEGER);
DROP FUNCTION IF EXISTS acknowledge_sequence_alert(BIGINT, TEXT, TEXT);
DROP FUNCTION IF EXISTS generate_sequence_alerts(INTEGER);
DROP FUNCTION IF EXISTS check_sequence_utilization(INTEGER);

-- Drop view
DROP VIEW IF EXISTS v_sequence_health;

-- Drop indexes and table
DROP INDEX IF EXISTS idx_sequence_alerts_level;
DROP INDEX IF EXISTS idx_sequence_alerts_unacknowledged;
DROP INDEX IF EXISTS idx_sequence_alerts_created;
DROP TABLE IF EXISTS sequence_monitoring_alerts CASCADE;
