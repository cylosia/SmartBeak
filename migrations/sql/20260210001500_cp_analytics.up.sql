
CREATE TABLE IF NOT EXISTS analytics_content (
  content_id TEXT PRIMARY KEY,
  published_count INTEGER NOT NULL DEFAULT 0,
  last_published_at TIMESTAMP
);
