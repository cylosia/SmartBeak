
-- Prevent duplicate publishing jobs for same content+target
CREATE UNIQUE INDEX IF NOT EXISTS uniq_publishing_job_dedup
ON publishing_jobs (domain_id, content_id, target_id)
WHERE status IN ('pending','publishing');

-- Track last activity per domain for right-sizing decisions
CREATE TABLE IF NOT EXISTS domain_activity (
  domain_id TEXT PRIMARY KEY,
  last_publish_at TIMESTAMP,
  last_content_update_at TIMESTAMP,
  updated_at TIMESTAMP DEFAULT now()
);
