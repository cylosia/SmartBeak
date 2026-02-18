-- Rollback: Media cold-candidate index and org_id NOT NULL enforcement
-- Reverses migration 20260619000001_media_cold_index_orgid_notnull.up.sql

-- ============================================================================
-- SECTION 1: Drop functional partial index for cold candidate queries
-- ============================================================================

DROP INDEX IF EXISTS idx_media_cold_candidates;

-- ============================================================================
-- SECTION 2: Restore org_id to nullable
-- ============================================================================

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'media_assets'
      AND column_name = 'org_id'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE media_assets ALTER COLUMN org_id DROP NOT NULL;
  END IF;
END $$;

DO $$ BEGIN
  RAISE NOTICE 'Migration 20260619000001 rolled back: index dropped, org_id nullable restored';
END $$;
