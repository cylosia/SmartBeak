-- P1-1 FIX: Add composite partial index for the job capacity query.
-- The query `WHERE status='started' AND entity_id=?` in jobGuards.ts
-- previously relied on separate single-column indexes, causing a seq scan
-- on the growing job_executions table. This partial index covers exactly
-- the capacity-check workload.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_job_executions_status_entity
  ON job_executions (status, entity_id)
  WHERE status = 'started';
