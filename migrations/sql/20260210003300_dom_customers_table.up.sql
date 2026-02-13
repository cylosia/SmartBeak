-- P1-FIX: Create customers table with unique constraint on email
-- This table is used by CustomersService

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

-- P1-FIX: Add unique constraint on email to prevent duplicates
CREATE UNIQUE INDEX IF NOT EXISTS uk_customers_email ON customers(email);

-- Index for org-based queries
CREATE INDEX IF NOT EXISTS idx_customers_org_id ON customers(org_id);
