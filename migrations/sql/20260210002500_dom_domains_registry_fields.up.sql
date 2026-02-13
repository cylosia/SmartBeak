-- Add missing fields to domain_registry for frontend compatibility
ALTER TABLE domain_registry
ADD COLUMN IF NOT EXISTS theme_id TEXT,
ADD COLUMN IF NOT EXISTS custom_config JSONB,
ADD COLUMN IF NOT EXISTS domain_type TEXT DEFAULT 'content',
ADD COLUMN IF NOT EXISTS revenue_confidence INTEGER CHECK (revenue_confidence >= 0 AND revenue_confidence <= 100),
ADD COLUMN IF NOT EXISTS replaceability INTEGER CHECK (replaceability >= 0 AND replaceability <= 100),
ADD COLUMN IF NOT EXISTS buyer_token TEXT UNIQUE;

-- Create index for buyer token lookups
CREATE INDEX IF NOT EXISTS idx_domain_registry_buyer_token ON domain_registry(buyer_token);

-- Create index for theme lookups
CREATE INDEX IF NOT EXISTS idx_domain_registry_theme ON domain_registry(theme_id);
