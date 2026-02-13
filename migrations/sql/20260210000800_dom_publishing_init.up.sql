
CREATE TABLE IF NOT EXISTS publish_targets (
  id TEXT PRIMARY KEY,
  domain_id TEXT NOT NULL,
  type TEXT NOT NULL,
  config JSONB NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS publishing_jobs (
  id TEXT PRIMARY KEY,
  domain_id TEXT NOT NULL,
  content_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT now(),
  published_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS publish_attempts (
  id TEXT PRIMARY KEY,
  publishing_job_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  created_at TIMESTAMP DEFAULT now()
);
