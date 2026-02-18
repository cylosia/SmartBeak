-- Rollback: Remove columns added by fix_onboarding_columns
-- Note: the legacy step_* columns are preserved; only the new columns are dropped.

DO $$ BEGIN
  ALTER TABLE org_onboarding
    DROP CONSTRAINT IF EXISTS chk_onboarding_completed_consistency;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

ALTER TABLE org_onboarding
  DROP COLUMN IF EXISTS profile,
  DROP COLUMN IF EXISTS billing,
  DROP COLUMN IF EXISTS team,
  DROP COLUMN IF EXISTS created_at;
