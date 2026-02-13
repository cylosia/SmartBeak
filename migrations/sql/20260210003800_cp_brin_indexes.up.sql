-- Migration: Add BRIN indexes for time-series data
-- P2-MEDIUM FIX: Add BRIN indexes for efficient time-series queries
-- Created: 2026-02-10

-- BRIN indexes are efficient for time-series data with natural temporal ordering
-- They are much smaller than B-tree indexes and faster to maintain

-- Organizations table
CREATE INDEX IF NOT EXISTS idx_organizations_created_at_brin 
  ON organizations USING BRIN (created_at) 
  WITH (pages_per_range = 128);

-- Users table  
CREATE INDEX IF NOT EXISTS idx_users_created_at_brin 
  ON users USING BRIN (created_at) 
  WITH (pages_per_range = 128);

-- Memberships table
CREATE INDEX IF NOT EXISTS idx_memberships_created_at_brin 
  ON memberships USING BRIN (created_at) 
  WITH (pages_per_range = 128);

-- Invites table
CREATE INDEX IF NOT EXISTS idx_invites_created_at_brin 
  ON invites USING BRIN (created_at) 
  WITH (pages_per_range = 128);

-- Audit events table (high volume time-series data)
CREATE INDEX IF NOT EXISTS idx_audit_events_created_at_brin 
  ON audit_events USING BRIN (created_at) 
  WITH (pages_per_range = 32);

-- Analytics events table (very high volume)
CREATE INDEX IF NOT EXISTS idx_analytics_events_created_at_brin 
  ON analytics_events USING BRIN (created_at) 
  WITH (pages_per_range = 32);

-- Publishing jobs table
CREATE INDEX IF NOT EXISTS idx_publishing_jobs_created_at_brin 
  ON publishing_jobs USING BRIN (created_at) 
  WITH (pages_per_range = 64);

-- Publishing attempts table
CREATE INDEX IF NOT EXISTS idx_publish_attempts_created_at_brin 
  ON publish_attempts USING BRIN (created_at) 
  WITH (pages_per_range = 32);

-- Notifications table
CREATE INDEX IF NOT EXISTS idx_notifications_created_at_brin 
  ON notifications USING BRIN (created_at) 
  WITH (pages_per_range = 64);

-- DLQ table
CREATE INDEX IF NOT EXISTS idx_publishing_dlq_created_at_brin 
  ON publishing_dlq USING BRIN (created_at) 
  WITH (pages_per_range = 32);

-- Usage metrics table (high volume time-series)
CREATE INDEX IF NOT EXISTS idx_usage_metrics_recorded_at_brin 
  ON usage_metrics USING BRIN (recorded_at) 
  WITH (pages_per_range = 32);

-- Cost optimization events
CREATE INDEX IF NOT EXISTS idx_cost_events_created_at_brin 
  ON cost_optimization_events USING BRIN (created_at) 
  WITH (pages_per_range = 64);

-- Comment explaining BRIN index benefits
COMMENT ON INDEX idx_audit_events_created_at_brin IS 
  'BRIN index for efficient time-range scans on high-volume audit data';
COMMENT ON INDEX idx_analytics_events_created_at_brin IS 
  'BRIN index for efficient time-range scans on analytics data';
COMMENT ON INDEX idx_usage_metrics_recorded_at_brin IS 
  'BRIN index for efficient time-range queries on usage metrics';
