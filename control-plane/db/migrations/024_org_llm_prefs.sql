-- Migration 024: Organization LLM Preferences table
-- Stores per-org LLM model preferences and cost limits

CREATE TABLE IF NOT EXISTS org_llm_prefs (
  org_id TEXT PRIMARY KEY,
  preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
