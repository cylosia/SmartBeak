-- Rollback: Drop publish_targets, publishing_jobs, and publish_attempts tables
DROP TABLE IF EXISTS publish_attempts CASCADE;
DROP TABLE IF EXISTS publishing_jobs CASCADE;
DROP TABLE IF EXISTS publish_targets CASCADE;
