-- Transactional outbox for at-least-once domain event delivery.
--
-- Events are written into this table inside the same database transaction as
-- the business state change.  A background relay worker (OutboxRelay) polls
-- this table with FOR UPDATE SKIP LOCKED, publishes each event, and marks it
-- as published_at = NOW().  The combination of a transactional write + relay
-- polling guarantees at-least-once delivery without distributed transactions.
--
-- NOTE: This table was previously created by the legacy control-plane
-- migration runner (control-plane/db/migrations/023_event_outbox.sql).
-- This migration brings it under the canonical Knex migration system so that
-- CI-enforced up/down round-trips are verified on every PR.

CREATE TABLE IF NOT EXISTS event_outbox (
  id            BIGSERIAL    PRIMARY KEY,
  event_name    TEXT         NOT NULL,
  event_version SMALLINT     NOT NULL DEFAULT 1,
  payload       JSONB        NOT NULL,
  meta          JSONB        NOT NULL DEFAULT '{}',
  occurred_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  published_at  TIMESTAMPTZ,
  retry_count   SMALLINT     NOT NULL DEFAULT 0,
  max_retries   SMALLINT     NOT NULL DEFAULT 5,
  last_error    TEXT,

  CONSTRAINT chk_event_outbox_retry_count CHECK (retry_count >= 0),
  CONSTRAINT chk_event_outbox_max_retries CHECK (max_retries > 0),
  CONSTRAINT chk_event_outbox_event_name  CHECK (length(event_name) > 0)
);

-- Relay worker polls unpublished events ordered by id (FIFO).
-- Partial index keeps the working set small: once published_at is set the row
-- drops out of this index automatically.
CREATE INDEX IF NOT EXISTS idx_event_outbox_unpublished
  ON event_outbox (id ASC)
  WHERE published_at IS NULL;

-- Cleanup / archival queries filter by published_at.
CREATE INDEX IF NOT EXISTS idx_event_outbox_published_at
  ON event_outbox (published_at)
  WHERE published_at IS NOT NULL;

-- Composite index to locate stuck events (exceeded max_retries) efficiently.
CREATE INDEX IF NOT EXISTS idx_event_outbox_stuck
  ON event_outbox (retry_count, max_retries)
  WHERE published_at IS NULL;
