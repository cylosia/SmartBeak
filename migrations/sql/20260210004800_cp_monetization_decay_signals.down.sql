-- Rollback: Drop monetization_decay_signals table and its indexes
DROP INDEX IF EXISTS idx_mds_period_start_brin;
DROP INDEX IF EXISTS idx_mds_decay_flag_true;
DROP INDEX IF EXISTS idx_mds_content_version_id;
DROP TABLE IF EXISTS monetization_decay_signals CASCADE;
