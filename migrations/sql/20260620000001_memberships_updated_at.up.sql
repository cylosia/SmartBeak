-- Migration: Add updated_at column to memberships
-- Created: 2026-06-20
-- P1-FIX: Role changes were previously invisible at the database level.
-- Without updated_at, a role escalation from viewer to owner left no trace
-- in the database row — only in the application log, which could be lost
-- in a process crash. This column enables:
--   1. Audit queries: SELECT * FROM memberships WHERE updated_at > $1
--   2. SOC2/ISO-27001 compliance: when was this role last changed?
--   3. Conflict detection: concurrent role updates visible via timestamp

ALTER TABLE memberships
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Backfill existing rows with created_at as best-effort estimate
UPDATE memberships SET updated_at = created_at WHERE updated_at IS NULL;
