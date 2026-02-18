/**
 * Outbox Relay Worker
 *
 * Polls the event_outbox table for unpublished events and publishes them
 * via the EventBus and BullMQ queue. This guarantees at-least-once delivery
 * by decoupling event persistence (done in the business transaction) from
 * event publishing (done asynchronously by this relay).
 *
 * Supports multiple relay instances via FOR UPDATE SKIP LOCKED.
 */

import { Pool } from 'pg';

import { EventBus } from '../event-bus';
import { enqueueEvent } from '../queues/bullmq-queue';
import { getLogger } from '../logger';
import { DomainEventEnvelope } from '@packages/types/domain-event';

const logger = getLogger('outbox-relay');

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
    try {
      const client = await this.pool.connect();

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
          await client.query('COMMIT');
          client.release();
          this.resetBackoff();
          this.scheduleNext();
          return;
        }

        const publishedIds: string[] = [];
        const failedUpdates: Array<{ id: string; error: string }> = [];

        for (const row of rows) {
          const envelope: DomainEventEnvelope<unknown> = {
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
            const errorMsg = err instanceof Error ? err.message : String(err);
            failedUpdates.push({ id: row.id, error: errorMsg });
            // FIX (P1-logger): pass the actual Error instance so stack traces
            // are captured; previously undefined was passed which loses context.
            logger.error(
              'Failed to publish outbox event',
              err instanceof Error ? err : new Error(errorMsg),
              { id: row.id, eventName: row.event_name }
            );
          }
        }

        // Mark successful events as published
        if (publishedIds.length > 0) {
          await client.query(
            `UPDATE event_outbox SET published_at = NOW()
             WHERE id = ANY($1::bigint[])`,
            [publishedIds]
          );
        }

        // Increment retry_count for failures
        for (const f of failedUpdates) {
          await client.query(
            `UPDATE event_outbox
             SET retry_count = retry_count + 1, last_error = $1
             WHERE id = $2`,
            [f.error, f.id]
          );
        }

        await client.query('COMMIT');
        client.release();

        logger.info('Outbox relay cycle complete', {
          published: publishedIds.length,
          failed: failedUpdates.length,
        });

        this.resetBackoff();
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        client.release(true);
        throw err;
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
