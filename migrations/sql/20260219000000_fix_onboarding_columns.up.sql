-- Migration: Fix org_onboarding column names
-- Created: 2026-02-19
--
-- The original migration (001800_cp_onboarding) created columns named
-- step_create_domain, step_create_content, step_publish_content, which do not
-- match the application code in OnboardingService, which references profile,
-- billing, and team.  Without this migration every call to onboarding.get()
-- and onboarding.mark() throws "column does not exist" at runtime.
--
-- This migration also adds the created_at column that the SELECT in get()
-- references but was absent from the original schema.

-- Add the columns the application actually queries
ALTER TABLE org_onboarding
  ADD COLUMN IF NOT EXISTS profile    BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS billing    BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS team       BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Seed data: promote any already-completed legacy steps into the new columns
-- so existing orgs are not reset to zero progress after the migration.
UPDATE org_onboarding
  SET profile = step_create_domain,
      billing = step_create_content,
      team    = step_publish_content
  WHERE step_create_domain IS NOT NULL
     OR step_create_content IS NOT NULL
     OR step_publish_content IS NOT NULL;

-- Add a CHECK constraint so the completed flag stays consistent with the
-- individual step flags (enforced by the application but belt-and-suspenders).
DO $$ BEGIN
  ALTER TABLE org_onboarding
    ADD CONSTRAINT chk_onboarding_completed_consistency
    CHECK (
      completed = false
      OR (profile AND billing AND team)
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
