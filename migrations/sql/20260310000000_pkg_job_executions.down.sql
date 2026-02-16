-- Rollback: Drop job_executions table and its index
DROP INDEX IF EXISTS idx_job_exec_entity;
DROP TABLE IF EXISTS job_executions CASCADE;
