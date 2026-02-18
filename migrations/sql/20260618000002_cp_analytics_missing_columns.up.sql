-- P0-2 FIX: Add columns referenced by analytics-read-model.ts but missing from
-- the original analytics_content schema (20260210001500_cp_analytics.up.sql).
-- Every call to incrementPublish() threw "column view_count does not exist",
-- silently zeroing all analytics data and breaking publish-count tracking.
ALTER TABLE analytics_content
  ADD COLUMN IF NOT EXISTS view_count BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS conversion_count BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS revenue NUMERIC(12,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_updated TIMESTAMPTZ;

-- Fix column type: TIMESTAMP → TIMESTAMPTZ to prevent DST/timezone misinterpretation.
ALTER TABLE analytics_content
  ALTER COLUMN last_published_at TYPE TIMESTAMPTZ
  USING last_published_at AT TIME ZONE 'UTC';
