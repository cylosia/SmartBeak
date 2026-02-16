-- Rollback: Reverse naming consistency changes (best-effort)

-- Drop the compliance view
DROP VIEW IF EXISTS naming_convention_compliance;

-- Reverse primary key renames (best-effort, skip if already reverted)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.table_constraints
               WHERE constraint_name = 'pk_organizations' AND table_name = 'organizations') THEN
        ALTER TABLE organizations RENAME CONSTRAINT pk_organizations TO organizations_pkey;
    END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.table_constraints
               WHERE constraint_name = 'pk_users' AND table_name = 'users') THEN
        ALTER TABLE users RENAME CONSTRAINT pk_users TO users_pkey;
    END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.table_constraints
               WHERE constraint_name = 'pk_memberships' AND table_name = 'memberships') THEN
        ALTER TABLE memberships RENAME CONSTRAINT pk_memberships TO memberships_pkey;
    END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.table_constraints
               WHERE constraint_name = 'pk_invites' AND table_name = 'invites') THEN
        ALTER TABLE invites RENAME CONSTRAINT pk_invites TO invites_pkey;
    END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Note: Foreign key and index renames performed by the up migration are
-- best-effort and cannot be perfectly reversed since the original names
-- are dynamically determined. The constraints and indexes remain functional.
