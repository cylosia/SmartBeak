-- Create diligence tokens table for buyer access
CREATE TABLE IF NOT EXISTS diligence_tokens (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT NOT NULL UNIQUE,
  domain_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_diligence_tokens_token ON diligence_tokens(token);
CREATE INDEX IF NOT EXISTS idx_diligence_tokens_domain ON diligence_tokens(domain_id);
CREATE INDEX IF NOT EXISTS idx_diligence_tokens_expires ON diligence_tokens(expires_at);
