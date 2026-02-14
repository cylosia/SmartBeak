-- P0-1 FIX: Create content_media_links junction table
-- This table is referenced by media-lifecycle.ts findOrphaned() query
-- but was never created, causing runtime crashes in the media-cleanup job.

CREATE TABLE IF NOT EXISTS content_media_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id UUID NOT NULL,
  media_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT fk_content_media_links_media
    FOREIGN KEY (media_id)
    REFERENCES media_assets(id)
    ON DELETE CASCADE,

  CONSTRAINT uq_content_media_link
    UNIQUE (content_id, media_id)
);

-- Index for the NOT EXISTS subquery in findOrphaned()
CREATE INDEX idx_content_media_links_media_id
  ON content_media_links(media_id);

-- Index for lookups by content
CREATE INDEX idx_content_media_links_content_id
  ON content_media_links(content_id);
