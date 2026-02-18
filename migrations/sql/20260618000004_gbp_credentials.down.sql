-- Rollback: gbp_credentials table
-- Drop trigger and function before table to avoid dependency errors
DROP TRIGGER IF EXISTS set_gbp_credentials_updated_at ON gbp_credentials;
DROP FUNCTION IF EXISTS trigger_set_gbp_credentials_updated_at();
DROP TABLE IF EXISTS gbp_credentials;
