/**
 * Outbox Relay Worker
 *
 * Polls the event_outbox table for unpublished events and publishes them
 * via the EventBus and BullMQ queue. This guarantees at-least-once delivery
 * by decoupling event persistence (done in the business transaction) from
 * event publishing (done asynchronously by this relay).
 *
 * Supports multiple relay instances via FOR UPDATE SKIP LOCKED.
 *
 * At-least-once delivery note: if eventBus.publish() succeeds but
 * enqueueEvent() fails, the event will be retried on the next poll cycle.
 * The event bus will therefore receive the event again.  All event bus
 * consumers MUST be idempotent.  BullMQ consumers are protected by the
 * outbox event ID being used as the job ID (deduplication window: 24 h).
 */

import { Pool } from 'pg';

import { EventBus } from '../event-bus';
import { enqueueEvent } from '../queues/bullmq-queue';
import { getLogger } from '../logger';
import { DomainEventEnvelope } from '@packages/types/domain-event';

const logger = getLogger('outbox-relay');

/**
 * Maximum number of characters stored in the last_error column.
 * The DB column is TEXT (unbounded); we truncate here to prevent
 * adversarially long error messages from filling disk.
 */
const MAX_LAST_ERROR_LENGTH = 2048;

export interface OutboxRelayOptions {
  /** Poll interval in milliseconds (default: 1000) */
  pollIntervalMs?: number;
  /** Maximum events per poll cycle (default: 50) */
  batchSize?: number;
  /** Also enqueue events to BullMQ (default: true) */
  publishToQueue?: boolean;
  /** Maximum backoff in milliseconds when consecutive poll cycles fail (default: 30000) */
  maxBackoffMs?: number;
}

interface OutboxRow {
  id: string;
  event_name: string;
  event_version: number;
  payload: unknown;
  meta: { correlationId: string; domainId: string; source: 'control-plane' | 'domain' };
  occurred_at: string;
  retry_count: number;
  max_retries: number;
}

/**
 * Outbox relay that polls unpublished events and delivers them.
 *
 * Usage:
 * ```typescript
 * const relay = new OutboxRelay(pool, eventBus, { pollIntervalMs: 500 });
 * relay.start();
 * // On shutdown:
 * await relay.stop();
 * ```
 */
export class OutboxRelay {
  private running = false;
  private pollTimer: NodeJS.Timeout | undefined;
  private readonly pollIntervalMs: number;
  private readonly batchSize: number;
  private readonly publishToQueue: boolean;
  private readonly maxBackoffMs: number;

  /** Tracks whether a poll() call is currently executing, for graceful shutdown. */
  private pollInFlight = false;

  /**
   * Current delay before the next scheduled poll.  Starts at pollIntervalMs
   * and doubles on each consecutive failure (capped at maxBackoffMs).
   * Resets to pollIntervalMs after a successful cycle.
   */
  private currentBackoffMs: number;

  constructor(
    private readonly pool: Pool,
    private readonly eventBus: EventBus,
    options: OutboxRelayOptions = {}
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.batchSize = options.batchSize ?? 50;
    this.publishToQueue = options.publishToQueue ?? true;
    this.maxBackoffMs = options.maxBackoffMs ?? 30_000;
    this.currentBackoffMs = this.pollIntervalMs;
  }

  /**
   * Start the relay polling loop.
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    logger.info('Outbox relay started', {
      pollIntervalMs: this.pollIntervalMs,
      batchSize: this.batchSize,
    });
    void this.poll();
  }

  /**
   * Stop the relay, cancel pending polls, and wait for any in-flight poll
   * cycle to complete before resolving.  This ensures no open transactions
   * or connections are leaked on graceful shutdown.
   */
  async stop(): Promise<void> {
    this.running = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = undefined;
    }

    // Wait for any currently executing poll() to finish.  Polling at 10 ms
    // keeps shutdown latency low while avoiding a busy-spin.
    while (this.pollInFlight) {
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }

