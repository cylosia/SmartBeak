-- Rollback: Drop initial organizations schema (users, organizations, memberships, invites)
DROP INDEX IF EXISTS idx_invites_org_id;
DROP TABLE IF EXISTS invites CASCADE;

DROP INDEX IF EXISTS idx_memberships_org_id;
DROP INDEX IF EXISTS idx_memberships_user_id;
DROP TABLE IF EXISTS memberships CASCADE;

DROP TABLE IF EXISTS organizations CASCADE;
DROP TABLE IF EXISTS users CASCADE;
