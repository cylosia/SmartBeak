-- Rollback: Remove region column from publish_targets and publishing_jobs
ALTER TABLE publishing_jobs DROP COLUMN IF EXISTS region;
ALTER TABLE publish_targets DROP COLUMN IF EXISTS region;
