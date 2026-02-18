-- Rollback: remove indexes added in 20260619000006_p_file_audit_indexes.up.sql

DROP INDEX CONCURRENTLY IF EXISTS uidx_keyword_metrics_dedup;
DROP INDEX CONCURRENTLY IF EXISTS idx_social_metrics_content_ts;
DROP INDEX CONCURRENTLY IF EXISTS idx_keyword_metrics_domain_keyword_ts;
DROP INDEX CONCURRENTLY IF EXISTS idx_publishing_jobs_domain_created;
