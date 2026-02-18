-- Add unique constraint on (notification_id, attempt_number) to prevent
-- duplicate attempt records when concurrent workers process the same notification.
--
-- Without this, two workers could each INSERT attempt #N for the same notification,
-- making countByNotification() return inflated values and breaking the retry cap.
--
-- CONCURRENTLY cannot be used inside a transaction, but this constraint is safe to
-- add online because:
--   1. The table is append-only (no UPDATEs on these two columns).
--   2. The unique index build acquires only ShareLock, not a full table lock.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS
  idx_notification_attempts_unique_attempt
  ON notification_attempts (notification_id, attempt_number);

-- Convert to a formal UNIQUE constraint backed by the index just created.
-- This is a metadata-only operation (no re-scan needed) so it is instant.
ALTER TABLE notification_attempts
  ADD CONSTRAINT notification_attempts_unique_attempt
    UNIQUE USING INDEX idx_notification_attempts_unique_attempt;
