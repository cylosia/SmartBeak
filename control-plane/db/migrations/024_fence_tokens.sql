-- Fencing tokens for distributed lock validation.
-- Workers validate their fencing token before database writes to prevent
-- stale lock holders from corrupting data after lock expiration.

CREATE TABLE IF NOT EXISTS fence_tokens (
  resource_type TEXT        NOT NULL,
  resource_id   TEXT        NOT NULL,
  fence_token   BIGINT      NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (resource_type, resource_id)
);
