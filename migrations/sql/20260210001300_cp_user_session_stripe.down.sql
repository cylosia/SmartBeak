-- Rollback: Remove session_version from users, stripe_customer_id from organizations
DROP INDEX IF EXISTS idx_orgs_stripe_customer;
ALTER TABLE organizations DROP COLUMN IF EXISTS stripe_customer_id;
ALTER TABLE users DROP COLUMN IF EXISTS session_version;
