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
 * Maximum length for event_name. Enforced here before hitting the DB constraint
 * so the caller receives a clear error rather than an opaque PostgreSQL message.
 * The DB schema CHECK only ensures length > 0; application layer adds upper bound.
 */
const MAX_EVENT_NAME_LENGTH = 255;

/**
 * JSON replacer that converts BigInt values to strings so that
 * JSON.stringify never throws "TypeError: Do not know how to serialize a BigInt".
 *
 * FIX (OW-1 / DB-01): Also detects circular references using a WeakSet.
 * Previously JSON.stringify would throw "TypeError: Converting circular structure
 * to JSON" even with a replacer, if the object graph contained a cycle.  A
 * circular payload or meta object would cause writeToOutbox to throw inside the
 * business transaction, rolling it back and losing the domain state change.
 *
 * Callers that need to reconstruct BigInt on the consumer side should document
 * which payload fields carry BigInt semantics.
 */
function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, function (_key, v) {
    // Handle BigInt
    if (typeof v === 'bigint') return v.toString();
    // Detect circular references
    if (typeof v === 'object' && v !== null) {
      if (seen.has(v)) {
        return '[Circular]';
      }
      seen.add(v);
    }
    return v;
  });
}

/**
 * Validate common event fields before persisting.
 * Throws a descriptive Error so the caller receives a clear message rather than
 * an opaque PostgreSQL constraint violation.
 *
 * FIX (OW-2/OW-3/DB-04): Validate event_name length, version positivity, and
 * occurredAt format at application level to surface clear errors early.
 */
function validateEvent(event: DomainEventEnvelope<string, unknown>): void {
  if (!event.name || typeof event.name !== 'string') {
    throw new Error('writeToOutbox: event.name is required and must be a non-empty string');
  }
  if (event.name.length > MAX_EVENT_NAME_LENGTH) {
    throw new Error(
      `writeToOutbox: event.name length ${event.name.length} exceeds maximum ${MAX_EVENT_NAME_LENGTH} characters`
    );
  }
  if (!Number.isInteger(event.version) || event.version < 1) {
    throw new Error(`writeToOutbox: event.version must be a positive integer, got ${String(event.version)}`);
  }
  // FIX (OW-2): occurredAt is a branded IsoDateString but the brand is only a
  // compile-time guarantee.  Validate the runtime value to catch casts-without-
  // validation (e.g. someString as IsoDateString) before they corrupt the table.
  if (!event.occurredAt || isNaN(new Date(event.occurredAt).getTime())) {
    throw new Error(`writeToOutbox: event.occurredAt is not a valid ISO date string: "${String(event.occurredAt)}"`);
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
  event: DomainEventEnvelope<string, unknown>
): Promise<void> {
  validateEvent(event);

  await client.query(
    `INSERT INTO event_outbox (event_name, event_version, payload, meta, occurred_at)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, $5)`,
    [
      event.name,
      event.version,
      // FIX (DB-02): Use explicit ::jsonb cast in the SQL rather than relying on
      // PostgreSQL's implicit text→jsonb coercion, which is version-dependent.
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
  events: DomainEventEnvelope<string, unknown>[]
): Promise<void> {
  if (events.length === 0) return;

  if (events.length > MAX_BATCH_SIZE) {
    throw new Error(
      `writeMultipleToOutbox: batch size ${events.length} exceeds maximum ${MAX_BATCH_SIZE}. ` +
      `Split into smaller batches to stay within PostgreSQL's 65,535 parameter limit.`
    );
  }

  // Validate all events before building the query — fail fast with a clear error
  // rather than a partial INSERT that is harder to debug.
  for (const event of events) {
    validateEvent(event);
  }

  const values: unknown[] = [];
  const placeholders: string[] = [];
  let paramIdx = 1;

  for (const event of events) {
    // FIX (P2-paramidx): Use a local base index and explicit offsets instead of
    // relying on post-increment side-effects inside a template literal.
    // The previous `$${paramIdx++}` pattern is legal (ES spec guarantees
    // left-to-right evaluation of template expressions) but is fragile: any
    // refactor that reorders the expressions silently breaks parameter binding.
    const base = paramIdx;
    paramIdx += 5;
    // FIX (DB-02): Explicit ::jsonb casts for payload and meta parameters.
    placeholders.push(
      `($${base}, $${base + 1}, $${base + 2}::jsonb, $${base + 3}::jsonb, $${base + 4})`
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
