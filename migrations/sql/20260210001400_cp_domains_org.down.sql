-- Rollback: Remove org_id column added to domain_registry
ALTER TABLE domain_registry DROP COLUMN IF EXISTS org_id;
