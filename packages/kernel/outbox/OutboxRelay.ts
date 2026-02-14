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
  private readonly pollIntervalMs: number;
  private readonly batchSize: number;
  private readonly publishToQueue: boolean;

  constructor(
    private readonly pool: Pool,
    private readonly eventBus: EventBus,
    options: OutboxRelayOptions = {}
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.batchSize = options.batchSize ?? 50;
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
    this.poll();
  }

  /**
   * Stop the relay and cancel pending polls.
   */
  async stop(): Promise<void> {
    this.running = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = undefined;
    }
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
            logger.error('Failed to publish outbox event', undefined, {
              id: row.id,
              eventName: row.event_name,
              error: errorMsg,
            });
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
    }

    this.scheduleNext();
  }

  private scheduleNext(): void {
    if (this.running) {
      this.pollTimer = setTimeout(() => this.poll(), this.pollIntervalMs);
    }
  }
}
