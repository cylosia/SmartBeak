-- Rollback: drop the event_outbox table and all associated indexes.
-- WARNING: This will permanently destroy all unprocessed outbox events.
-- Only roll back in development or CI; never on a live system without
-- draining the relay worker first.

DROP INDEX IF EXISTS idx_event_outbox_stuck;
DROP INDEX IF EXISTS idx_event_outbox_published_at;
DROP INDEX IF EXISTS idx_event_outbox_unpublished;
DROP TABLE IF EXISTS event_outbox;
