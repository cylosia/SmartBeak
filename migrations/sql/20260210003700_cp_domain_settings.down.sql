-- Rollback: Drop domain_settings table, trigger, and function
DROP TRIGGER IF EXISTS trigger_update_domain_settings_updated_at ON domain_settings;
DROP FUNCTION IF EXISTS update_domain_settings_updated_at();
DROP INDEX IF EXISTS idx_domain_settings_domain_id;
DROP TABLE IF EXISTS domain_settings CASCADE;
