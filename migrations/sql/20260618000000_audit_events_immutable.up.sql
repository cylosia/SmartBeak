-- =====================================================
-- P1-5: Audit Events Table Immutability
-- =====================================================
--
-- Revoke UPDATE and DELETE privileges on audit_events from the application role.
-- Audit records must be append-only to satisfy SOC 2 / PCI-DSS requirements.
-- Any application role with UPDATE/DELETE on this table could tamper with the
-- forensic audit trail, destroying its evidentiary value.
--
-- Rollback: run the corresponding .down.sql migration.

DO $$
BEGIN
  -- Only revoke if the role exists — allows this migration to run in dev
  -- environments where app_role may not have been created yet.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_role') THEN
    REVOKE UPDATE, DELETE ON audit_events FROM app_role;
  END IF;
END $$;
