-- Migration: Add missing columns to invites table
-- Created: 2026-06-19
--
-- SECURITY FIX (XC-03 / P0):
-- The original invites table (20260210000100_cp_orgs) was created with only:
--   id, org_id, email, role, created_at, accepted_at
--
-- InviteService references three columns that do not exist in that schema:
--   - status   (used by checkDuplicateInvite, invite, revokeInvite)
--   - expires_at (used by invite)
--   - updated_at (used by revokeInvite)
--
-- Without this migration every InviteService method throws
-- "column does not exist" at runtime, completely breaking the invite feature.
--
-- Column semantics:
--   status     - invite lifecycle: 'pending' | 'accepted' | 'revoked' | 'expired'
--   expires_at - NULL means no expiry; otherwise the invite link is invalid after
--                this timestamp (InviteService sets NOW() + INTERVAL '7 days')
--   updated_at - automatically maintained by trigger below

ALTER TABLE invites
  ADD COLUMN IF NOT EXISTS status     TEXT        NOT NULL DEFAULT 'pending'
    CONSTRAINT chk_invites_status CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Backfill: invites that were accepted before this migration have accepted_at set.
-- Promote those to status = 'accepted' so the constraint remains consistent.
UPDATE invites
  SET status = 'accepted'
  WHERE accepted_at IS NOT NULL
    AND status = 'pending';

-- Index used by checkDuplicateInvite:
--   SELECT ... WHERE org_id=$1 AND email=$2 AND status='pending'
-- A partial index on pending invites keeps this fast without scanning all rows.
CREATE INDEX IF NOT EXISTS idx_invites_org_email_pending
  ON invites (org_id, email)
  WHERE status = 'pending';

-- Index used by revokeInvite and general invite listing:
--   SELECT ... WHERE org_id=$1 ORDER BY created_at
CREATE INDEX IF NOT EXISTS idx_invites_org_status
  ON invites (org_id, status, created_at DESC);

-- Trigger to keep updated_at current on every UPDATE.
CREATE OR REPLACE FUNCTION trigger_set_invites_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  CREATE TRIGGER set_invites_updated_at
    BEFORE UPDATE ON invites
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_invites_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
