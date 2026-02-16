-- Rollback: Drop email_optin_confirmations table and remove optin_policy column

DROP TABLE IF EXISTS email_optin_confirmations CASCADE;

-- Remove optin_policy column from email_optin_forms (skip if table absent)
DO $$ BEGIN
  ALTER TABLE email_optin_forms DROP COLUMN IF EXISTS optin_policy;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;
