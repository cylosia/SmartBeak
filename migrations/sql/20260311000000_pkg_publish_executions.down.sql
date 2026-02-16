-- Rollback: Drop publish_executions table and its index
DROP INDEX IF EXISTS idx_publish_exec_intent;
DROP TABLE IF EXISTS publish_executions CASCADE;
