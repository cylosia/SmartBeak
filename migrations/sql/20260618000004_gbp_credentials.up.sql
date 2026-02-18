-- GBP Credentials: encrypted OAuth refresh token storage
-- P0-FIX: GbpAdapter.exchangeCode() references this table but no migration
-- existed. Every OAuth code exchange silently lost the refresh token because
-- the INSERT threw "relation gbp_credentials does not exist" which was caught
-- and swallowed. Users would see a successful OAuth but permanent re-auth loops.
--
-- Security properties:
-- - refresh_token stored AES-256-GCM encrypted (key from GBP_TOKEN_ENCRYPTION_KEY)
-- - one row per org (UNIQUE on org_id) — ON CONFLICT DO UPDATE
-- - no plain-text token column exists at all
-- - updated_at indexed for TTL-based token rotation jobs

CREATE TABLE IF NOT EXISTS gbp_credentials (
  id               BIGSERIAL     PRIMARY KEY,
  org_id           TEXT          NOT NULL,
  encrypted_refresh_token TEXT   NOT NULL,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_gbp_credentials_org UNIQUE (org_id),
  -- org_id must be a UUID — rejects arbitrary string injection
  CONSTRAINT chk_gbp_credentials_org_id CHECK (
    org_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  -- encrypted token is always "hex:hex:hex" (iv:authTag:ciphertext); reject blanks
  CONSTRAINT chk_gbp_credentials_token_nonempty CHECK (
    length(encrypted_refresh_token) > 0
  )
);

-- Index for TTL token rotation job: find tokens not refreshed in N days
CREATE INDEX IF NOT EXISTS idx_gbp_credentials_updated_at
  ON gbp_credentials (updated_at);

-- Trigger to keep updated_at current on every UPDATE
CREATE OR REPLACE FUNCTION trigger_set_gbp_credentials_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'set_gbp_credentials_updated_at'
    AND tgrelid = 'gbp_credentials'::regclass
  ) THEN
    CREATE TRIGGER set_gbp_credentials_updated_at
      BEFORE UPDATE ON gbp_credentials
      FOR EACH ROW EXECUTE FUNCTION trigger_set_gbp_credentials_updated_at();
  END IF;
END;
$$;
