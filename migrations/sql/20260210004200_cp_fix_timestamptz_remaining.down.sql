-- Rollback: Revert remaining TIMESTAMPTZ columns back to TIMESTAMP

DO $$
BEGIN
  -- Revert domain_registry
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'domain_registry') THEN
    ALTER TABLE domain_registry
      ALTER COLUMN created_at TYPE TIMESTAMP USING created_at AT TIME ZONE 'UTC',
      ALTER COLUMN updated_at TYPE TIMESTAMP USING updated_at AT TIME ZONE 'UTC';
  END IF;

  -- Revert content
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'content') THEN
    ALTER TABLE content
      ALTER COLUMN created_at TYPE TIMESTAMP USING created_at AT TIME ZONE 'UTC',
      ALTER COLUMN updated_at TYPE TIMESTAMP USING updated_at AT TIME ZONE 'UTC',
      ALTER COLUMN published_at TYPE TIMESTAMP USING published_at AT TIME ZONE 'UTC';
  END IF;

  -- Revert email_subscribers
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'email_subscribers') THEN
    ALTER TABLE email_subscribers
      ALTER COLUMN created_at TYPE TIMESTAMP USING created_at AT TIME ZONE 'UTC',
      ALTER COLUMN updated_at TYPE TIMESTAMP USING updated_at AT TIME ZONE 'UTC',
      ALTER COLUMN last_activity_at TYPE TIMESTAMP USING last_activity_at AT TIME ZONE 'UTC';
  END IF;

  -- Revert audit_events
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'audit_events') THEN
    ALTER TABLE audit_events
      ALTER COLUMN created_at TYPE TIMESTAMP USING created_at AT TIME ZONE 'UTC';
  END IF;

  -- Revert publish_intents
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'publish_intents') THEN
    ALTER TABLE publish_intents
      ALTER COLUMN created_at TYPE TIMESTAMP USING created_at AT TIME ZONE 'UTC',
      ALTER COLUMN scheduled_at TYPE TIMESTAMP USING scheduled_at AT TIME ZONE 'UTC';
  END IF;

  -- Revert publish_executions
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'publish_executions') THEN
    ALTER TABLE publish_executions
      ALTER COLUMN completed_at TYPE TIMESTAMP USING completed_at AT TIME ZONE 'UTC',
      ALTER COLUMN failed_at TYPE TIMESTAMP USING failed_at AT TIME ZONE 'UTC';
  END IF;

  -- Revert job_executions
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'job_executions') THEN
    ALTER TABLE job_executions
      ALTER COLUMN started_at TYPE TIMESTAMP USING started_at AT TIME ZONE 'UTC',
      ALTER COLUMN completed_at TYPE TIMESTAMP USING completed_at AT TIME ZONE 'UTC';
  END IF;

  -- Revert paddle_subscriptions
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'paddle_subscriptions') THEN
    ALTER TABLE paddle_subscriptions
      ALTER COLUMN created_at TYPE TIMESTAMP USING created_at AT TIME ZONE 'UTC',
      ALTER COLUMN updated_at TYPE TIMESTAMP USING updated_at AT TIME ZONE 'UTC';
  END IF;
END $$;
