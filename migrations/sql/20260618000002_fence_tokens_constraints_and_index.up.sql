-- M17 FIX: Add CHECK constraints to fence_tokens to prevent invalid data.
-- Previously, fence_token could be negative and resource_type/resource_id could
-- be empty strings, which would silently create nonsensical fencing entries.
--
-- L1 FIX: Add index on updated_at for stale-token cleanup queries.
-- Without this, DELETE FROM fence_tokens WHERE updated_at < NOW() - INTERVAL '1 hour'
-- requires a full table scan.

ALTER TABLE fence_tokens
  ADD CONSTRAINT fence_tokens_token_non_negative
    CHECK (fence_token >= 0),
  ADD CONSTRAINT fence_tokens_resource_type_non_empty
    CHECK (resource_type <> '' AND LENGTH(resource_type) <= 100),
  ADD CONSTRAINT fence_tokens_resource_id_non_empty
    CHECK (resource_id <> '' AND LENGTH(resource_id) <= 256);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fence_tokens_updated_at
  ON fence_tokens (updated_at);
