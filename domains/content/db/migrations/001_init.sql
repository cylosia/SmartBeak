-- Migration: Initial content_items table
-- Created: 2026-02-10
-- Author: SmartBeak System

CREATE TABLE IF NOT EXISTS content_items (
  id TEXT PRIMARY KEY,
  domain_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'scheduled', 'published', 'archived')),
  content_type TEXT DEFAULT 'article' CHECK (content_type IN ('article', 'page', 'product', 'review', 'guide', 'post', 'video', 'image')),
  publish_at TIMESTAMP,
  archived_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_content_items_domain_id ON content_items(domain_id);
CREATE INDEX IF NOT EXISTS idx_content_items_status ON content_items(status);
CREATE INDEX IF NOT EXISTS idx_content_items_domain_status ON content_items(domain_id, status);
CREATE INDEX IF NOT EXISTS idx_content_items_publish_at ON content_items(publish_at) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_content_items_updated_at ON content_items(updated_at DESC);

-- Migration validation: ensure schema matches entity
COMMENT ON TABLE content_items IS 'Content items table - schema must match ContentItem entity (9 fields)';
