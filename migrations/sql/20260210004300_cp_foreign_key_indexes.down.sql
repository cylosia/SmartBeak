-- Rollback: Drop foreign key indexes added by this migration

-- Invites table indexes
DROP INDEX IF EXISTS idx_invites_org_id;
DROP INDEX IF EXISTS idx_invites_email;
DROP INDEX IF EXISTS idx_invites_pending;

-- Email subscribers indexes (may not exist)
DO $$ BEGIN
  DROP INDEX IF EXISTS idx_email_subscribers_domain_id;
  DROP INDEX IF EXISTS idx_email_subscribers_org_id;
  DROP INDEX IF EXISTS idx_email_subscribers_email_hash;
  DROP INDEX IF EXISTS idx_email_subscribers_domain_list;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Content table indexes (may not exist)
DO $$ BEGIN
  DROP INDEX IF EXISTS idx_content_domain_id;
  DROP INDEX IF EXISTS idx_content_org_id;
  DROP INDEX IF EXISTS idx_content_author_id;
  DROP INDEX IF EXISTS idx_content_published;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Publish intents indexes (may not exist)
DO $$ BEGIN
  DROP INDEX IF EXISTS idx_publish_intents_org_id;
  DROP INDEX IF EXISTS idx_publish_intents_domain_id;
  DROP INDEX IF EXISTS idx_publish_intents_draft_id;
  DROP INDEX IF EXISTS idx_publish_intents_status;
  DROP INDEX IF EXISTS idx_publish_intents_scheduled;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Job executions indexes (may not exist)
DO $$ BEGIN
  DROP INDEX IF EXISTS idx_job_executions_org_id;
  DROP INDEX IF EXISTS idx_job_executions_entity_id;
  DROP INDEX IF EXISTS idx_job_executions_queue;
  DROP INDEX IF EXISTS idx_job_executions_job_type;
  DROP INDEX IF EXISTS idx_job_executions_idempotency;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
