-- Create domains table
CREATE TABLE IF NOT EXISTS domains (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  archived_at TIMESTAMP,
  UNIQUE(org_id, name)
);

CREATE INDEX IF NOT EXISTS idx_domains_org ON domains(org_id);
CREATE INDEX IF NOT EXISTS idx_domains_status ON domains(status);

-- Create domain transfers table
CREATE TABLE IF NOT EXISTS domain_transfers (
  id TEXT PRIMARY KEY,
  domain_id TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  from_user_id TEXT NOT NULL,
  to_user_id TEXT,
  to_org_id TEXT,
  receipt TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP,
  expires_at TIMESTAMP DEFAULT NOW() + INTERVAL '7 days'
);

CREATE INDEX IF NOT EXISTS idx_domain_transfers_domain ON domain_transfers(domain_id);
CREATE INDEX IF NOT EXISTS idx_domain_transfers_receipt ON domain_transfers(receipt);

-- Create domain registry table (for ownership verification)
CREATE TABLE IF NOT EXISTS domain_registry (
  id TEXT PRIMARY KEY REFERENCES domains(id) ON DELETE CASCADE,
  org_id TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_domain_registry_org ON domain_registry(org_id);
CREATE INDEX IF NOT EXISTS idx_domain_registry_lookup ON domain_registry(id, org_id);
