-- Migration: Expand content_type CHECK constraint to match TypeScript entity
-- Audit finding: P0-002
-- ContentItem.ts defines ContentType as:
--   'article' | 'page' | 'product' | 'review' | 'guide' | 'post' | 'image' | 'video'
-- The original CHECK only allowed 5 values, causing constraint violations for
-- 'post', 'image', and 'video' content inserted via the application.

ALTER TABLE content_items
  DROP CONSTRAINT IF EXISTS content_items_content_type_check;

ALTER TABLE content_items
  ADD CONSTRAINT content_items_content_type_check
    CHECK (content_type IN (
      'article', 'page', 'product', 'review', 'guide',
      'post', 'image', 'video'
    ));
