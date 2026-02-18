-- P0-6 FIX: Add partial index on usage_alerts to prevent full table scans
-- under FOR UPDATE SKIP LOCKED in AlertService.check().
-- Without this index, every publish event acquired locks across the entire
-- unindexed table, serializing the publishing pipeline and causing deadlocks.
CREATE INDEX IF NOT EXISTS idx_usage_alerts_org_metric_active
  ON usage_alerts (org_id, metric)
  WHERE triggered = false;
