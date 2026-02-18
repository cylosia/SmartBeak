-- Rollback: Remove billing schema fixes added in 20260619000000
DROP INDEX IF EXISTS idx_subscriptions_stripe_customer_id;
DROP INDEX IF EXISTS idx_subscriptions_stripe_sub_id;
DROP INDEX IF EXISTS idx_subscriptions_org_id;

ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_status_check;
ALTER TABLE subscriptions DROP COLUMN IF EXISTS cancelled_at;
ALTER TABLE subscriptions DROP COLUMN IF EXISTS updated_at;
ALTER TABLE subscriptions DROP COLUMN IF EXISTS current_period_end;
ALTER TABLE subscriptions DROP COLUMN IF EXISTS current_period_start;
ALTER TABLE subscriptions DROP COLUMN IF EXISTS stripe_subscription_id;
ALTER TABLE subscriptions DROP COLUMN IF EXISTS stripe_customer_id;

ALTER TABLE plans DROP CONSTRAINT IF EXISTS plans_price_cents_nonneg;
ALTER TABLE plans DROP COLUMN IF EXISTS features;
ALTER TABLE plans DROP COLUMN IF EXISTS interval;
