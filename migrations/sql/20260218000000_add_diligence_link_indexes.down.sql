-- Rollback: remove diligence link statistics indexes

DROP INDEX CONCURRENTLY IF EXISTS idx_links_broken;
DROP INDEX CONCURRENTLY IF EXISTS idx_links_source_external;
DROP INDEX CONCURRENTLY IF EXISTS idx_links_source_id;
DROP INDEX CONCURRENTLY IF EXISTS idx_pages_domain_id;
