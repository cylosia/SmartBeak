-- Migration: Create metrics persistence table
-- Created: 2026-06-20
-- P0-FIX: The MetricsCollector.persistMetrics() method issues
-- INSERT INTO metrics (...) but this table never existed in any prior
-- migration.  Every persistMetrics() call silently failed with
-- "relation 'metrics' does not exist", discarding ALL persisted metrics.

CREATE TABLE IF NOT EXISTS metrics (
  id          BIGSERIAL    PRIMARY KEY,
  name        TEXT         NOT NULL,
  type        TEXT         NOT NULL CHECK (type IN ('counter', 'gauge', 'histogram', 'summary')),
  value       TEXT         NOT NULL,
  labels      JSONB        NOT NULL DEFAULT '{}',
  timestamp   TIMESTAMPTZ  NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Composite index for the most common query pattern: name + time range
CREATE INDEX IF NOT EXISTS idx_metrics_name_timestamp
  ON metrics (name, timestamp DESC);

-- Index for time-based range queries (retention sweeps, dashboards)
CREATE INDEX IF NOT EXISTS idx_metrics_timestamp
  ON metrics (timestamp DESC);

-- Index for label filtering (e.g. WHERE labels @> '{"env":"prod"}')
CREATE INDEX IF NOT EXISTS idx_metrics_labels_gin
  ON metrics USING GIN (labels);
