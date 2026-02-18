-- =====================================================
-- P1-5 Rollback: Re-grant UPDATE and DELETE on audit_events
-- =====================================================
--
-- WARNING: This rollback restores the ability to modify audit records.
-- Only apply if absolutely necessary and with explicit security review.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_role') THEN
    GRANT UPDATE, DELETE ON audit_events TO app_role;
  END IF;
END $$;
