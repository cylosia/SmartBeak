-- Add domain_id and content_type to content_items
ALTER TABLE content_items
ADD COLUMN IF NOT EXISTS domain_id TEXT,
ADD COLUMN IF NOT EXISTS content_type TEXT DEFAULT 'article',
ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP;

-- Create index for domain lookups
CREATE INDEX IF NOT EXISTS idx_content_items_domain ON content_items(domain_id);

-- Create content archive intents table
CREATE TABLE IF NOT EXISTS content_archive_intents (
  id TEXT PRIMARY KEY,
  content_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  requested_at TIMESTAMP DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'pending',
  approved_by TEXT,
  approved_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_archive_intents_content ON content_archive_intents(content_id);

-- Create content archive audit table
CREATE TABLE IF NOT EXISTS content_archive_audit (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  action TEXT NOT NULL, -- 'archived', 'unarchived', 'deleted'
  reason TEXT,
  performed_by TEXT,
  performed_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_archive_audit_content ON content_archive_audit(content_id);
