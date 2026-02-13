-- Add missing columns to publishing_dlq table.
-- The DLQService code references these columns but they were never added to the schema.

ALTER TABLE publishing_dlq
  ADD COLUMN IF NOT EXISTS error_message TEXT,
  ADD COLUMN IF NOT EXISTS error_stack TEXT,
  ADD COLUMN IF NOT EXISTS error_category TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS job_data JSONB,
  ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS org_id TEXT;

CREATE INDEX IF NOT EXISTS idx_publishing_dlq_org_id ON publishing_dlq(org_id);
