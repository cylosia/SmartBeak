
CREATE TABLE IF NOT EXISTS org_usage (
  org_id TEXT PRIMARY KEY REFERENCES organizations(id),
  domain_count INTEGER NOT NULL DEFAULT 0,
  content_count INTEGER NOT NULL DEFAULT 0,
  media_count INTEGER NOT NULL DEFAULT 0,
  publish_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP DEFAULT now()
);
