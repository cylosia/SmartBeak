-- Rollback: Remove fields added to domain_registry
DROP INDEX IF EXISTS idx_domain_registry_theme;
DROP INDEX IF EXISTS idx_domain_registry_buyer_token;
ALTER TABLE domain_registry DROP COLUMN IF EXISTS buyer_token;
ALTER TABLE domain_registry DROP COLUMN IF EXISTS replaceability;
ALTER TABLE domain_registry DROP COLUMN IF EXISTS revenue_confidence;
ALTER TABLE domain_registry DROP COLUMN IF EXISTS domain_type;
ALTER TABLE domain_registry DROP COLUMN IF EXISTS custom_config;
ALTER TABLE domain_registry DROP COLUMN IF EXISTS theme_id;
