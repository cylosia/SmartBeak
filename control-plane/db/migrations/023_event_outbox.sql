-- Transactional outbox for at-least-once event delivery.
-- Events are written to this table within the same transaction as the
-- business state change, then a relay worker polls and publishes them.

CREATE TABLE IF NOT EXISTS event_outbox (
  id            BIGSERIAL PRIMARY KEY,
  event_name    TEXT        NOT NULL,
  event_version SMALLINT    NOT NULL DEFAULT 1,
  payload       JSONB       NOT NULL,
  meta          JSONB       NOT NULL,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at  TIMESTAMPTZ,
  retry_count   SMALLINT    NOT NULL DEFAULT 0,
  max_retries   SMALLINT    NOT NULL DEFAULT 5,
  last_error    TEXT
);

-- Relay worker polls unpublished events ordered by id
CREATE INDEX idx_event_outbox_unpublished
  ON event_outbox (id ASC)
  WHERE published_at IS NULL;

-- Cleanup queries filter by published_at
CREATE INDEX idx_event_outbox_published_at
  ON event_outbox (published_at)
  WHERE published_at IS NOT NULL;
