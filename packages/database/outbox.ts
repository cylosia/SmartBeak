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
      JSON.stringify(event.payload),
      JSON.stringify(event.meta),
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
 */
export async function writeMultipleToOutbox(
  client: PoolClient,
  events: DomainEventEnvelope<unknown>[]
): Promise<void> {
  if (events.length === 0) return;

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
      JSON.stringify(event.payload),
      JSON.stringify(event.meta),
      event.occurredAt
    );
  }

  await client.query(
    `INSERT INTO event_outbox (event_name, event_version, payload, meta, occurred_at)
     VALUES ${placeholders.join(', ')}`,
    values
  );
}
