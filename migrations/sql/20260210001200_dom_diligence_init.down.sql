-- Rollback: Drop diligence_tokens table and its indexes
DROP INDEX IF EXISTS idx_diligence_tokens_expires;
DROP INDEX IF EXISTS idx_diligence_tokens_domain;
DROP INDEX IF EXISTS idx_diligence_tokens_token;
DROP TABLE IF EXISTS diligence_tokens CASCADE;
