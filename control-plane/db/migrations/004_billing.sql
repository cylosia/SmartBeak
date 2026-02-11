
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  max_domains INTEGER,
  max_content INTEGER,
  price_cents INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  org_id TEXT REFERENCES organizations(id),
  plan_id TEXT REFERENCES plans(id),
  status TEXT NOT NULL,
  grace_until TIMESTAMP,
  created_at TIMESTAMP DEFAULT now()
);
