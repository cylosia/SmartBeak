-- P2-MEDIUM: Add missing indexes for performance optimization
-- Foreign keys without indexes cause slow cascading deletes and table locks

BEGIN;

-- Add indexes for foreign keys to prevent table locks on deletes
-- These were identified as missing in the audit

-- invites table FK indexes (if not exists)
CREATE INDEX IF NOT EXISTS idx_invites_org_id ON invites(org_id);
CREATE INDEX IF NOT EXISTS idx_invites_email ON invites(email);

-- email_subscribers FK and query indexes
CREATE INDEX IF NOT EXISTS idx_email_subscribers_domain_id ON email_subscribers(domain_id);
CREATE INDEX IF NOT EXISTS idx_email_subscribers_org_id ON email_subscribers(org_id);
CREATE INDEX IF NOT EXISTS idx_email_subscribers_status ON email_subscribers(status) 
  WHERE status != 'deleted';  -- Partial index for soft deletes
CREATE INDEX IF NOT EXISTS idx_email_subscribers_email_hash ON email_subscribers(email_hash);

-- content table indexes
CREATE INDEX IF NOT EXISTS idx_content_domain_id ON content(domain_id);
CREATE INDEX IF NOT EXISTS idx_content_org_id ON content(org_id);
CREATE INDEX IF NOT EXISTS idx_content_status ON content(status);
CREATE INDEX IF NOT EXISTS idx_content_published_at ON content(published_at) 
  WHERE published_at IS NOT NULL;

-- publish_intents indexes
CREATE INDEX IF NOT EXISTS idx_publish_intents_org_id ON publish_intents(org_id);
CREATE INDEX IF NOT EXISTS idx_publish_intents_status ON publish_intents(status);
CREATE INDEX IF NOT EXISTS idx_publish_intents_scheduled_at ON publish_intents(scheduled_at) 
  WHERE scheduled_at IS NOT NULL;

-- publish_executions indexes
CREATE INDEX IF NOT EXISTS idx_publish_executions_intent_id ON publish_executions(intent_id);
CREATE INDEX IF NOT EXISTS idx_publish_executions_status ON publish_executions(status);

-- job_executions indexes
CREATE INDEX IF NOT EXISTS idx_job_executions_org_id ON job_executions(org_id);
CREATE INDEX IF NOT EXISTS idx_job_executions_status ON job_executions(status);
CREATE INDEX IF NOT EXISTS idx_job_executions_job_type ON job_executions(job_type);

-- audit_events indexes (for GDPR deletion and queries)
CREATE INDEX IF NOT EXISTS idx_audit_events_org_id ON audit_events(org_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_actor_type ON audit_events(actor_type);
CREATE INDEX IF NOT EXISTS idx_audit_events_action ON audit_events(action);
CREATE INDEX IF NOT EXISTS idx_audit_events_created_at ON audit_events(created_at);

-- paddle_subscriptions indexes
CREATE INDEX IF NOT EXISTS idx_paddle_subscriptions_org_id ON paddle_subscriptions(org_id) 
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'paddle_subscriptions');
CREATE INDEX IF NOT EXISTS idx_paddle_subscriptions_status ON paddle_subscriptions(status)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'paddle_subscriptions');

-- Log the migration
INSERT INTO _migration_timestamptz_fix (status, completed_at) 
VALUES ('indexes_added', now())
ON CONFLICT DO NOTHING;

COMMIT;

-- Analyze tables to update statistics
ANALYZE invites;
ANALYZE email_subscribers;
ANALYZE content;
ANALYZE publish_intents;
ANALYZE publish_executions;
ANALYZE job_executions;
ANALYZE audit_events;
