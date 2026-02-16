-- Rollback: Drop missing indexes added by this migration

-- Invites indexes
DROP INDEX IF EXISTS idx_invites_org_id;
DROP INDEX IF EXISTS idx_invites_email;

-- Email subscribers indexes (may not exist)
DO $$ BEGIN
  DROP INDEX IF EXISTS idx_email_subscribers_domain_id;
  DROP INDEX IF EXISTS idx_email_subscribers_org_id;
  DROP INDEX IF EXISTS idx_email_subscribers_status;
  DROP INDEX IF EXISTS idx_email_subscribers_email_hash;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Content table indexes (may not exist)
DO $$ BEGIN
  DROP INDEX IF EXISTS idx_content_domain_id;
  DROP INDEX IF EXISTS idx_content_org_id;
  DROP INDEX IF EXISTS idx_content_status;
  DROP INDEX IF EXISTS idx_content_published_at;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Publish intents indexes (may not exist)
DO $$ BEGIN
  DROP INDEX IF EXISTS idx_publish_intents_org_id;
  DROP INDEX IF EXISTS idx_publish_intents_status;
  DROP INDEX IF EXISTS idx_publish_intents_scheduled_at;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Publish executions indexes (may not exist)
DO $$ BEGIN
  DROP INDEX IF EXISTS idx_publish_executions_intent_id;
  DROP INDEX IF EXISTS idx_publish_executions_status;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Job executions indexes (may not exist)
DO $$ BEGIN
  DROP INDEX IF EXISTS idx_job_executions_org_id;
  DROP INDEX IF EXISTS idx_job_executions_status;
  DROP INDEX IF EXISTS idx_job_executions_job_type;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Audit events indexes (may not exist)
DO $$ BEGIN
  DROP INDEX IF EXISTS idx_audit_events_org_id;
  DROP INDEX IF EXISTS idx_audit_events_actor_type;
  DROP INDEX IF EXISTS idx_audit_events_action;
  DROP INDEX IF EXISTS idx_audit_events_created_at;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Paddle subscriptions indexes (may not exist)
DO $$ BEGIN
  DROP INDEX IF EXISTS idx_paddle_subscriptions_org_id;
  DROP INDEX IF EXISTS idx_paddle_subscriptions_status;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
