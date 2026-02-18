/**
 * Transactional Outbox Writer
 *
 * Writes domain events to the event_outbox table within an existing
 * database transaction. The outbox relay worker polls this table and
 * publishes events, guaranteeing at-least-once delivery.
 */

import { PoolClient } from 'pg';
import { DomainEventEnvelope } from '@packages/types/domain-event';

/**
 * PostgreSQL supports at most 65,535 bind parameters per query ($1 … $65535).
 * Each event occupies 5 parameters (name, version, payload, meta, occurred_at),
 * so a single batch INSERT must not exceed 65535 / 5 = 13,107 events.
 * We use a conservative 1,000-event ceiling to keep individual statements fast
 * and to leave headroom for future schema additions.
 */
const MAX_BATCH_SIZE = 1_000;

/**
 * JSON replacer that converts BigInt values to strings so that
 * JSON.stringify never throws "TypeError: Do not know how to serialize a BigInt".
 * Callers that need to reconstruct BigInt on the consumer side should document
 * which payload fields carry BigInt semantics.
 */
function safeStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    typeof v === 'bigint' ? v.toString() : v
  );
}

/**
 * Write a single event to the outbox table within an existing transaction.
 * The outbox relay will poll and publish this event later.
 *
 * @param client - The PoolClient participating in the caller's transaction
 * @param event - The domain event envelope to persist
 */
export async function writeToOutbox(
  client: PoolClient,
  event: DomainEventEnvelope<unknown>
): Promise<void> {
  await client.query(
    `INSERT INTO event_outbox (event_name, event_version, payload, meta, occurred_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      event.name,
      event.version,
      safeStringify(event.payload),
      safeStringify(event.meta),
      event.occurredAt,
    ]
  );
}

/**
 * Write multiple events to the outbox within an existing transaction.
 * Useful for batch operations that produce multiple events.
 *
 * @param client - The PoolClient participating in the caller's transaction
 * @param events - Array of domain event envelopes to persist
 * @throws Error if events.length exceeds MAX_BATCH_SIZE (1,000). Split into
 *         multiple calls for larger batches to stay within PostgreSQL's 65,535
 *         parameter limit and to keep individual statements fast.
 */
export async function writeMultipleToOutbox(
  client: PoolClient,
  events: DomainEventEnvelope<unknown>[]
): Promise<void> {
  if (events.length === 0) return;

  if (events.length > MAX_BATCH_SIZE) {
    throw new Error(
      `writeMultipleToOutbox: batch size ${events.length} exceeds maximum ${MAX_BATCH_SIZE}. ` +
      `Split into smaller batches to stay within PostgreSQL's 65,535 parameter limit.`
    );
  }

  const values: unknown[] = [];
  const placeholders: string[] = [];
  let paramIdx = 1;

  for (const event of events) {
    placeholders.push(
      `($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++})`
    );
    values.push(
      event.name,
      event.version,
      safeStringify(event.payload),
      safeStringify(event.meta),
      event.occurredAt
    );
  }

  await client.query(
    `INSERT INTO event_outbox (event_name, event_version, payload, meta, occurred_at)
     VALUES ${placeholders.join(', ')}`,
    values
  );
}
