-- Migration: Create site_shards table for shard deployment architecture
-- This table stores metadata for website shards that are deployed directly to Vercel

-- Create enum type for shard status
DO $$ BEGIN
    CREATE TYPE shard_status AS ENUM ('draft', 'building', 'deployed', 'failed', 'rolled_back');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create enum type for storage backend
DO $$ BEGIN
    CREATE TYPE storage_backend AS ENUM ('r2', 's3', 'local', 'gcs');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create the main site_shards table
CREATE TABLE IF NOT EXISTS site_shards (
    -- Primary identifier
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Relations
    site_id UUID NOT NULL, -- sites table managed externally
    parent_version_id UUID REFERENCES site_shards(id) ON DELETE SET NULL,
    
    -- Versioning
    version INTEGER NOT NULL,
    
    -- Status tracking
    status shard_status NOT NULL DEFAULT 'draft',
    
    -- Storage information
    storage_backend storage_backend NOT NULL DEFAULT 'r2',
    storage_path TEXT NOT NULL,
    -- Example: "shards/site-123/v1"
    
    -- File manifest (SHA hashes for Vercel upload)
    file_manifest JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Example: {
    --   "pages/index.tsx": {"sha": "abc123...", "size": 2048},
    --   "styles/globals.css": {"sha": "def456...", "size": 1024}
    -- }
    
    -- Theme configuration
    theme_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Example: {
    --   "themeId": "affiliate-comparison",
    --   "primaryColor": "#3b82f6",
    --   "siteName": "Best Tech Reviews"
    -- }
    
    -- Vercel integration
    vercel_project_id TEXT,
    vercel_deployment_id TEXT,
    vercel_url TEXT,
    vercel_inspector_url TEXT,
    
    -- Build/deployment tracking
    build_logs TEXT,                    -- Last build output (truncated)
    deployment_error TEXT,              -- Error message if deployment failed
    
    -- Content tracking
    total_files INTEGER DEFAULT 0,
    total_size_bytes INTEGER DEFAULT 0, -- Sum of all file sizes
    
    -- Audit
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deployed_at TIMESTAMPTZ,
    
    -- Constraints
    CONSTRAINT unique_site_version UNIQUE (site_id, version),
    CONSTRAINT positive_version CHECK (version > 0),
    CONSTRAINT valid_storage_path CHECK (storage_path ~ '^shards/[a-zA-Z0-9-_]+/v[0-9]+$')
);

-- Create indexes for common queries

-- Primary lookup by site
CREATE INDEX idx_site_shards_site_id ON site_shards(site_id);

-- Status-based queries (for monitoring deployments)
CREATE INDEX idx_site_shards_status ON site_shards(status) 
    WHERE status IN ('building', 'deployed', 'failed');

-- Find latest version for a site
CREATE INDEX idx_site_shards_site_version ON site_shards(site_id, version DESC);

-- Vercel project lookup (for rollbacks)
CREATE INDEX idx_site_shards_vercel_project ON site_shards(vercel_project_id) 
    WHERE vercel_project_id IS NOT NULL;

-- Time-based queries (for audit, cleanup)
CREATE INDEX idx_site_shards_created_at ON site_shards(created_at DESC);

-- Deployment time tracking
CREATE INDEX idx_site_shards_deployed_at ON site_shards(deployed_at DESC) 
    WHERE deployed_at IS NOT NULL;

-- Composite index for active deployments list
CREATE INDEX idx_site_shards_active ON site_shards(status, created_at DESC) 
    WHERE status IN ('draft', 'building');

-- GIN index for JSONB queries (theme lookup)
CREATE INDEX idx_site_shards_theme_config ON site_shards USING GIN (theme_config jsonb_path_ops);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_site_shards_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_site_shards_updated_at ON site_shards;

CREATE TRIGGER trigger_site_shards_updated_at
    BEFORE UPDATE ON site_shards
    FOR EACH ROW
    EXECUTE FUNCTION update_site_shards_updated_at();

-- Create view for latest shard version per site
CREATE OR REPLACE VIEW site_shards_latest AS
SELECT DISTINCT ON (site_id)
    id,
    site_id,
    version,
    status,
    storage_path,
    vercel_url,
    created_at,
    deployed_at
FROM site_shards
ORDER BY site_id, version DESC;

-- Create function to get next version number for a site
CREATE OR REPLACE FUNCTION get_next_shard_version(p_site_id UUID)
RETURNS INTEGER AS $$
DECLARE
    next_version INTEGER;
BEGIN
    SELECT COALESCE(MAX(version), 0) + 1
    INTO next_version
    FROM site_shards
    WHERE site_id = p_site_id;
    
    RETURN next_version;
END;
$$ LANGUAGE plpgsql;

-- Create table for shard file cache (optional optimization)
-- This can be used to cache frequently accessed file manifests
CREATE TABLE IF NOT EXISTS site_shard_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shard_id UUID NOT NULL REFERENCES site_shards(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    sha1_hash TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    content_type TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT unique_shard_file UNIQUE (shard_id, file_path)
);

CREATE INDEX idx_shard_files_shard ON site_shard_files(shard_id);
CREATE INDEX idx_shard_files_sha ON site_shard_files(sha1_hash);

-- Add comment for documentation
COMMENT ON TABLE site_shards IS 
'Stores metadata for website shards deployed directly to Vercel. ';

COMMENT ON COLUMN site_shards.file_manifest IS 
'JSON map of file paths to their SHA1 hashes and sizes. Used for Vercel API upload.';

COMMENT ON COLUMN site_shards.theme_config IS 
'JSON configuration for the site theme (colors, layout, content settings).';

COMMENT ON COLUMN site_shards.storage_path IS 
'Path in object storage (R2/S3) where the actual files are stored. Format: shards/{site-id}/v{version}';

-- Down migration (for reference)
-- DROP TABLE IF EXISTS site_shard_files;
-- DROP VIEW IF EXISTS site_shards_latest;
-- DROP TABLE IF EXISTS site_shards;
-- DROP TYPE IF EXISTS shard_status;
-- DROP TYPE IF EXISTS storage_backend;
-- DROP FUNCTION IF EXISTS get_next_shard_version(UUID);
-- DROP FUNCTION IF EXISTS update_site_shards_updated_at();
