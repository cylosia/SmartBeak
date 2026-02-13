-- =====================================================
-- P2 DATABASE OPTIMIZATION: Foreign Key Indexes
-- Issue: Foreign Key Constraints Without Indexes (5 issues)
-- 
-- Foreign key columns without indexes cause:
-- - Slow cascading deletes
-- - Table locks during parent updates/deletes
-- - Poor query performance on FK lookups
-- =====================================================


-- =====================================================
-- 1. INVITES TABLE - Add missing FK indexes
-- =====================================================
-- Index for org_id (FK to organizations)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invites_org_id 
  ON invites(org_id);

-- Index for email lookups (common query pattern)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invites_email 
  ON invites(email);

-- Partial index for pending invites (excludes accepted)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invites_pending 
  ON invites(org_id, created_at) 
  WHERE accepted_at IS NULL;

COMMENT ON INDEX idx_invites_org_id IS 
  'FK index: Prevents table locks on organization deletes';
COMMENT ON INDEX idx_invites_pending IS 
  'Partial index: Fast queries for pending invites only';

-- =====================================================
-- 2. EMAIL_SUBSCRIBERS TABLE - Add missing FK indexes
-- =====================================================
-- Index for domain_id (FK to domains)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_email_subscribers_domain_id 
  ON email_subscribers(domain_id);

-- Index for org_id (FK to organizations)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_email_subscribers_org_id 
  ON email_subscribers(org_id);

-- Index for email_hash lookups
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_email_subscribers_email_hash 
  ON email_subscribers(email_hash);

-- Composite index for list queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_email_subscribers_domain_list 
  ON email_subscribers(domain_id, created_at DESC) 
  WHERE status != 'deleted';

COMMENT ON INDEX idx_email_subscribers_domain_id IS 
  'FK index: Fast subscriber lookups by domain';
COMMENT ON INDEX idx_email_subscribers_org_id IS 
  'FK index: Cross-domain queries by organization';

-- =====================================================
-- 3. CONTENT TABLE - Add missing FK indexes
-- =====================================================
-- Index for domain_id (FK to domains)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_content_domain_id 
  ON content(domain_id);

-- Index for org_id (FK to organizations)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_content_org_id 
  ON content(org_id);

-- Index for author_id (FK to users/authors)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_content_author_id 
  ON content(author_id);

-- Composite index for published content listings
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_content_published 
  ON content(domain_id, published_at DESC) 
  WHERE status = 'published' AND deleted_at IS NULL;

COMMENT ON INDEX idx_content_domain_id IS 
  'FK index: Fast content lookups by domain';
COMMENT ON INDEX idx_content_author_id IS 
  'FK index: Content listings by author';

-- =====================================================
-- 4. PUBLISH_INTENTS TABLE - Add missing FK indexes
-- =====================================================
-- Index for org_id (FK to organizations)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_publish_intents_org_id 
  ON publish_intents(org_id);

-- Index for domain_id (FK to domains)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_publish_intents_domain_id 
  ON publish_intents(domain_id);

-- Index for draft_id (FK to content/drafts)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_publish_intents_draft_id 
  ON publish_intents(draft_id);

-- Index for status queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_publish_intents_status 
  ON publish_intents(status, created_at) 
  WHERE status IN ('pending', 'scheduled');

-- Partial index for scheduled intents
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_publish_intents_scheduled 
  ON publish_intents(scheduled_for) 
  WHERE scheduled_for IS NOT NULL AND status = 'scheduled';

COMMENT ON INDEX idx_publish_intents_draft_id IS 
  'FK index: Find intents by draft reference';
COMMENT ON INDEX idx_publish_intents_scheduled IS 
  'Partial index: Efficient polling for scheduled jobs';

-- =====================================================
-- 5. JOB_EXECUTIONS TABLE - Add missing FK indexes
-- =====================================================
-- Index for org_id (FK to organizations)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_job_executions_org_id 
  ON job_executions(org_id);

-- Index for entity_id (polymorphic FK)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_job_executions_entity_id 
  ON job_executions(entity_id) 
  WHERE entity_id IS NOT NULL;

-- Composite index for job queue processing
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_job_executions_queue 
  ON job_executions(status, created_at) 
  WHERE status IN ('pending', 'retrying');

-- Index for job type filtering
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_job_executions_job_type 
  ON job_executions(job_type, created_at DESC);

-- Index for idempotency lookups
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_job_executions_idempotency 
  ON job_executions(job_type, idempotency_key);

COMMENT ON INDEX idx_job_executions_org_id IS 
  'FK index: Job listings by organization';
COMMENT ON INDEX idx_job_executions_queue IS 
  'Partial index: Efficient job queue polling';


-- =====================================================
-- ANALYZE: Update statistics for query planner
-- =====================================================
ANALYZE invites;
ANALYZE email_subscribers;
ANALYZE content;
ANALYZE publish_intents;
ANALYZE job_executions;
