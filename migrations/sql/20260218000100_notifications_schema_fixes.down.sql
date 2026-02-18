-- Remove foreign key constraints
ALTER TABLE notification_dlq DROP CONSTRAINT IF EXISTS notification_dlq_notification_id_fk;
ALTER TABLE notification_attempts DROP CONSTRAINT IF EXISTS notification_attempts_notification_id_fk;

-- Remove unique constraint
ALTER TABLE notification_preferences DROP CONSTRAINT IF EXISTS notification_preferences_user_channel_unique;

-- Remove check constraints
ALTER TABLE notification_preferences DROP CONSTRAINT IF EXISTS notification_preferences_frequency_check;
ALTER TABLE notification_preferences DROP CONSTRAINT IF EXISTS notification_preferences_channel_check;
ALTER TABLE notification_attempts DROP CONSTRAINT IF EXISTS notification_attempts_status_check;
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_status_check;

-- Remove added columns
ALTER TABLE notification_preferences DROP COLUMN IF EXISTS updated_at;
ALTER TABLE notifications DROP COLUMN IF EXISTS delivery_committed_at;
ALTER TABLE notifications DROP COLUMN IF EXISTS delivery_token;
ALTER TABLE notifications DROP COLUMN IF EXISTS updated_at;

-- Revert TIMESTAMPTZ → TIMESTAMP
ALTER TABLE notification_dlq
  ALTER COLUMN created_at TYPE TIMESTAMP USING created_at AT TIME ZONE 'UTC';

ALTER TABLE notification_preferences
  ALTER COLUMN created_at TYPE TIMESTAMP USING created_at AT TIME ZONE 'UTC';

ALTER TABLE notification_attempts
  ALTER COLUMN created_at TYPE TIMESTAMP USING created_at AT TIME ZONE 'UTC';

ALTER TABLE notifications
  ALTER COLUMN created_at TYPE TIMESTAMP USING created_at AT TIME ZONE 'UTC';
