-- Rollback: Remove updated_at column from memberships
-- Created: 2026-06-20

ALTER TABLE memberships
  DROP COLUMN IF EXISTS updated_at;
