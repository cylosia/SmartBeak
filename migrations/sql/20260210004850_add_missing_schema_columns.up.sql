-- Add missing columns required by 20260210004900_infra_p0_critical_fixes
-- These columns are referenced by GIN indexes and composite indexes

-- org_integrations: add config JSONB column
ALTER TABLE org_integrations
  ADD COLUMN IF NOT EXISTS config JSONB DEFAULT '{}';

-- domain_settings: add settings JSONB column
ALTER TABLE domain_settings
  ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{}';

-- content_items: add metadata JSONB column
ALTER TABLE content_items
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- publishing_jobs: add metadata, attempt_count, updated_at columns
ALTER TABLE publishing_jobs
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- notification_attempts: add response JSONB column
ALTER TABLE notification_attempts
  ADD COLUMN IF NOT EXISTS response JSONB;

-- notification_dlq: add payload JSONB column
ALTER TABLE notification_dlq
  ADD COLUMN IF NOT EXISTS payload JSONB;

-- notification_preferences: add channels JSONB column
ALTER TABLE notification_preferences
  ADD COLUMN IF NOT EXISTS channels JSONB DEFAULT '[]';

-- media_assets: add metadata JSONB column
ALTER TABLE media_assets
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- indexing_jobs: add metadata JSONB column
ALTER TABLE indexing_jobs
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- search_indexes: add config JSONB column
ALTER TABLE search_indexes
  ADD COLUMN IF NOT EXISTS config JSONB DEFAULT '{}';

-- domain_transfer_log: create table (referenced by FK constraints in critical fixes)
CREATE TABLE IF NOT EXISTS domain_transfer_log (
  id TEXT PRIMARY KEY,
  domain_id TEXT NOT NULL,
  transferred_by TEXT,
  transferred_to TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
