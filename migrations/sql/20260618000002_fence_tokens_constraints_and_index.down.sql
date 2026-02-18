DROP INDEX CONCURRENTLY IF EXISTS idx_fence_tokens_updated_at;

ALTER TABLE fence_tokens
  DROP CONSTRAINT IF EXISTS fence_tokens_token_non_negative,
  DROP CONSTRAINT IF EXISTS fence_tokens_resource_type_non_empty,
  DROP CONSTRAINT IF EXISTS fence_tokens_resource_id_non_empty;
