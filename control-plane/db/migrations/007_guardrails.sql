
CREATE TABLE IF NOT EXISTS system_flags (
  key TEXT PRIMARY KEY,
  value BOOLEAN NOT NULL,
  updated_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS usage_alerts (
  id TEXT PRIMARY KEY,
  org_id TEXT REFERENCES organizations(id),
  metric TEXT NOT NULL,
  threshold INTEGER NOT NULL,
  triggered BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT now()
);
