-- Rollback: Revert TIMESTAMPTZ columns back to TIMESTAMP and drop helper objects

-- Drop the helper function
DROP FUNCTION IF EXISTS convert_timestamp_to_timestamptz(TEXT, TEXT);

-- Revert columns back to TIMESTAMP (reverse of the up migration)
ALTER TABLE users
  ALTER COLUMN created_at TYPE TIMESTAMP USING created_at AT TIME ZONE 'UTC';

ALTER TABLE organizations
  ALTER COLUMN created_at TYPE TIMESTAMP USING created_at AT TIME ZONE 'UTC';

ALTER TABLE memberships
  ALTER COLUMN created_at TYPE TIMESTAMP USING created_at AT TIME ZONE 'UTC';

ALTER TABLE invites
  ALTER COLUMN created_at TYPE TIMESTAMP USING created_at AT TIME ZONE 'UTC';

ALTER TABLE invites
  ALTER COLUMN accepted_at TYPE TIMESTAMP USING accepted_at AT TIME ZONE 'UTC';

-- Drop migration tracking table
DROP TABLE IF EXISTS _migration_timestamptz_fix CASCADE;
