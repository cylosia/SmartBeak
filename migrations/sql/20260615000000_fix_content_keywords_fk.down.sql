-- Revert: restore original (incorrect) FK pointing at keywords(id)

ALTER TABLE content_keywords
  DROP CONSTRAINT IF EXISTS content_keywords_content_id_fkey;

-- Revert column type back to UUID
ALTER TABLE content_keywords
  ALTER COLUMN content_id TYPE UUID USING content_id::UUID;

ALTER TABLE content_keywords
  ADD CONSTRAINT content_keywords_content_id_fkey
  FOREIGN KEY (content_id) REFERENCES keywords(id) ON DELETE CASCADE;
