-- Domain Settings Table
-- Stores configuration and settings for each domain

CREATE TABLE IF NOT EXISTS domain_settings (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  domain_id TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  
  -- General settings
  timezone TEXT DEFAULT 'UTC',
  language TEXT DEFAULT 'en',
  currency TEXT DEFAULT 'USD',
  
  -- Content settings
  default_content_type TEXT DEFAULT 'article',
  auto_publish BOOLEAN DEFAULT false,
  content_review_required BOOLEAN DEFAULT true,
  
  -- SEO settings
  default_meta_title_template TEXT,
  default_meta_description_template TEXT,
  enable_auto_seo BOOLEAN DEFAULT true,
  
  -- Publishing settings
  default_publish_targets TEXT[] DEFAULT '{}',
  auto_sync_enabled BOOLEAN DEFAULT false,
  
  -- Feature flags
  enable_email_capture BOOLEAN DEFAULT false,
  enable_affiliate_links BOOLEAN DEFAULT false,
  enable_analytics BOOLEAN DEFAULT true,
  
  -- Custom settings (JSON for flexibility)
  custom_settings JSONB DEFAULT '{}',
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(domain_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_domain_settings_domain_id ON domain_settings(domain_id);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_domain_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_domain_settings_updated_at ON domain_settings;
CREATE TRIGGER trigger_update_domain_settings_updated_at
  BEFORE UPDATE ON domain_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_domain_settings_updated_at();
