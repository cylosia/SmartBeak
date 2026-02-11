
ALTER TABLE domain_registry
ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id);
