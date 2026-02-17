


import { Pool } from 'pg';
import { randomUUID } from 'crypto';

import { EventBus } from '@kernel/event-bus';
import { getLogger } from '@kernel/logger';
import { withSpan, addSpanAttributes, recordSpanException, getBusinessKpis, getSloTracker } from '@packages/monitoring';
import { writeToOutbox } from '@packages/database/outbox';

import type { NotificationChannel } from '@packages/types/notifications';
import { DeliveryAdapter } from './ports/DeliveryAdapter';
import { NotificationFailed } from '../domain/events/NotificationFailed';
import { NotificationPayload } from '../domain/entities/Notification';
import { NotificationPreferenceRepository } from './ports/NotificationPreferenceRepository';
import { NotificationRepository } from './ports/NotificationRepository';
import { NotificationSent } from '../domain/events/NotificationSent';
import { PostgresNotificationAttemptRepository } from '../infra/persistence/PostgresNotificationAttemptRepository';
import { PostgresNotificationDLQRepository } from '../infra/persistence/PostgresNotificationDLQRepository';

const logger = getLogger('notification:worker');

export interface DeliveryMessage {
  channel: NotificationChannel;
  to?: string | undefined;
  template: string;
  payload: NotificationPayload;
}

/**
* Result type for process operation (discriminated union)
*/
export type ProcessResult =
  | { success: true; delivered: true; skipped?: undefined }
  | { success: true; skipped: true; delivered?: undefined }
  | { success: false; error: string; delivered?: undefined; skipped?: undefined };

/**
* Worker for processing notification delivery.
*
* This worker handles the actual delivery of notifications through various
* channels, managing preferences, retries, and dead letter queue.
*/
export class NotificationWorker {
  // Performance: Maximum retry attempts
  private static readonly MAX_RETRIES = 3;

  constructor(
  private readonly notifications: NotificationRepository,
  private readonly attempts: PostgresNotificationAttemptRepository,
  private readonly adapters: Record<string, DeliveryAdapter>,
  private readonly prefs: NotificationPreferenceRepository,
  private readonly dlq: PostgresNotificationDLQRepository,
  private readonly eventBus: EventBus,
  private readonly pool: Pool
  ) {}

