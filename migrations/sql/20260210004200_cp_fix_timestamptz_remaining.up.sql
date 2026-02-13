-- P0-CRITICAL MIGRATION: Fix remaining tables with timezone-naive timestamps
-- Part 2: Domain, analytics, billing, and audit tables


-- Domain-related tables
DO $$
DECLARE
  r RECORD;
BEGIN
  -- Convert domain_registry
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'domain_registry') THEN
    ALTER TABLE domain_registry 
      ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
      ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';
  END IF;

  -- Convert content tables
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'content') THEN
    ALTER TABLE content 
      ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
      ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC',
      ALTER COLUMN published_at TYPE TIMESTAMPTZ USING published_at AT TIME ZONE 'UTC';
  END IF;

  -- Convert email_subscribers
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'email_subscribers') THEN
    ALTER TABLE email_subscribers 
      ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
      ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC',
      ALTER COLUMN last_activity_at TYPE TIMESTAMPTZ USING last_activity_at AT TIME ZONE 'UTC';
  END IF;

  -- Convert audit_events
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'audit_events') THEN
    ALTER TABLE audit_events 
      ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';
  END IF;

  -- Convert publish_intents and executions
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'publish_intents') THEN
    ALTER TABLE publish_intents 
      ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
      ALTER COLUMN scheduled_at TYPE TIMESTAMPTZ USING scheduled_at AT TIME ZONE 'UTC';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'publish_executions') THEN
    ALTER TABLE publish_executions 
      ALTER COLUMN completed_at TYPE TIMESTAMPTZ USING completed_at AT TIME ZONE 'UTC',
      ALTER COLUMN failed_at TYPE TIMESTAMPTZ USING failed_at AT TIME ZONE 'UTC';
  END IF;

  -- Convert job_executions
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'job_executions') THEN
    ALTER TABLE job_executions 
      ALTER COLUMN started_at TYPE TIMESTAMPTZ USING started_at AT TIME ZONE 'UTC',
      ALTER COLUMN completed_at TYPE TIMESTAMPTZ USING completed_at AT TIME ZONE 'UTC';
  END IF;

  -- Convert paddle_subscriptions (if exists)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'paddle_subscriptions') THEN
    ALTER TABLE paddle_subscriptions 
      ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
      ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';
  END IF;

END $$;

-- Update migration tracking
UPDATE _migration_timestamptz_fix 
SET tables_processed = tables_processed + 8,
    completed_at = now()
WHERE status = 'completed';


-- Verify all TIMESTAMP columns have been converted
DO $$
DECLARE
  remaining_count INT;
BEGIN
  SELECT COUNT(*) INTO remaining_count
  FROM information_schema.columns
  WHERE data_type = 'timestamp without time zone'
  AND table_schema = 'public';

  IF remaining_count > 0 THEN
    RAISE WARNING 'Remaining TIMESTAMP columns without timezone: %', remaining_count;
  ELSE
    RAISE NOTICE 'All TIMESTAMP columns successfully converted to TIMESTAMPTZ';
  END IF;
END $$;
