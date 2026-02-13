-- =====================================================
-- P2 DATABASE OPTIMIZATION: JSONB GIN Indexes
-- Issue: JSONB GIN Indexes Missing (3 issues)
--
-- GIN indexes on JSONB columns enable:
-- - Fast containment queries (@> operator)
-- - Efficient key existence checks (? operator)
-- - Scalable metadata filtering
-- 
-- Using jsonb_path_ops for smaller, faster indexes
-- when only containment queries are needed.
-- =====================================================


-- =====================================================
-- 1. EMAIL_SUBSCRIBERS - Metadata GIN Index
-- =====================================================
-- Supports queries like:
--   SELECT * FROM email_subscribers 
--   WHERE metadata @> '{"source": "api"}'
--   SELECT * FROM email_subscribers 
--   WHERE metadata @> '{"tags": ["vip"]}'

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_email_subscribers_metadata_gin 
  ON email_subscribers USING GIN (metadata jsonb_path_ops);

COMMENT ON INDEX idx_email_subscribers_metadata_gin IS 
  'GIN index for JSONB metadata containment queries. Use @> operator for best performance. Example: metadata @> ''{"source": "api"}''';

-- =====================================================
-- 2. CONTENT - Metadata GIN Index
-- =====================================================
-- Supports queries like:
--   SELECT * FROM content 
--   WHERE metadata @> '{"featured": true}'
--   SELECT * FROM content 
--   WHERE metadata @> '{"category": "technology"}'

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_content_metadata_gin 
  ON content USING GIN (metadata jsonb_path_ops);

COMMENT ON INDEX idx_content_metadata_gin IS 
  'GIN index for content metadata. Supports fast JSON containment queries on custom fields.';

-- =====================================================
-- 3. AUDIT_EVENTS - Metadata GIN Index
-- =====================================================
-- Supports queries like:
--   SELECT * FROM audit_events 
--   WHERE metadata @> '{"ip_address": "192.168.1.1"}'
--   SELECT * FROM audit_events 
--   WHERE metadata @> '{"user_agent": "Mozilla"}'

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_events_metadata_gin 
  ON audit_events USING GIN (metadata jsonb_path_ops);

COMMENT ON INDEX idx_audit_events_metadata_gin IS 
  'GIN index for audit metadata. Enables efficient searching of audit context and request details.';

-- =====================================================
-- BONUS: Additional JSONB indexes for related tables
-- =====================================================

-- JOB_EXECUTIONS - Metadata GIN Index
-- Supports queries for job results, errors, and context
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_job_executions_metadata_gin 
  ON job_executions USING GIN (metadata jsonb_path_ops);

COMMENT ON INDEX idx_job_executions_metadata_gin IS 
  'GIN index for job execution metadata and results';

-- PUBLISH_INTENTS - Target Config GIN Index
-- Supports queries by target platform configuration
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_publish_intents_target_config_gin 
  ON publish_intents USING GIN (target_config jsonb_path_ops);

COMMENT ON INDEX idx_publish_intents_target_config_gin IS 
  'GIN index for publish target configuration queries';


-- =====================================================
-- INDEX USAGE GUIDE
-- =====================================================

/*
-- Example queries that benefit from these indexes:

-- Email subscriber by metadata tag
SELECT * FROM email_subscribers 
WHERE metadata @> '{"tags": ["newsletter"]}';

-- Content by custom category
SELECT * FROM content 
WHERE metadata @> '{"category": "tutorial"}';

-- Audit events by IP range (with additional filter)
SELECT * FROM audit_events 
WHERE metadata @> '{"ip_address": "10.0.0.1"}'
  AND created_at > NOW() - INTERVAL '24 hours';

-- Jobs by result metadata
SELECT * FROM job_executions 
WHERE metadata @> '{"result": "success"}'
  AND job_type = 'email_send';

-- Publish intents by platform
SELECT * FROM publish_intents 
WHERE target_config @> '{"platform": "wordpress"}';
*/

-- Update statistics
ANALYZE email_subscribers;
ANALYZE content;
ANALYZE audit_events;
ANALYZE job_executions;
ANALYZE publish_intents;
