-- =====================================================
-- P0-A Rollback: Remove active subscription uniqueness constraint
-- =====================================================

DROP INDEX CONCURRENTLY IF EXISTS uq_subscriptions_org_active;
