-- Rollback: Drop system_flags and usage_alerts tables
DROP TABLE IF EXISTS usage_alerts CASCADE;
DROP TABLE IF EXISTS system_flags CASCADE;
