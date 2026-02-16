-- Fix content_keywords.content_id FK: was referencing keywords(id) instead of content_items(id)
-- See CODE_REVIEW_NON_TS.md finding C3

-- Drop the incorrect FK constraint
ALTER TABLE content_keywords
  DROP CONSTRAINT IF EXISTS content_keywords_content_id_fkey;

-- Drop the composite primary key so we can change column types
ALTER TABLE content_keywords
  DROP CONSTRAINT IF EXISTS content_keywords_pkey;

-- content_keywords.content_id was created as UUID but content_items.id is TEXT.
-- Align the column type before adding the FK constraint.
ALTER TABLE content_keywords
  ALTER COLUMN content_id TYPE TEXT;

-- Recreate the composite primary key
ALTER TABLE content_keywords
  ADD CONSTRAINT content_keywords_pkey PRIMARY KEY (content_id, keyword_id);

-- Add the correct FK constraint pointing to content_items
ALTER TABLE content_keywords
  ADD CONSTRAINT content_keywords_content_id_fkey
  FOREIGN KEY (content_id) REFERENCES content_items(id) ON DELETE CASCADE;
