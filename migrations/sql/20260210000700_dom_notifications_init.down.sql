-- Rollback: Drop notifications, notification_attempts, and notification_preferences tables
DROP TABLE IF EXISTS notification_preferences CASCADE;
DROP TABLE IF EXISTS notification_attempts CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;
