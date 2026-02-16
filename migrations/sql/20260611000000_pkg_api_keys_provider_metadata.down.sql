-- Rollback: drop api_keys and provider_key_metadata tables
DROP INDEX IF EXISTS idx_api_keys_pending_invalidation;
DROP INDEX IF EXISTS idx_api_keys_status;
DROP TABLE IF EXISTS api_keys;
DROP TABLE IF EXISTS provider_key_metadata;
