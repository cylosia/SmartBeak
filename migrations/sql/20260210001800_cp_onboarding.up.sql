
CREATE TABLE IF NOT EXISTS org_onboarding (
  org_id TEXT PRIMARY KEY REFERENCES organizations(id),
  step_create_domain BOOLEAN DEFAULT false,
  step_create_content BOOLEAN DEFAULT false,
  step_publish_content BOOLEAN DEFAULT false,
  completed BOOLEAN DEFAULT false,
  updated_at TIMESTAMP DEFAULT now()
);
