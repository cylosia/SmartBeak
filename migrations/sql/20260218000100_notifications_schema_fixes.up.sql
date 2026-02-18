-- Fix TIMESTAMP → TIMESTAMPTZ on all notification tables
ALTER TABLE notifications
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';

ALTER TABLE notification_attempts
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';

ALTER TABLE notification_preferences
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';

ALTER TABLE notification_dlq
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';

-- Add missing columns to notifications
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS delivery_token TEXT,
  ADD COLUMN IF NOT EXISTS delivery_committed_at TIMESTAMPTZ;

-- Add updated_at to notification_preferences
ALTER TABLE notification_preferences
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Add check constraints on status/channel/frequency enums
ALTER TABLE notifications
  ADD CONSTRAINT notifications_status_check
    CHECK (status IN ('pending', 'sending', 'delivered', 'failed', 'cancelled'));

ALTER TABLE notification_attempts
  ADD CONSTRAINT notification_attempts_status_check
    CHECK (status IN ('success', 'failure'));

ALTER TABLE notification_preferences
  ADD CONSTRAINT notification_preferences_channel_check
    CHECK (channel IN ('email', 'sms', 'push', 'webhook'));

ALTER TABLE notification_preferences
  ADD CONSTRAINT notification_preferences_frequency_check
    CHECK (frequency IN ('immediate', 'daily', 'weekly'));

-- Add UNIQUE constraint to prevent duplicate preferences per user+channel
ALTER TABLE notification_preferences
  ADD CONSTRAINT notification_preferences_user_channel_unique UNIQUE (user_id, channel);

-- Add foreign key constraints
ALTER TABLE notification_attempts
  ADD CONSTRAINT notification_attempts_notification_id_fk
    FOREIGN KEY (notification_id) REFERENCES notifications (id) ON DELETE CASCADE;

ALTER TABLE notification_dlq
  ADD CONSTRAINT notification_dlq_notification_id_fk
    FOREIGN KEY (notification_id) REFERENCES notifications (id) ON DELETE CASCADE;
