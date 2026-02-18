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
  // P0-3: Track the in-flight poll promise so stop() can drain it before returning.
  private pollPromise: Promise<void> | undefined;
  private readonly pollIntervalMs: number;
  private readonly batchSize: number;
  private readonly publishToQueue: boolean;
  // P2-7: Track consecutive outer errors for exponential backoff on DB outage.
  private consecutiveErrorCount = 0;
  private readonly maxBackoffMs = 60_000;

  constructor(
    private readonly pool: Pool,
    private readonly eventBus: EventBus,
    options: OutboxRelayOptions = {}
  ) {
    // P3-6: Validate constructor options to prevent silent no-op spin loops.
    const pollIntervalMs = options.pollIntervalMs ?? 1000;
    const batchSize = options.batchSize ?? 50;
    if (pollIntervalMs <= 0) throw new Error('pollIntervalMs must be > 0');
    if (batchSize <= 0) throw new Error('batchSize must be > 0');

    this.pollIntervalMs = pollIntervalMs;
    this.batchSize = batchSize;
    this.publishToQueue = options.publishToQueue ?? true;
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
    // P0-3: Assign to pollPromise so stop() can await it.
    this.pollPromise = this.poll();
  }

  /**
   * Stop the relay and wait for the in-flight poll cycle to complete.
   * Must be awaited by shutdown handlers before destroying the DB pool.
   */
  async stop(): Promise<void> {
    this.running = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = undefined;
    }
    // P0-3: Drain the in-flight poll before returning so the pool can be safely
    // destroyed without leaving orphaned connections or uncommitted transactions.
    if (this.pollPromise) await this.pollPromise;
    logger.info('Outbox relay stopped');
  }

  /**
   * Single poll cycle: fetch unpublished events, publish, mark as done.
   */
  private async poll(): Promise<void> {
    if (!this.running) return;

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
          this.consecutiveErrorCount = 0;
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

          // P0-2: Separate try/catch blocks for EventBus and BullMQ.
          // If EventBus succeeds but BullMQ throws, we must NOT add the row to
          // failedUpdates — doing so would cause EventBus re-delivery (double billing,
          // double webhooks) on the next poll cycle when the row is retried.
          let publishedInProcess = false;
          try {
            await this.eventBus.publish(envelope);
            publishedInProcess = true;
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            failedUpdates.push({ id: row.id, error: errorMsg });
            logger.error('Failed to publish outbox event to EventBus', undefined, {
              id: row.id,
              eventName: row.event_name,
              error: errorMsg,
            });
            continue; // EventBus failed — skip BullMQ, retry on next cycle
          }

          if (this.publishToQueue) {
            try {
              await enqueueEvent(envelope);
            } catch (err) {
              // BullMQ failure after successful EventBus delivery: log and continue.
              // Do NOT increment retry_count — the event was delivered in-process and
              // retrying would cause duplicate EventBus delivery.
              logger.error(
                'Failed to enqueue outbox event to BullMQ (in-process delivery succeeded)',
                undefined,
                {
                  id: row.id,
                  eventName: row.event_name,
                  error: err instanceof Error ? err.message : String(err),
                }
              );
            }
          }

          if (publishedInProcess) {
            publishedIds.push(row.id);
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

        // P1-9: Batch retry_count updates to avoid N sequential round-trips that hold
        // FOR UPDATE SKIP LOCKED row locks for the full duration of the loop.
        if (failedUpdates.length > 0) {
          const failedIds = failedUpdates.map(f => f.id);
          const failedErrors = failedUpdates.map(f => f.error);
          await client.query(
            `UPDATE event_outbox
             SET retry_count = retry_count + 1, last_error = u.err
             FROM unnest($1::bigint[], $2::text[]) AS u(id, err)
             WHERE event_outbox.id = u.id`,
            [failedIds, failedErrors]
          );
        }

        await client.query('COMMIT');
        client.release();

        this.consecutiveErrorCount = 0;
        logger.info('Outbox relay cycle complete', {
          published: publishedIds.length,
          failed: failedUpdates.length,
        });
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        client.release(true);
        throw err;
      }
    } catch (err) {
      this.consecutiveErrorCount++;
      logger.error(
        'Outbox relay poll error',
        err instanceof Error ? err : new Error(String(err))
      );
    }

    this.scheduleNext();
  }

  private scheduleNext(): void {
    if (!this.running) return;
    // P2-7: Exponential backoff on consecutive outer errors (pool.connect failures,
    // transaction errors) to avoid hammering a down DB at 1-second intervals.
    // Formula: pollIntervalMs * 2^(consecutiveErrors - 1), capped at maxBackoffMs.
    const delay = this.consecutiveErrorCount > 0
      ? Math.min(
          this.pollIntervalMs * Math.pow(2, this.consecutiveErrorCount - 1),
          this.maxBackoffMs
        )
      : this.pollIntervalMs;

    this.pollTimer = setTimeout(() => {
      this.pollPromise = this.poll();
    }, delay);
  }
}
