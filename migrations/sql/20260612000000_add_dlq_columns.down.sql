DROP INDEX IF EXISTS idx_publishing_dlq_org_id;

ALTER TABLE publishing_dlq
  DROP COLUMN IF EXISTS error_message,
  DROP COLUMN IF EXISTS error_stack,
  DROP COLUMN IF EXISTS error_category,
  DROP COLUMN IF EXISTS job_data,
  DROP COLUMN IF EXISTS retry_count,
  DROP COLUMN IF EXISTS org_id;
