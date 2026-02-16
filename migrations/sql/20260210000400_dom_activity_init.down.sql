-- Rollback: Drop activity_log table and its indexes
DROP INDEX IF EXISTS idx_activity_entity;
DROP INDEX IF EXISTS idx_activity_created;
DROP INDEX IF EXISTS idx_activity_domain;
DROP INDEX IF EXISTS idx_activity_org;
DROP TABLE IF EXISTS activity_log CASCADE;
