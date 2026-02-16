-- Migration: Standardize naming conventions
-- P2-MEDIUM FIX: Naming consistency standardization
-- Created: 2026-02-10
-- 
-- This migration ensures consistent naming across all database objects:
-- - Table names: snake_case, plural
-- - Column names: snake_case
-- - Index names: idx_<table>_<column>
-- - Constraint names: consistent prefix (pk_, fk_, uq_, chk_)

-- ============================================================================
-- Standardize constraint naming
-- ============================================================================

-- Rename primary key constraints to pk_<table> format
DO $$
BEGIN
    -- Organizations
    IF EXISTS (SELECT 1 FROM information_schema.table_constraints 
               WHERE constraint_name = 'organizations_pkey' AND table_name = 'organizations') THEN
        ALTER TABLE organizations RENAME CONSTRAINT organizations_pkey TO pk_organizations;
    END IF;
    
    -- Users
    IF EXISTS (SELECT 1 FROM information_schema.table_constraints 
               WHERE constraint_name = 'users_pkey' AND table_name = 'users') THEN
        ALTER TABLE users RENAME CONSTRAINT users_pkey TO pk_users;
    END IF;
    
    -- Memberships
    IF EXISTS (SELECT 1 FROM information_schema.table_constraints 
               WHERE constraint_name = 'memberships_pkey' AND table_name = 'memberships') THEN
        ALTER TABLE memberships RENAME CONSTRAINT memberships_pkey TO pk_memberships;
    END IF;
    
    -- Invites
    IF EXISTS (SELECT 1 FROM information_schema.table_constraints 
               WHERE constraint_name = 'invites_pkey' AND table_name = 'invites') THEN
        ALTER TABLE invites RENAME CONSTRAINT invites_pkey TO pk_invites;
    END IF;
END $$;

-- ============================================================================
-- Standardize foreign key constraint naming
-- ============================================================================

DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT tc.constraint_name, tc.table_name, kcu.column_name,
               ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name
        FROM information_schema.table_constraints AS tc
        JOIN information_schema.key_column_usage AS kcu
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage AS ccu
            ON ccu.constraint_name = tc.constraint_name
            AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_schema = 'public'
    LOOP
        BEGIN
            -- Generate new name: fk_<table>_<column>_<ref_table>
            EXECUTE format('ALTER TABLE %I RENAME CONSTRAINT %I TO %I',
                r.table_name,
                r.constraint_name,
                'fk_' || r.table_name || '_' || r.column_name || '_' || r.foreign_table_name
            );
        EXCEPTION WHEN OTHERS THEN
            -- Constraint might already be renamed or have different format
            NULL;
        END;
    END LOOP;
END $$;

-- ============================================================================
-- Standardize index naming
-- ============================================================================

DO $$
DECLARE
    r RECORD;
BEGIN
    -- Rename indexes that don't follow idx_<table>_<column> convention
    FOR r IN
        SELECT indexname, tablename
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname NOT LIKE 'idx_%'
          AND indexname NOT LIKE 'pk_%'
          AND indexname NOT LIKE 'uq_%'
          AND indexname NOT LIKE '%_pkey'
    LOOP
        BEGIN
            -- Skip if already standard or is a primary key
            IF r.indexname NOT LIKE 'idx_%' THEN
                EXECUTE format('ALTER INDEX %I RENAME TO %I',
                    r.indexname,
                    'idx_' || r.tablename || '_' || regexp_replace(r.indexname, '.*_(.+)$', '\1')
                );
            END IF;
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END;
    END LOOP;
END $$;

-- ============================================================================
-- Add comments documenting naming conventions
-- ============================================================================

COMMENT ON TABLE organizations IS 
    'Organizations table - follows naming convention: snake_case, pk_<table> primary key';
COMMENT ON TABLE users IS 
    'Users table - follows naming convention: snake_case, pk_<table> primary key';
COMMENT ON TABLE memberships IS 
    'Memberships table - follows naming convention: snake_case, composite primary key';
COMMENT ON TABLE invites IS 
    'Invites table - follows naming convention: snake_case, pk_<table> primary key';

-- ============================================================================
-- Create view for naming convention compliance check
-- ============================================================================

CREATE OR REPLACE VIEW naming_convention_compliance AS
SELECT 
    'table' as object_type,
    tablename as object_name,
    CASE 
        WHEN tablename ~ '^[a-z][a-z0-9_]*$' THEN 'COMPLIANT'
        ELSE 'NON_COMPLIANT'
    END as status,
    'Table names should be snake_case and plural' as convention
FROM pg_tables 
WHERE schemaname = 'public'

UNION ALL

SELECT 
    'column' as object_type,
    table_name || '.' || column_name as object_name,
    CASE 
        WHEN column_name ~ '^[a-z][a-z0-9_]*$' THEN 'COMPLIANT'
        ELSE 'NON_COMPLIANT'
    END as status,
    'Column names should be snake_case' as convention
FROM information_schema.columns 
WHERE table_schema = 'public'

UNION ALL

SELECT 
    'index' as object_type,
    indexname as object_name,
    CASE 
        WHEN indexname ~ '^idx_[a-z][a-z0-9_]*$' 
          OR indexname ~ '^pk_[a-z][a-z0-9_]*$'
          OR indexname ~ '^uq_[a-z][a-z0-9_]*$'
          OR indexname LIKE '%_pkey'
        THEN 'COMPLIANT'
        ELSE 'NON_COMPLIANT'
    END as status,
    'Index names should be idx_<table>_<column> or pk_<table>' as convention
FROM pg_indexes 
WHERE schemaname = 'public';

-- ============================================================================
-- Grant permissions on compliance view
-- ============================================================================

DO $$ BEGIN
  GRANT SELECT ON naming_convention_compliance TO monitoring_role;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

COMMENT ON VIEW naming_convention_compliance IS 
    'View to check database object naming convention compliance';
