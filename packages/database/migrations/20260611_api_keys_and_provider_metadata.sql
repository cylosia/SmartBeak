-- P0-02: Migration for api_keys and provider_key_metadata tables
-- These tables are required by packages/security/keyRotation.ts
-- Previously only documented in markdown, never in an executable migration.
BEGIN;

-- Table: provider_key_metadata
-- Stores cryptographic salts for PBKDF2 key derivation per provider
CREATE TABLE IF NOT EXISTS provider_key_metadata (
  provider VARCHAR(255) PRIMARY KEY,
  salt VARCHAR(64) NOT NULL,  -- 32 bytes = 64 hex chars
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Table: api_keys
-- Stores encrypted API keys with rotation lifecycle management
CREATE TABLE IF NOT EXISTS api_keys (
  provider VARCHAR(255) PRIMARY KEY,
  encrypted_key TEXT,
  previous_key TEXT,
  rotation_interval_days INTEGER NOT NULL DEFAULT 90,
  grace_period_days INTEGER NOT NULL DEFAULT 7,
  rotated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '90 days',
  grace_period_end TIMESTAMPTZ,
  status VARCHAR(50) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'rotating', 'revoked')),
  scheduled_invalidation_at TIMESTAMPTZ,
  invalidation_status VARCHAR(50)
    CHECK (invalidation_status IS NULL OR invalidation_status IN ('pending', 'completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for scheduled invalidation queries (used by processScheduledInvalidations)
CREATE INDEX IF NOT EXISTS idx_api_keys_pending_invalidation
  ON api_keys (scheduled_invalidation_at)
  WHERE invalidation_status = 'pending';

-- Index for status-based queries
CREATE INDEX IF NOT EXISTS idx_api_keys_status
  ON api_keys (status);

-- Foreign key: provider_key_metadata references api_keys provider
-- Note: Not enforced as FK because provider_key_metadata may be created before api_keys entry

COMMIT;
