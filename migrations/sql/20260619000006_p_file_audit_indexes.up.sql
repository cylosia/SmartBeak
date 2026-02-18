-- P1-FIX: Add missing composite indexes identified in p-file security audit.
-- These indexes are required for correct query performance on hot analytical
-- and publishing query paths; their absence causes sequential table scans.

-- publishing_jobs: listJobs filters by domain_id and orders by created_at DESC.
-- Without this index every domain job list causes a full table scan.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_publishing_jobs_domain_created
  ON publishing_jobs (domain_id, created_at DESC);

-- keyword_metrics: getKeywordTrends and getTopKeywords filter by
-- (domain_id, keyword, timestamp). The compound index covers all three columns
-- and avoids a full-table scan followed by re-filter on keyword.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_keyword_metrics_domain_keyword_ts
  ON keyword_metrics (domain_id, keyword, timestamp DESC);

-- social_metrics: getSocialSummary filters by (content_id, timestamp).
-- Without this index each summary query scans the entire social_metrics table.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_social_metrics_content_ts
  ON social_metrics (content_id, timestamp DESC);

-- keyword_metrics: enforce uniqueness so ON CONFLICT DO NOTHING in the
-- analytics pipeline batch insert deduplicates on retry after transient errors.
-- The previous absence of this constraint caused duplicate rows on flush retry.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uidx_keyword_metrics_dedup
  ON keyword_metrics (domain_id, keyword, source, timestamp);
