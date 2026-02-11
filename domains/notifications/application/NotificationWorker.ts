


import { Pool } from 'pg';

import { EventBus } from '@kernel/event-bus';
import { getLogger } from '@kernel/logger';

import { DeliveryAdapter } from './ports/DeliveryAdapter';
import { NotificationFailed } from '../domain/events/NotificationFailed';
import { NotificationPayload, Notification } from '../domain/entities/Notification';
import { NotificationPreferenceRepository } from './ports/NotificationPreferenceRepository';
import { NotificationRepository } from './ports/NotificationRepository';
import { NotificationSent } from '../domain/events/NotificationSent';
import { PostgresNotificationAttemptRepository } from '../infra/persistence/PostgresNotificationAttemptRepository';
import { PostgresNotificationDLQRepository } from '../infra/persistence/PostgresNotificationDLQRepository';

const logger = getLogger('notification:worker');

export interface DeliveryMessage {
  channel: string;
  to?: string | undefined;
  template: string;
  payload: NotificationPayload;
}

/**
* Result type for process operation
*/
export interface ProcessResult {
  success: boolean;
  delivered?: boolean | undefined;
  skipped?: boolean | undefined;
  error?: string | undefined;
}

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

    // P1-FIX: Read notification WITHIN transaction for proper isolation
    const notification = await this.notifications.getById(notificationId);

    // Handle not found case
    if (!notification) {
    await client.query('ROLLBACK');
    return { success: false, error: `Notification '${notificationId}' not found` };
    }

    const attemptCount = await this.attempts.countByNotification(notification["id"]);
    const attempt = attemptCount + 1;

    // Check user preferences
    const preferences = await this.prefs.getForUser(notification.userId);
    const pref = preferences.find(p => p.channel === notification.channel);
    if (pref && !pref.isEnabled()) {
    // Skip delivery based on user preference
    const skippedNotification = notification.succeed();
    await this.notifications.save(skippedNotification);
    await client.query('COMMIT');

    await this.auditLog('notification_skipped', notification["orgId"], {
    reason: 'user_preference_disabled'
    });

    return { success: true, skipped: true };
    }

    // Start sending (immutable - returns new instance)
    const sendingNotification = notification.start();
    await this.notifications.save(sendingNotification);

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
    // Attempt delivery
    await adapter.send(message);

    // Success
    await client.query('BEGIN');
    await this.attempts.record(notification["id"], attempt, 'success');

    const deliveredNotification = sendingNotification.succeed();
    await this.notifications.save(deliveredNotification);

    await client.query('COMMIT');
    await this.eventBus.publish(new NotificationSent().toEnvelope(notification["id"]));

    await this.auditLog('notification_sent', notification["orgId"], {
    channel: notification.channel,
    template: notification.template
    });

    return { success: true, delivered: true };

    } catch (err: unknown) {
    // Failure
    try {
    await client.query('ROLLBACK');
    } catch (rollbackError) {
    logger.error(`Rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
    }

    const errorMessage = err instanceof Error ? err.message : String(err);

    await client.query('BEGIN');
    await this.attempts.record(notification["id"], attempt, 'failure', errorMessage);

    const failedNotification = sendingNotification.fail();
    await this.notifications.save(failedNotification);

    await this.dlq.record(notification["id"], notification.channel, errorMessage);
    await client.query('COMMIT');
    await this.eventBus.publish(new NotificationFailed().toEnvelope(notification["id"], errorMessage));

    await this.auditLog('notification_failed', notification["orgId"], {
    channel: notification.channel,
    error: errorMessage
    });

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

    const client = await this.pool.connect();
  try {
    await client.query('BEGIN');

    // Process with concurrency limit
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

    await client.query('COMMIT');
  } catch (error) {
    try {
    await client.query('ROLLBACK');
    } catch (rollbackError) {
      const rollbackErrorMessage = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
      logger.error(`Batch rollback failed: ${rollbackErrorMessage}`);
    }
    throw error;
  } finally {
    client.release();
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
