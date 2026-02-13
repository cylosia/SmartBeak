
CREATE TABLE IF NOT EXISTS customer_profiles (
  id TEXT PRIMARY KEY,
  domain_id TEXT NOT NULL,
  name TEXT NOT NULL,
  summary TEXT NOT NULL,
  segment_type TEXT NOT NULL,
  intent_stage TEXT NOT NULL,
  goals TEXT[] NOT NULL,
  pain_points TEXT[] NOT NULL,
  objections TEXT[] NOT NULL,
  vocabulary_level TEXT NOT NULL,
  tone_preference TEXT NOT NULL,
  preferred_ctas TEXT[] NOT NULL,
  risk_sensitivity TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);
