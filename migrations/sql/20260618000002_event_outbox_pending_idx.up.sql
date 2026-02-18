-- P1-4: Add partial covering index for the outbox relay's poll query.
--
-- Without this index, PostgreSQL applies the `retry_count < max_retries` filter
-- as a post-index scan over ALL rows with published_at IS NULL (including
-- permanently-failed rows). As dead events accumulate, every 1-second poll
-- degrades toward a full-table scan.
--
-- The partial index covers only rows the relay actually cares about, keeping
-- poll performance O(batch_size) regardless of how many dead events exist.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_event_outbox_pending
  ON event_outbox (id ASC)
  WHERE published_at IS NULL AND retry_count < max_retries;
