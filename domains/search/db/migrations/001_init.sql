
CREATE TABLE IF NOT EXISTS search_indexes (
  id TEXT PRIMARY KEY,
  domain_id TEXT NOT NULL,
  name TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS search_documents (
  id TEXT PRIMARY KEY,
  index_id TEXT NOT NULL,
  fields JSONB NOT NULL,
  status TEXT NOT NULL,
  updated_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS indexing_jobs (
  id TEXT PRIMARY KEY,
  index_id TEXT NOT NULL,
  content_id TEXT NOT NULL,
  action TEXT NOT NULL, -- index | delete
  status TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT now()
);