    logger.info('Outbox relay stopped');
  }

  /**
   * Single poll cycle: fetch unpublished events, publish, mark as done.
   */
  private async poll(): Promise<void> {
    if (!this.running) return;

    this.pollInFlight = true;
    // FIX (RL-02): Use a single client reference managed exclusively through
    // try/catch/finally so that the connection is ALWAYS released, even when
    // COMMIT throws in the empty-batch fast path.  Previously client.release()
    // was called inline inside the try block — if COMMIT threw, execution jumped
    // to the inner catch (which called release(true)) but had no reference to the
    // client, causing a connection leak.
    let client;
    try {
      client = await this.pool.connect();

      try {
        await client.query('BEGIN');

        // SELECT ... FOR UPDATE SKIP LOCKED allows multiple relay instances
        const { rows } = await client.query<OutboxRow>(
          `SELECT id, event_name, event_version, payload, meta, occurred_at,
                  retry_count, max_retries
           FROM event_outbox
           WHERE published_at IS NULL AND retry_count < max_retries
           ORDER BY id ASC
           LIMIT $1
           FOR UPDATE SKIP LOCKED`,
          [this.batchSize]
        );

        if (rows.length === 0) {
          // FIX (RL-02): Do NOT call client.release() here. The finally block
          // below unconditionally releases the connection, even if COMMIT throws.
          await client.query('COMMIT');
          this.resetBackoff();
          this.scheduleNext();
          return;
        }

        const publishedIds: string[] = [];
        const failedUpdates: Array<{ id: string; error: string }> = [];

        for (const row of rows) {
          // FIX (OR-1): Populate the `id` field so consumers can use the outbox
          // event's stable identifier for idempotency checks.  Previously `id`
          // was omitted, causing all reconstructed envelopes to have
          // `envelope.id === undefined`, silently breaking consumers that rely on
          // the field introduced in DomainEventEnvelope.id (EVT-3-FIX).
          const envelope: DomainEventEnvelope<string, unknown> = {
            id: row.id,
            name: row.event_name,
            version: row.event_version,
            occurredAt: row.occurred_at,
            payload: row.payload,
            meta: row.meta,
          };

          try {
            await this.eventBus.publish(envelope);

            if (this.publishToQueue) {
              await enqueueEvent(envelope);
            }

            publishedIds.push(row.id);
          } catch (err) {
            // FIX (OR-7): Truncate error message before storing to prevent
            // attacker-influenced exception strings from filling the TEXT column
            // (which has no DB-level length limit).
            const rawMsg = err instanceof Error ? err.message : String(err);
            const errorMsg = rawMsg.slice(0, MAX_LAST_ERROR_LENGTH);
            failedUpdates.push({ id: row.id, error: errorMsg });
            // FIX (P1-logger): pass the actual Error instance so stack traces
            // are captured; previously undefined was passed which loses context.
            logger.error(
              'Failed to publish outbox event',
              err instanceof Error ? err : new Error(rawMsg),
              { id: row.id, eventName: row.event_name }
            );
          }
        }

        // FIX (OR-6): Validate that all IDs are numeric strings (as pg returns
        // BIGSERIAL columns) before the ::bigint[] cast.  A non-numeric value
        // would cause a PostgreSQL runtime error inside this committed transaction,
        // leaving events published but not marked, creating duplicate deliveries.
        if (publishedIds.length > 0) {
          const allNumeric = publishedIds.every((id) => /^\d+$/.test(id));
          if (!allNumeric) {
            throw new Error(
              `OutboxRelay: non-numeric event ID(s) in publishedIds — expected BIGSERIAL strings. IDs: ${publishedIds.join(', ')}`
            );
          }
          await client.query(
            `UPDATE event_outbox SET published_at = NOW()
             WHERE id = ANY($1::bigint[])`,
            [publishedIds]
          );
        }

        // FIX (P1-n1): Batch the retry_count increments for failed events into a
        // single UPDATE using UNNEST instead of one round-trip per failure.
        // Previously this was an N+1 loop that caused O(failures) DB queries per
        // poll cycle, creating excessive load when the event bus is degraded.
        if (failedUpdates.length > 0) {
          await client.query(
            `UPDATE event_outbox
             SET retry_count = retry_count + 1,
                 last_error  = updates.last_error
             FROM (
               SELECT
                 unnest($1::text[])::bigint AS id,
                 unnest($2::text[])         AS last_error
             ) AS updates
             WHERE event_outbox.id = updates.id`,
            [
              failedUpdates.map((f) => f.id),
              failedUpdates.map((f) => f.error),
            ]
          );
        }

        await client.query('COMMIT');

        logger.info('Outbox relay cycle complete', {
          published: publishedIds.length,
          failed: failedUpdates.length,
        });

        // FIX (P2-backoff): Only reset the backoff when at least one event was
        // successfully published.  If every event in the batch failed (e.g. the
        // event bus is degraded), keep increasing the delay so we don't hammer
        // the DB with tight polling loops while the downstream is unavailable.
        if (publishedIds.length > 0) {
          this.resetBackoff();
        } else {
          this.increaseBackoff();
        }
      } catch (err) {
        // FIX (P1-rollback): Log ROLLBACK failures so operators can detect
        // connections left open due to network errors. Re-throw the original
        // error so the outer catch sees the root cause.
        await client.query('ROLLBACK').catch((rbErr: unknown) => {
          logger.error(
            'OutboxRelay: ROLLBACK failed',
            rbErr instanceof Error ? rbErr : new Error(String(rbErr))
          );
        });
        // Signal the pool that this connection may be in a bad state.
        client.release(true);
        // Nullify to prevent double-release in the outer finally.
        client = undefined;
        throw err;
      } finally {
        // FIX (RL-02): Always release the connection if the inner catch did not
        // already do so (i.e. the happy path where no error occurred).
        if (client !== undefined) {
          client.release();
          client = undefined;
        }
      }
    } catch (err) {
      logger.error(
        'Outbox relay poll error',
        err instanceof Error ? err : new Error(String(err))
      );
      // FIX (P1-backoff): double the delay on each consecutive failure so a
      // persistent downstream outage (DB down, event bus unavailable) does not
      // create a tight retry loop that saturates the connection pool.
      this.increaseBackoff();
    } finally {
      this.pollInFlight = false;
    }

    this.scheduleNext();
  }

  private scheduleNext(): void {
    if (this.running) {
      this.pollTimer = setTimeout(() => { void this.poll(); }, this.currentBackoffMs);
    }
  }

  private resetBackoff(): void {
    this.currentBackoffMs = this.pollIntervalMs;
  }

  private increaseBackoff(): void {
    this.currentBackoffMs = Math.min(this.currentBackoffMs * 2, this.maxBackoffMs);
  }
}
