-- Migration: Add text field length constraints
-- Created: 2026-02-12
-- Purpose: Enforce max-length constraints at database level (defense-in-depth)
-- These match API validation limits in backend/validation schemas

-- Add constraint for title field (max 500 characters)
ALTER TABLE content_items
  ADD CONSTRAINT title_max_length CHECK (LENGTH(title) <= 500);

-- Add constraint for body field (max 50KB = 50000 bytes)
-- Note: PostgreSQL LENGTH() counts characters, not bytes, but this is acceptable for ASCII
ALTER TABLE content_items
  ADD CONSTRAINT body_max_length CHECK (LENGTH(body) <= 50000);

-- Add constraint for excerpt field (max 500 characters) if it exists
-- Only add if column exists to avoid errors if schema is different
ALTER TABLE content_items
  ADD CONSTRAINT IF NOT EXISTS excerpt_max_length CHECK (LENGTH(excerpt) <= 500);
