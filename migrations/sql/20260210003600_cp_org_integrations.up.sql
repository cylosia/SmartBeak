
CREATE TABLE IF NOT EXISTS org_integrations (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  credential_type TEXT NOT NULL,
  encrypted_secret BYTEA NOT NULL,
  encryption_version INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);
