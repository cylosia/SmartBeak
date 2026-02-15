-- Fix content_keywords.content_id FK: was referencing keywords(id) instead of content_items(id)
-- See CODE_REVIEW_NON_TS.md finding C3

ALTER TABLE content_keywords
  DROP CONSTRAINT IF EXISTS content_keywords_content_id_fkey;

ALTER TABLE content_keywords
  ADD CONSTRAINT content_keywords_content_id_fkey
  FOREIGN KEY (content_id) REFERENCES content_items(id) ON DELETE CASCADE;
