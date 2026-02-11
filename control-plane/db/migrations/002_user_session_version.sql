-- Add session versioning for security
-- This allows forcing re-login when session is invalidated

ALTER TABLE users
ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 1;

-- Add stripe_customer_id for billing
ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;

-- Index for looking up org by stripe customer
CREATE INDEX IF NOT EXISTS idx_orgs_stripe_customer ON organizations(stripe_customer_id);
