-- P0-3 FIX: Create monetization_decay_signals table
-- Referenced by monetization-decay-advisor.ts but never created,
-- causing runtime crashes for all monetization decay queries.

CREATE TABLE IF NOT EXISTS monetization_decay_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_version_id UUID NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  revenue_decline_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  decay_flag BOOLEAN NOT NULL DEFAULT FALSE,
  recommendations JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_revenue_decline_pct
    CHECK (revenue_decline_pct >= -100 AND revenue_decline_pct <= 100),
  CONSTRAINT chk_period_order
    CHECK (period_end > period_start)
);

-- Index for filtering by content_version_id (used in WHERE clause)
CREATE INDEX idx_mds_content_version_id
  ON monetization_decay_signals(content_version_id);

-- Partial index for decay_flag = true queries
CREATE INDEX idx_mds_decay_flag_true
  ON monetization_decay_signals(period_start DESC)
  WHERE decay_flag = TRUE;

-- BRIN index for time-series queries
CREATE INDEX idx_mds_period_start_brin
  ON monetization_decay_signals USING BRIN(period_start);
