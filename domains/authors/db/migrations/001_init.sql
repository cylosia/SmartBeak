
CREATE TABLE IF NOT EXISTS authors (
  id TEXT PRIMARY KEY,
  domain_id TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  avatar_url TEXT,
  bio TEXT NOT NULL,
  background_summary TEXT NOT NULL,
  expertise_tags TEXT[] NOT NULL,
  niche_depth TEXT NOT NULL,
  writing_tone TEXT NOT NULL,
  perspective TEXT NOT NULL,
  credibility_level TEXT NOT NULL,
  ymyi_flag BOOLEAN NOT NULL DEFAULT false,
  compliance_notes TEXT,
  do_not_write_about TEXT[],
  active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

-- P1-FIX: Add unique constraint on email to prevent duplicates
CREATE UNIQUE INDEX IF NOT EXISTS uk_authors_email ON authors(email);
