-- P2-MEDIUM: Add missing indexes for performance optimization
-- Foreign keys without indexes cause slow cascading deletes and table locks


-- Add indexes for foreign keys to prevent table locks on deletes
-- These were identified as missing in the audit

-- invites table FK indexes (if not exists)
CREATE INDEX IF NOT EXISTS idx_invites_org_id ON invites(org_id);
CREATE INDEX IF NOT EXISTS idx_invites_email ON invites(email);

-- email_subscribers FK and query indexes (skip if table absent)
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_email_subscribers_domain_id ON email_subscribers(domain_id);
  CREATE INDEX IF NOT EXISTS idx_email_subscribers_org_id ON email_subscribers(org_id);
  CREATE INDEX IF NOT EXISTS idx_email_subscribers_status ON email_subscribers(status)
    WHERE status != 'deleted';
  CREATE INDEX IF NOT EXISTS idx_email_subscribers_email_hash ON email_subscribers(email_hash);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- content table indexes (skip if table absent -- actual table is content_items)
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_content_domain_id ON content(domain_id);
  CREATE INDEX IF NOT EXISTS idx_content_org_id ON content(org_id);
  CREATE INDEX IF NOT EXISTS idx_content_status ON content(status);
  CREATE INDEX IF NOT EXISTS idx_content_published_at ON content(published_at)
    WHERE published_at IS NOT NULL;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- publish_intents indexes (skip if table absent)
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_publish_intents_org_id ON publish_intents(org_id);
  CREATE INDEX IF NOT EXISTS idx_publish_intents_status ON publish_intents(status);
  CREATE INDEX IF NOT EXISTS idx_publish_intents_scheduled_at ON publish_intents(scheduled_for)
    WHERE scheduled_for IS NOT NULL;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- publish_executions indexes (skip if table absent)
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_publish_executions_intent_id ON publish_executions(intent_id);
  CREATE INDEX IF NOT EXISTS idx_publish_executions_status ON publish_executions(status);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- job_executions indexes (skip if table absent)
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_job_executions_org_id ON job_executions(org_id);
  CREATE INDEX IF NOT EXISTS idx_job_executions_status ON job_executions(status);
  CREATE INDEX IF NOT EXISTS idx_job_executions_job_type ON job_executions(job_type);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- audit_events indexes (skip if table absent)
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_audit_events_org_id ON audit_events(org_id);
  CREATE INDEX IF NOT EXISTS idx_audit_events_actor_type ON audit_events(actor_type);
  CREATE INDEX IF NOT EXISTS idx_audit_events_action ON audit_events(action);
  CREATE INDEX IF NOT EXISTS idx_audit_events_created_at ON audit_events(created_at);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- paddle_subscriptions indexes (skip if table absent)
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_paddle_subscriptions_org_id ON paddle_subscriptions(org_id);
  CREATE INDEX IF NOT EXISTS idx_paddle_subscriptions_status ON paddle_subscriptions(status);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- Log the migration (skip if tracking table absent)
DO $$ BEGIN
  INSERT INTO _migration_timestamptz_fix (status, completed_at)
  VALUES ('indexes_added', now());
EXCEPTION WHEN undefined_table THEN NULL;
END $$;


-- Analyze tables to update statistics (skip absent tables)
ANALYZE invites;
DO $$ BEGIN EXECUTE 'ANALYZE email_subscribers'; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'ANALYZE content'; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'ANALYZE publish_intents'; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'ANALYZE publish_executions'; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'ANALYZE job_executions'; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'ANALYZE audit_events'; EXCEPTION WHEN undefined_table THEN NULL; END $$;
