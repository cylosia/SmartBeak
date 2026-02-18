-- Migration: Media cold-candidate index and org_id NOT NULL enforcement
-- Created: 2026-02-18
-- Addresses findings from hostile security audit (Phase 2 adversarial review):
--
--   FINDING: findColdCandidates() performs a sequential scan on media_assets
--   filtering by storage_class = 'hot' AND status != 'deleted' and ordering
--   by COALESCE(last_accessed_at, created_at). Without a matching partial
--   functional index the query degrades to O(n) full-table scan at scale.
--
--   FINDING: org_id column was added as nullable (ADD COLUMN ... UUID) in
--   20260619000000. After data backfill in application code, this column
--   should be enforced NOT NULL to guarantee tenant isolation at the DB level.

-- ============================================================================
-- SECTION 1: Functional partial index for cold candidate queries
--
-- Supports: SELECT ... FROM media_assets WHERE storage_class = 'hot'
--             AND status != 'deleted'
--           ORDER BY COALESCE(last_accessed_at, created_at) ASC
--           LIMIT N
--
-- The functional expression COALESCE(last_accessed_at, created_at) avoids
-- a full index scan when last_accessed_at is NULL (new assets). Partial
-- predicate (storage_class = 'hot' AND status != 'deleted') keeps the index
-- small, scoping it to only the rows the query touches.
-- ============================================================================

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'media_assets'
      AND column_name = 'storage_class'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'media_assets'
      AND column_name = 'last_accessed_at'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_media_cold_candidates
      ON media_assets (COALESCE(last_accessed_at, created_at) ASC)
      WHERE storage_class = 'hot'
        AND status != 'deleted';
  END IF;
END $$;

-- ============================================================================
-- SECTION 2: Enforce NOT NULL on org_id after backfill
--
-- The column was added nullable in the previous migration to allow backfill
-- without a table rewrite. Now that application code always writes org_id on
-- insert, we enforce NOT NULL to guarantee tenant isolation at the DB level.
--
-- IMPORTANT: This step will FAIL if any rows still have org_id IS NULL.
-- Run the backfill UPDATE first in a separate step if needed:
--   UPDATE media_assets SET org_id = '<default-org-id>' WHERE org_id IS NULL;
-- ============================================================================

DO $$ BEGIN
  -- Only apply NOT NULL if the column is currently nullable
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'media_assets'
      AND column_name = 'org_id'
      AND is_nullable = 'YES'
  ) THEN
    -- Verify no nulls remain before adding NOT NULL constraint
    IF EXISTS (
      SELECT 1 FROM media_assets WHERE org_id IS NULL LIMIT 1
    ) THEN
      RAISE EXCEPTION
        'Cannot add NOT NULL constraint on media_assets.org_id: NULL rows exist. '
        'Backfill with: UPDATE media_assets SET org_id = <default> WHERE org_id IS NULL';
    END IF;

    ALTER TABLE media_assets ALTER COLUMN org_id SET NOT NULL;
  END IF;
END $$;

DO $$ BEGIN
  RAISE NOTICE 'Migration 20260619000001 applied: cold candidate index + org_id NOT NULL';
END $$;
