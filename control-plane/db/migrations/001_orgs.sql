-- Migration: Initial organizations schema
-- Created: 2026-02-10
-- Note: users table may conflict with Clerk-managed users
-- Consider removing users table if using Clerk exclusively

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memberships (
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  org_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','editor','viewer')),
  created_at TIMESTAMP DEFAULT now(),
  PRIMARY KEY (user_id, org_id)
);

CREATE INDEX IF NOT EXISTS idx_memberships_org_id ON memberships(org_id);
CREATE INDEX IF NOT EXISTS idx_memberships_user_id ON memberships(user_id);

CREATE TABLE IF NOT EXISTS invites (
  id TEXT PRIMARY KEY,
  org_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','editor','viewer')),
  created_at TIMESTAMP DEFAULT now(),
  accepted_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_invites_org_id ON invites(org_id);
