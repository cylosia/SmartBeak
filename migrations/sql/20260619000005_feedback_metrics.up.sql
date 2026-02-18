-- feedback_metrics table
--
-- Stores time-windowed feedback aggregates per entity per organisation.
-- The feedbackIngestJob writes to this table via storeFeedbackMetrics().
--
-- P0 FIX: This table was referenced by feedbackIngestJob.ts / storeFeedbackMetrics()
-- but never created by any migration, causing the job to fail with
-- "relation 'feedback_metrics' does not exist" the moment it is scheduled.
--
-- The ON CONFLICT clause in storeFeedbackMetrics() requires a UNIQUE constraint
-- on (org_id, entity_id, window_days), added here as the primary composite key.

CREATE TABLE IF NOT EXISTS feedback_metrics (
  org_id       TEXT        NOT NULL,
  entity_id    TEXT        NOT NULL,
  window_days  INTEGER     NOT NULL,
  metric_count INTEGER     NOT NULL DEFAULT 0,
  positive_count INTEGER   NOT NULL DEFAULT 0,
  negative_count INTEGER   NOT NULL DEFAULT 0,
  neutral_count  INTEGER   NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Composite primary key satisfies the ON CONFLICT (org_id, entity_id, window_days)
  -- clause in storeFeedbackMetrics()
  PRIMARY KEY (org_id, entity_id, window_days),

  -- Referential integrity: org must exist
  CONSTRAINT fk_feedback_metrics_org
    FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,

  -- CHECK constraints to prevent invalid data
  CONSTRAINT chk_feedback_metrics_window_days
    CHECK (window_days IN (7, 30, 90)),
  CONSTRAINT chk_feedback_metrics_metric_count
    CHECK (metric_count >= 0),
  CONSTRAINT chk_feedback_metrics_positive_count
    CHECK (positive_count >= 0),
  CONSTRAINT chk_feedback_metrics_negative_count
    CHECK (negative_count >= 0),
  CONSTRAINT chk_feedback_metrics_neutral_count
    CHECK (neutral_count >= 0),
  -- Counts must be internally consistent: positives + negatives + neutrals <= total
  CONSTRAINT chk_feedback_metrics_counts_consistent
    CHECK (positive_count + negative_count + neutral_count <= metric_count),
  CONSTRAINT chk_feedback_metrics_entity_id_nonempty
    CHECK (entity_id <> '' AND LENGTH(entity_id) <= 256),
  CONSTRAINT chk_feedback_metrics_org_id_nonempty
    CHECK (org_id <> '')
);

-- Index for queries scoped to an org (e.g. listing all windows for an org)
CREATE INDEX IF NOT EXISTS idx_feedback_metrics_org_id
  ON feedback_metrics (org_id);

-- Index for entity-level lookups
CREATE INDEX IF NOT EXISTS idx_feedback_metrics_entity_id
  ON feedback_metrics (entity_id);

-- Index for stale-data cleanup by recency
CREATE INDEX IF NOT EXISTS idx_feedback_metrics_updated_at
  ON feedback_metrics (updated_at DESC);

-- updated_at trigger: keep updated_at current on every row UPDATE
CREATE OR REPLACE FUNCTION trigger_set_feedback_metrics_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  CREATE TRIGGER set_feedback_metrics_updated_at
    BEFORE UPDATE ON feedback_metrics
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_feedback_metrics_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
