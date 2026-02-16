-- Rollback: Drop customers table and its indexes
DROP INDEX IF EXISTS idx_customers_org_id;
DROP INDEX IF EXISTS uk_customers_email;
DROP TABLE IF EXISTS customers CASCADE;
