-- =====================================================
-- P0-A Defense-in-Depth: Active Subscription Uniqueness
-- =====================================================
--
-- Enforce at most one active subscription per organization at the database level.
-- This is a defense-in-depth constraint that backs up the Redis-based idempotency
-- lock added to BillingService.assignPlan(). Even if the application-level lock
-- is circumvented (Redis outage, race condition, retry storm), this constraint
-- prevents two active subscription rows from being inserted for the same org.
--
-- A partial unique index (WHERE status = 'active') is used so that historical
-- canceled/expired subscription rows can coexist for audit purposes.
--
-- CONCURRENTLY: runs without holding an ACCESS EXCLUSIVE lock, allowing reads
-- and writes during the index build.

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_subscriptions_org_active
  ON subscriptions (org_id)
  WHERE status = 'active';
