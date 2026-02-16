-- Rollback: Drop sequence monitoring objects (table, view, functions)
DROP VIEW IF EXISTS sequence_health_monitor;
DROP FUNCTION IF EXISTS trigger_sequence_alert() CASCADE;
DROP FUNCTION IF EXISTS check_sequence_utilization();
DROP INDEX IF EXISTS idx_sequence_alerts_unacknowledged;
DROP INDEX IF EXISTS idx_sequence_alerts_created_at;
DROP TABLE IF EXISTS sequence_monitoring_alerts CASCADE;
