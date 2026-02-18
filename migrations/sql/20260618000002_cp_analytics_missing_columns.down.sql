-- Rollback: remove columns added in up migration.
-- Note: last_published_at type rollback reverts TIMESTAMPTZ → TIMESTAMP (UTC data preserved).
ALTER TABLE analytics_content
  ALTER COLUMN last_published_at TYPE TIMESTAMP
  USING last_published_at AT TIME ZONE 'UTC';

ALTER TABLE analytics_content
  DROP COLUMN IF EXISTS last_updated,
  DROP COLUMN IF EXISTS revenue,
  DROP COLUMN IF EXISTS conversion_count,
  DROP COLUMN IF EXISTS view_count;
