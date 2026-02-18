-- Rollback: Security Audit Fixes
-- Created: 2026-02-18
-- Reverses all changes from the security audit fix migration.

-- SECTION 19: Drop content_items indexes
DROP INDEX IF EXISTS idx_content_items_scheduled_active;
DROP INDEX IF EXISTS idx_content_items_draft_active;
DROP INDEX IF EXISTS idx_content_items_published_active;
DROP INDEX IF EXISTS idx_content_items_active_domain_status;

-- SECTION 18: Remove domain_id from media_assets
DO $$ BEGIN
  ALTER TABLE media_assets DROP CONSTRAINT IF EXISTS fk_media_assets_domain;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;
DROP INDEX IF EXISTS idx_media_assets_domain_id;
DO $$ BEGIN
  ALTER TABLE media_assets DROP COLUMN IF EXISTS domain_id;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- SECTION 17: Restore original function (no-op - it was already dropped)

-- SECTION 16: Remove PK from tracking table (leave table intact)

-- SECTION 15: Drop mime_type CHECK constraint
DO $$ BEGIN
  ALTER TABLE media_assets DROP CONSTRAINT IF EXISTS chk_media_assets_mime_type;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- SECTION 14: Drop storage_key UNIQUE constraint
DO $$ BEGIN
  ALTER TABLE media_assets DROP CONSTRAINT IF EXISTS uq_media_assets_storage_key;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- SECTION 13: Drop status+created_at index
DROP INDEX IF EXISTS idx_media_assets_status_created;

-- SECTION 12: Restore NOT NULL on url and type (if columns exist)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'media_assets' AND column_name = 'url'
  ) THEN
    -- Set a default value first to satisfy NOT NULL
    UPDATE media_assets SET url = '' WHERE url IS NULL;
    ALTER TABLE media_assets ALTER COLUMN url SET NOT NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'media_assets' AND column_name = 'type'
  ) THEN
    UPDATE media_assets SET type = '' WHERE type IS NULL;
    ALTER TABLE media_assets ALTER COLUMN type SET NOT NULL;
  END IF;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- SECTION 11: Restore publishing_dlq CASCADE
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'publishing_dlq') THEN
    ALTER TABLE publishing_dlq DROP CONSTRAINT IF EXISTS publishing_dlq_publishing_job_id_fkey;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'publishing_jobs') THEN
      ALTER TABLE publishing_dlq
        ADD CONSTRAINT publishing_dlq_publishing_job_id_fkey
        FOREIGN KEY (publishing_job_id) REFERENCES publishing_jobs(id) ON DELETE CASCADE;
    END IF;
  END IF;
EXCEPTION WHEN undefined_table THEN NULL;
         WHEN undefined_column THEN NULL;
END $$;

-- SECTION 10: Restore subscriptions.plan_id to SET NULL
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'subscriptions') THEN
    ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_plan_id_fkey;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'plans') THEN
      ALTER TABLE subscriptions
        ADD CONSTRAINT subscriptions_plan_id_fkey
        FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE SET NULL;
    END IF;
  END IF;
EXCEPTION WHEN undefined_table THEN NULL;
         WHEN undefined_column THEN NULL;
END $$;

-- SECTION 9: Drop updated_at trigger
DROP TRIGGER IF EXISTS set_media_assets_updated_at ON media_assets;
DROP FUNCTION IF EXISTS trigger_set_media_updated_at();

-- SECTION 8: Drop CHECK constraints
DO $$ BEGIN
  ALTER TABLE media_assets DROP CONSTRAINT IF EXISTS chk_media_assets_size_bytes;
  ALTER TABLE media_assets DROP CONSTRAINT IF EXISTS chk_media_assets_storage_class;
  ALTER TABLE media_assets DROP CONSTRAINT IF EXISTS chk_media_assets_status;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- SECTION 7: Drop safe function
DROP FUNCTION IF EXISTS convert_timestamp_to_timestamptz_safe(TEXT, TEXT);

-- SECTION 6: Remove dedup guard entry
DO $$ BEGIN
  DELETE FROM _migration_timestamptz_fix WHERE status = 'security_audit_dedup_guard';
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- SECTION 5: Drop id length CHECK
DO $$ BEGIN
  ALTER TABLE media_assets DROP CONSTRAINT IF EXISTS chk_media_assets_id_length;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- SECTION 4: Revert TIMESTAMPTZ to TIMESTAMP on last_accessed_at
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'media_assets'
    AND column_name = 'last_accessed_at'
    AND data_type = 'timestamp with time zone'
  ) THEN
    ALTER TABLE media_assets
      ALTER COLUMN last_accessed_at TYPE TIMESTAMP
      USING last_accessed_at AT TIME ZONE 'UTC';
  END IF;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- SECTION 3: Remove defaults (no-op - defaults don't need removal)

-- SECTION 2: Revert content_media_links.content_id type
DO $$ BEGIN
  ALTER TABLE content_media_links DROP CONSTRAINT IF EXISTS fk_content_media_links_content;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- SECTION 1: Remove added columns from media_assets
DO $$ BEGIN
  ALTER TABLE media_assets DROP CONSTRAINT IF EXISTS fk_media_assets_org;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;
DROP INDEX IF EXISTS idx_media_assets_org_id;
DO $$ BEGIN
  ALTER TABLE media_assets
    DROP COLUMN IF EXISTS deleted_at,
    DROP COLUMN IF EXISTS updated_at,
    DROP COLUMN IF EXISTS created_at,
    DROP COLUMN IF EXISTS size_bytes,
    DROP COLUMN IF EXISTS org_id;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;
