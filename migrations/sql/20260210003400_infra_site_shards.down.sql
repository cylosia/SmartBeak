-- Rollback: Drop site_shards infrastructure (tables, views, functions, triggers, types)

-- Drop dependent table first
DROP INDEX IF EXISTS idx_shard_files_sha;
DROP INDEX IF EXISTS idx_shard_files_shard;
DROP TABLE IF EXISTS site_shard_files CASCADE;

-- Drop view
DROP VIEW IF EXISTS site_shards_latest;

-- Drop trigger
DROP TRIGGER IF EXISTS trigger_site_shards_updated_at ON site_shards;

-- Drop indexes
DROP INDEX IF EXISTS idx_site_shards_theme_config;
DROP INDEX IF EXISTS idx_site_shards_active;
DROP INDEX IF EXISTS idx_site_shards_deployed_at;
DROP INDEX IF EXISTS idx_site_shards_created_at;
DROP INDEX IF EXISTS idx_site_shards_vercel_project;
DROP INDEX IF EXISTS idx_site_shards_site_version;
DROP INDEX IF EXISTS idx_site_shards_status;
DROP INDEX IF EXISTS idx_site_shards_site_id;

-- Drop main table
DROP TABLE IF EXISTS site_shards CASCADE;

-- Drop functions
DROP FUNCTION IF EXISTS get_next_shard_version(UUID);
DROP FUNCTION IF EXISTS update_site_shards_updated_at();

-- Drop enum types
DROP TYPE IF EXISTS storage_backend CASCADE;
DROP TYPE IF EXISTS shard_status CASCADE;
