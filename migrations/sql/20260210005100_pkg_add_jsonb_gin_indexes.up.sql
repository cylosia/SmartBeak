-- P2-MEDIUM: Add GIN indexes for JSONB columns
-- Enables fast queries on JSONB data without full table scans


-- GIN index for email_subscribers.metadata
-- Supports queries like: metadata->>'source' = 'api'
CREATE INDEX IF NOT EXISTS idx_email_subscribers_metadata_gin 
ON email_subscribers USING GIN (metadata jsonb_path_ops);

-- GIN index for content.metadata
CREATE INDEX IF NOT EXISTS idx_content_metadata_gin 
ON content USING GIN (metadata jsonb_path_ops);

-- GIN index for audit_events.metadata
-- Supports searching audit log metadata efficiently
CREATE INDEX IF NOT EXISTS idx_audit_events_metadata_gin 
ON audit_events USING GIN (metadata jsonb_path_ops);

-- GIN index for job_executions metadata
CREATE INDEX IF NOT EXISTS idx_job_executions_metadata_gin 
ON job_executions USING GIN (metadata jsonb_path_ops);

-- Add comments explaining usage
COMMENT ON INDEX idx_email_subscribers_metadata_gin IS 
  'GIN index for JSONB metadata queries. Use @> operator for best performance.';

COMMENT ON INDEX idx_content_metadata_gin IS 
  'GIN index for content metadata. Supports fast JSON containment queries.';

-- Log completion
INSERT INTO _migration_timestamptz_fix (status, completed_at) 
VALUES ('jsonb_gin_indexes_added', now())
ON CONFLICT DO NOTHING;


-- Example queries that now use index:
-- SELECT * FROM email_subscribers WHERE metadata @> '{"source": "api"}';
-- SELECT * FROM content WHERE metadata @> '{"featured": true}';
