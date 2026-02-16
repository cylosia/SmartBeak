-- Rollback: Drop cost optimization objects (unique index, domain_activity table)
DROP INDEX IF EXISTS uniq_publishing_job_dedup;
DROP TABLE IF EXISTS domain_activity CASCADE;