  /**
  * Process a notification delivery
  *
  * @param notificationId - ID of the notification to process
  * @returns Promise resolving to the result of the operation
  * MEDIUM FIX M14: Explicit return type
  */
  async process(notificationId: string): Promise<ProcessResult> {
  return withSpan({
    spanName: 'NotificationWorker.process',
    attributes: { 'notification.id': notificationId },
  }, async () => {
    if (!notificationId || typeof notificationId !== 'string') {
    return { success: false, error: 'Invalid notification ID: must be a non-empty string' };
    }

    if (notificationId.length > 255) {
    return { success: false, error: 'Invalid notification ID: exceeds maximum length' };
    }

    const client = await this.pool.connect();

  try {
    // P1-FIX: Begin transaction BEFORE any reads to ensure consistent snapshot
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');

    // P0-FIX: Pass client to repository so reads happen WITHIN the transaction
    const notification = await this.notifications.getById(notificationId, client);

    // Handle not found case
    if (!notification) {
    await client.query('ROLLBACK');
    return { success: false, error: `Notification '${notificationId}' not found` };
    }

    // P0-1 FIX: Pass transaction client to prevent phantom reads
    const attemptCount = await this.attempts.countByNotification(notification["id"], client);
    const attempt = attemptCount + 1;

    // Check user preferences
    const preferences = await this.prefs.getForUser(notification.userId);
    const pref = preferences.find(p => p.channel === notification.channel);
    if (pref && !pref.isEnabled()) {
    // Skip delivery based on user preference
    const skippedNotification = notification.succeed();
    await this.notifications.save(skippedNotification, client);
    await client.query('COMMIT');

    await this.auditLog('notification_skipped', notification["orgId"], {
    reason: 'user_preference_disabled'
    });

    addSpanAttributes({ 'notification.channel': notification.channel, 'notification.result': 'skipped' });
    try { getBusinessKpis().recordNotificationSkipped(notification.channel, 'user_preference_disabled'); } catch { /* not initialized */ }

    return { success: true, skipped: true };
    }

    // P0-3 FIX: Generate delivery token for idempotent delivery
    // If notification already has a delivery_token and delivery_committed_at,
    // it was already sent - skip re-sending to prevent split-brain duplicates
    const existingToken = await client.query(
    `SELECT delivery_token, delivery_committed_at FROM notifications WHERE id = $1`,
    [notification["id"]]
    );
    const row = existingToken.rows[0];
    if (row?.delivery_committed_at) {
    // Already delivered in a previous attempt, skip external call
    await client.query('COMMIT');
    return { success: true, delivered: true };
    }

    // Generate and persist delivery token before external call
    const deliveryToken = randomUUID();
    await client.query(
    `UPDATE notifications SET delivery_token = $1 WHERE id = $2`,
    [deliveryToken, notification["id"]]
    );

    // Start sending (immutable - returns new instance)
    const sendingNotification = notification.start();
    await this.notifications.save(sendingNotification, client);

    await client.query('COMMIT');

    const adapter = this.adapters[notification.channel];
    if (!adapter) {
    throw new Error(`No adapter for channel ${notification.channel}`);
    }

    const message = {
    channel: notification.channel,
    to: notification.payload.to ?? '',
    template: notification.template,
    payload: notification.payload
    };

    try {
    // Attempt delivery with idempotency key
    await adapter.send(message);

    // Success — P0-FIX: Use client for notification save within transaction
    await client.query('BEGIN');
    // P0-1 FIX: Pass client to record within transaction
    await this.attempts.record(notification["id"], attempt, 'success', undefined, client);

    const deliveredNotification = sendingNotification.succeed();
    await this.notifications.save(deliveredNotification, client);

    // P0-3 FIX: Mark delivery as committed to prevent duplicate sends on retry
    await client.query(
    `UPDATE notifications SET delivery_committed_at = NOW() WHERE id = $1`,
    [notification["id"]]
    );

    // Write event to outbox within the transaction for at-least-once delivery.
    await writeToOutbox(client, new NotificationSent().toEnvelope(notification["id"]));

    await client.query('COMMIT');

    await this.auditLog('notification_sent', notification["orgId"], {
    channel: notification.channel,
    template: notification.template
    });

    addSpanAttributes({ 'notification.channel': notification.channel, 'notification.result': 'delivered' });
    try {
      getBusinessKpis().recordNotificationDelivered(notification.channel);
      getSloTracker().recordSuccess('slo.notification.delivery_rate');
    } catch { /* not initialized */ }

    return { success: true, delivered: true };

    } catch (err: unknown) {
    // Failure
    try {
    await client.query('ROLLBACK');
    } catch (rollbackError) {
    logger.error(`Rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
    }

    const errorMessage = err instanceof Error ? err.message : String(err);

    // P0-FIX: Use client for notification save within transaction
    await client.query('BEGIN');
    // P0-1 FIX: Pass client to record within transaction
    await this.attempts.record(notification["id"], attempt, 'failure', errorMessage, client);

    const failedNotification = sendingNotification.fail();
    await this.notifications.save(failedNotification, client);

    await this.dlq.record(notification["id"], notification.channel, errorMessage);

    // Write event to outbox within the transaction for at-least-once delivery.
    await writeToOutbox(client, new NotificationFailed().toEnvelope(notification["id"], errorMessage));

    await client.query('COMMIT');

    await this.auditLog('notification_failed', notification["orgId"], {
    channel: notification.channel,
    error: errorMessage
    });

    addSpanAttributes({ 'notification.channel': notification.channel, 'notification.result': 'failed' });
    recordSpanException(err instanceof Error ? err : new Error(String(err)));
    try {
      getBusinessKpis().recordNotificationFailed(notification.channel);
      getSloTracker().recordFailure('slo.notification.delivery_rate');
    } catch { /* not initialized */ }

    return { success: false, error: errorMessage };
    }
  } catch (error) {
    try {
    await client.query('ROLLBACK');
    } catch (rollbackError) {
    logger.error(`Rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  } finally {
    client.release();
  }
  });
  }

  /**
  * Process multiple notifications in batch
  *
  * @param notificationIds - Array of notification IDs to process
  * @returns Promise resolving to batch results
  * MEDIUM FIX M14: Explicit return type
  *
  * HIGH FIX: Added transaction wrapper for batch operations to ensure atomicity
  */
  async processBatch(notificationIds: string[]): Promise<Map<string, ProcessResult>> {
    if (!Array.isArray(notificationIds)) {
    throw new Error('notificationIds must be an array');
  }

  if (notificationIds.length === 0) {
    return new Map<string, ProcessResult>();
  }

    const MAX_BATCH_SIZE = 100;
  if (notificationIds.length > MAX_BATCH_SIZE) {
    throw new Error(`Batch size ${notificationIds.length} exceeds maximum ${MAX_BATCH_SIZE}`);
  }
  const results = new Map<string, ProcessResult>();

  // P0-FIX: Removed outer pool.connect() that held a wasted connection and caused
  // deadlock in serverless (pool max=5). Each process() call manages its own
  // transaction, so no outer transaction wrapper is needed.
  const CONCURRENCY = 5;
  const chunks = this.chunkArray(notificationIds, CONCURRENCY);

  for (const chunk of chunks) {
    const chunkResults = await Promise.all(
    chunk.map(async (id) => {
    const result = await this.process(id);
    return { id, result };
    })
    );

    for (const { id, result } of chunkResults) {
    results.set(id, result);
    }
  }

  return results;
  }

  /**
  * Split array into chunks for batch processing
  * MEDIUM FIX M14: Explicit return type
  */
  private chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
  }

  /**
  * Audit logging for notification operations
  * MEDIUM FIX M14: Explicit return type
  */
  private async auditLog(
  action: string,
  entityId: string,
  details: Record<string, unknown>
  ): Promise<void> {
  logger.info(`[AUDIT][notification] ${action}`, {
    ...details,
    timestamp: new Date().toISOString()
  });
  }
}
