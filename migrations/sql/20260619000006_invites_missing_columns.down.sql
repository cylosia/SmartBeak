-- Rollback: Remove columns added by 20260619000006_invites_missing_columns.up.sql

DROP TRIGGER IF EXISTS set_invites_updated_at ON invites;
DROP FUNCTION IF EXISTS trigger_set_invites_updated_at();

DROP INDEX IF EXISTS idx_invites_org_email_pending;
DROP INDEX IF EXISTS idx_invites_org_status;

ALTER TABLE invites
  DROP COLUMN IF EXISTS updated_at,
  DROP COLUMN IF EXISTS expires_at,
  DROP COLUMN IF EXISTS status;
