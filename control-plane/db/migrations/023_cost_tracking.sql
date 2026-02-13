-- Migration 023: Cost Tracking table
-- Supports CostTracker service for OpenAI/LLM spending enforcement

CREATE TABLE IF NOT EXISTS cost_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  service TEXT NOT NULL,
  operation TEXT NOT NULL,
  cost NUMERIC(12,6) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  tokens INTEGER NOT NULL DEFAULT 0,
  request_id TEXT DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  date DATE NOT NULL DEFAULT CURRENT_DATE,

  CONSTRAINT chk_cost_non_negative CHECK (cost >= 0)
);

-- Daily cost lookups by org (used by getTodayCost)
CREATE INDEX idx_cost_tracking_org_date
  ON cost_tracking(org_id, date);

-- Monthly aggregation queries (used by getBudgetStatus, getCostSummary)
CREATE INDEX idx_cost_tracking_org_date_service
  ON cost_tracking(org_id, date, service);

-- Time-series queries (used by getForecast)
CREATE INDEX idx_cost_tracking_date_brin
  ON cost_tracking USING BRIN(date);
