
-- Add optin_policy to email_optin_forms (skip if table absent)
DO $$ BEGIN
  ALTER TABLE email_optin_forms
  ADD COLUMN optin_policy text NOT NULL DEFAULT 'single'; -- single | double
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS email_optin_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id uuid NOT NULL,
  token text NOT NULL,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
