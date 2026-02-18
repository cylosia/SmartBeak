-- Rollback: remove unique constraint and its backing index
ALTER TABLE notification_attempts
  DROP CONSTRAINT IF EXISTS notification_attempts_unique_attempt;

DROP INDEX IF EXISTS idx_notification_attempts_unique_attempt;
