-- Indexes for notifications table
CREATE INDEX IF NOT EXISTS idx_notifications_user_id
  ON notifications (user_id);

CREATE INDEX IF NOT EXISTS idx_notifications_org_id
  ON notifications (org_id);

-- Partial index for non-terminal rows — used by the worker's listPending query
CREATE INDEX IF NOT EXISTS idx_notifications_status_pending
  ON notifications (status)
  WHERE status IN ('pending', 'failed');

-- Composite index for user notification listing (covers user_id + ORDER BY created_at)
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications (user_id, created_at DESC);

-- Indexes for notification_attempts table
CREATE INDEX IF NOT EXISTS idx_notification_attempts_notification_id
  ON notification_attempts (notification_id);

-- Indexes for notification_dlq table
CREATE INDEX IF NOT EXISTS idx_notification_dlq_notification_id
  ON notification_dlq (notification_id);

-- Index for notification_preferences lookup by user
CREATE INDEX IF NOT EXISTS idx_notification_preferences_user_id
  ON notification_preferences (user_id);
