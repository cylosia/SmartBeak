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
 * Assert that `client` is inside an active transaction.
 * Prevents phantom events from being committed when the caller forgot BEGIN.
 */
async function assertInTransaction(client: PoolClient): Promise<void> {
  // pg_current_xact_id_if_assigned() returns NULL when no transaction is active.
  const { rows } = await client.query<{ in_txn: boolean }>(
    `SELECT (pg_current_xact_id_if_assigned() IS NOT NULL) AS in_txn`
  );
  if (!rows[0]?.in_txn) {
    throw new Error(
      'writeToOutbox must be called within an active transaction (BEGIN not called)'
    );
  }
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
  // P1-5: Guard against accidental auto-commit writes that would produce phantom
  // domain events for rolled-back business transactions (e.g. billing for orders
  // that never committed).
  await assertInTransaction(client);

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

  // P1-5: Same transaction guard as writeToOutbox.
  await assertInTransaction(client);

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
