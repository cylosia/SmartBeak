-- Rollback: Drop authors table and unique index
DROP INDEX IF EXISTS uk_authors_email;
DROP TABLE IF EXISTS authors CASCADE;
