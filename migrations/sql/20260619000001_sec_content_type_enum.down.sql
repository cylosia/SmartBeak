-- Rollback: Restore original 5-value content_type CHECK constraint
-- WARNING: Any rows with content_type IN ('post','image','video') will prevent rollback.
-- Clean those rows first or use: DELETE FROM content_items WHERE content_type IN ('post','image','video');

ALTER TABLE content_items
  DROP CONSTRAINT IF EXISTS content_items_content_type_check;

ALTER TABLE content_items
  ADD CONSTRAINT content_items_content_type_check
    CHECK (content_type IN ('article', 'page', 'product', 'review', 'guide'));
