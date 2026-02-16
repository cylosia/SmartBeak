-- Rollback: Drop domains, domain_transfers, and domain_registry tables
DROP INDEX IF EXISTS idx_domain_registry_lookup;
DROP INDEX IF EXISTS idx_domain_registry_org;
DROP TABLE IF EXISTS domain_registry CASCADE;

DROP INDEX IF EXISTS idx_domain_transfers_receipt;
DROP INDEX IF EXISTS idx_domain_transfers_domain;
DROP TABLE IF EXISTS domain_transfers CASCADE;

DROP INDEX IF EXISTS idx_domains_status;
DROP INDEX IF EXISTS idx_domains_org;
DROP TABLE IF EXISTS domains CASCADE;
