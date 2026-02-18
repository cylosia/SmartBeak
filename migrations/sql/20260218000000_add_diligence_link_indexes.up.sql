-- Add missing indexes for diligence link statistics queries
-- These indexes prevent sequential scans on large tables when computing
-- orphan pages, broken links, and external link statistics.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pages_domain_id
  ON pages(domain_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_links_source_id
  ON links(source_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_links_source_external
  ON links(source_id) WHERE is_external = true;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_links_broken
  ON links(id) WHERE broken = true;
