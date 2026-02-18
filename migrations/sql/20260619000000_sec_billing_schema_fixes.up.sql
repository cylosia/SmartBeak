-- Migration: Add missing billing columns and constraints
-- Audit findings: P0-001, P1-002, P1-008, P1-010
-- The original cp_billing migration was missing columns required by BillingService
-- and the Stripe webhook handler, causing runtime INSERT failures.

-- ============================================================
-- plans: add missing columns required by billing service
-- ============================================================

-- interval is queried by BillingService.assignPlan (SELECT id, name, price_cents, interval, ...)
ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS interval TEXT NOT NULL DEFAULT 'month';

-- features is queried by BillingService.assignPlan
ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS features JSONB NOT NULL DEFAULT '[]';

-- P1-010: Enforce non-negative price
ALTER TABLE plans
  DROP CONSTRAINT IF EXISTS plans_price_cents_nonneg,
  ADD CONSTRAINT plans_price_cents_nonneg CHECK (price_cents >= 0);

-- ============================================================
-- subscriptions: add missing columns required by webhook handler
-- ============================================================

-- Stripe webhook handler inserts stripe_customer_id
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;

-- Stripe webhook handler inserts stripe_subscription_id
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;

-- Stripe webhook handler inserts / updates current_period_start
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS current_period_start TIMESTAMPTZ;

-- Stripe webhook handler inserts / updates current_period_end
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ;

-- BillingService INSERT includes updated_at
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Stripe webhook handler sets cancelled_at on deletion
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

-- P1-008: Restrict status to known Stripe subscription states
ALTER TABLE subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_status_check,
  ADD CONSTRAINT subscriptions_status_check
    CHECK (status IN (
      'active', 'cancelled', 'past_due', 'trialing',
      'incomplete', 'incomplete_expired', 'unpaid', 'paused'
    ));

-- P1-002: Index on org_id for fast subscription lookup
CREATE INDEX IF NOT EXISTS idx_subscriptions_org_id
  ON subscriptions (org_id);

-- Index on stripe_subscription_id for webhook deduplication lookups
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_sub_id
  ON subscriptions (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

-- Index on stripe_customer_id for payment event lookups
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer_id
  ON subscriptions (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;
