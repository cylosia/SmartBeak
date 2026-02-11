
CREATE TABLE IF NOT EXISTS publishing_dlq (
  id TEXT PRIMARY KEY,
  publishing_job_id TEXT NOT NULL,
  region TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT now()
);
