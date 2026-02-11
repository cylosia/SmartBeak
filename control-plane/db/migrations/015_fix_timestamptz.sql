-- P0-CRITICAL MIGRATION: Fix timezone-naive timestamps
-- Issue: TIMESTAMP without timezone causes DST corruption and silent data errors
-- Fix: Convert all TIMESTAMP columns to TIMESTAMPTZ (timestamp with time zone)
-- 
-- WARNING: This migration should be run during a maintenance window
-- as it requires exclusive table locks and may take time on large tables

BEGIN;

-- Add migration tracking
CREATE TABLE IF NOT EXISTS _migration_timestamptz_fix (
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  tables_processed INT DEFAULT 0,
  status TEXT DEFAULT 'running'
);

INSERT INTO _migration_timestamptz_fix (status) VALUES ('running');

-- Function to convert timestamp columns
CREATE OR REPLACE FUNCTION convert_timestamp_to_timestamptz(
  p_table TEXT,
  p_column TEXT
) RETURNS void AS $$
DECLARE
  v_sql TEXT;
BEGIN
  -- Check if column exists and is TIMESTAMP without timezone
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = p_table 
    AND column_name = p_column 
    AND data_type = 'timestamp without time zone'
  ) THEN
    v_sql := format(
      'ALTER TABLE %I ALTER COLUMN %I TYPE TIMESTAMPTZ USING %I AT TIME ZONE ''UTC''',
      p_table, p_column, p_column
    );
    EXECUTE v_sql;
    RAISE NOTICE 'Converted %.% to TIMESTAMPTZ', p_table, p_column;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Convert users table
SELECT convert_timestamp_to_timestamptz('users', 'created_at');

-- Convert organizations table
SELECT convert_timestamp_to_timestamptz('organizations', 'created_at');

-- Convert memberships table
SELECT convert_timestamp_to_timestamptz('memberships', 'created_at');

-- Convert invites table
SELECT convert_timestamp_to_timestamptz('invites', 'created_at');
SELECT convert_timestamp_to_timestamptz('invites', 'accepted_at');

-- Commit the transaction
UPDATE _migration_timestamptz_fix 
SET completed_at = now(), status = 'completed';

COMMIT;

-- Add comment to document the change
COMMENT ON FUNCTION convert_timestamp_to_timestamptz IS 
  'P0-FIX: Converts TIMESTAMP columns to TIMESTAMPTZ to prevent DST corruption';
