import { Pool } from 'pg';
import { randomUUID } from 'crypto';

import { EventBus } from '@kernel/event-bus';
import { getLogger } from '@kernel/logger';
import { withSpan, addSpanAttributes, recordSpanException, getBusinessKpis, getSloTracker } from '@packages/monitoring';
import { writeToOutbox } from '@packages/database/outbox';

import { DeliveryAdapter, SendNotificationInput } from './ports/DeliveryAdapter';
import { NotificationAttemptRepository } from './ports/NotificationAttemptRepository';
import { NotificationDLQRepository } from './ports/NotificationDLQRepository';
import { NotificationFailed } from '../domain/events/NotificationFailed';
import { Notification, NotificationPayload } from '../domain/entities/Notification';
import { NotificationPreferenceRepository } from './ports/NotificationPreferenceRepository';
import { NotificationRepository } from './ports/NotificationRepository';
import { NotificationSent } from '../domain/events/NotificationSent';

const logger = getLogger('notification:worker');

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
*
* Transaction design (two-phase):
*   TX1 (pre-delivery): fetch notification + prefs, idempotency guard,
*         atomically claim delivery token, transition to 'sending' — COMMIT,
*         then immediately release the pool client.
*   External call: adapter.send() runs WITHOUT holding any DB client,
*         so the pool is never exhausted by slow I/O.
*   TX2 (post-delivery): record attempt, update final status, write
*         outbox event — COMMIT, release client.
*
* State machine for retries:
*   A notification arriving in 'failed' state (automatic retry) is
*   reset to 'pending' via SQL before the domain entity's start()
*   transition so the state machine invariant (pending→sending) holds.
*/
export class NotificationWorker {
  private static readonly MAX_RETRIES = 3;

  constructor(
  private readonly notifications: NotificationRepository,
  private readonly attempts: NotificationAttemptRepository,
  private readonly adapters: Record<string, DeliveryAdapter>,
  private readonly prefs: NotificationPreferenceRepository,
  private readonly dlq: NotificationDLQRepository,
  private readonly eventBus: EventBus,
  private readonly pool: Pool
  ) {}

  /**
  * Process a single notification delivery.
  *
  * @param notificationId - ID of the notification to process
  * @returns Promise resolving to the delivery result
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

    return this.processInner(notificationId);
  });
  }

  private async processInner(notificationId: string): Promise<ProcessResult> {
  // ── TX1: Pre-delivery read + atomic claim ───────────────────────────────
  // The client is released BEFORE the external adapter call so no pool slot
  // is held during potentially slow external I/O (email API, webhook POST).
  let sendingNotification: Notification;
  let notificationChannel: string;
  let notificationOrgId: string;
  let attemptNumber: number;
  let capturedAdapter: DeliveryAdapter;

  const preClient = await this.pool.connect();
  try {
    await preClient.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await preClient.query('SET LOCAL statement_timeout = $1', [10000]);

    const notification = await this.notifications.getById(notificationId, preClient);
    if (!notification) {
    await preClient.query('ROLLBACK');
    return { success: false, error: `Notification '${notificationId}' not found` };
    }

    const attemptCount = await this.attempts.countByNotification(notification['id'], preClient);
    attemptNumber = attemptCount + 1;

    // Move to DLQ when retry cap exceeded — write final 'failed' status via SQL
    // (the domain entity's fail() is not called here because the entity may be
    // in 'failed' state, and failed→failed is not a valid domain transition).
    if (attemptNumber > NotificationWorker.MAX_RETRIES) {
    await this.dlq.record(
      notification['id'],
      notification.channel,
      `Max retries (${NotificationWorker.MAX_RETRIES}) exceeded`,
      preClient
    );
    await preClient.query(
      `UPDATE notifications SET status = 'failed', updated_at = NOW() WHERE id = $1`,
      [notification['id']]
    );
    await preClient.query('COMMIT');
    logger.warn('Notification exceeded max retries, moved to DLQ', {
      notificationId: notification['id'],
      channel: notification.channel,
      attempts: attemptNumber,
    });
    return { success: false, error: 'Max retries exceeded' };
    }

    // Check user preference within the transaction.
    const preferences = await this.prefs.getForUser(notification.userId, preClient);
    const pref = preferences.find(p => p.channel === notification.channel);
    if (pref && !pref.isEnabled()) {
    const skippedNotification = notification.succeed();
    await this.notifications.save(skippedNotification, preClient);
    await preClient.query('COMMIT');

    await this.auditLog('notification_skipped', notification['orgId'], {
      notificationId: notification['id'],
      channel: notification.channel,
      reason: 'user_preference_disabled',
    });
    addSpanAttributes({ 'notification.channel': notification.channel, 'notification.result': 'skipped' });
    try { getBusinessKpis().recordNotificationSkipped(notification.channel, 'user_preference_disabled'); } catch { /* not initialized */ }
    return { success: true, skipped: true };
    }

    // Idempotency guard: if delivery was previously committed (post-delivery
    // TX2 succeeded), skip re-delivery even if state update somehow rolled back.
    const idempotencyCheck = await preClient.query(
    `SELECT delivery_committed_at FROM notifications WHERE id = $1`,
    [notification['id']]
    );
    const idRow = idempotencyCheck.rows[0] as { delivery_committed_at: Date | null } | undefined;
    if (idRow?.delivery_committed_at) {
    await preClient.query('COMMIT');
    return { success: true, delivered: true };
    }

    // Atomically claim the delivery token.  The WHERE delivery_token IS NULL
    // guard means only one worker wins the race; others will see rowCount = 0
    // and return early, preventing duplicate external deliveries.
    const deliveryToken = randomUUID();
    const claimResult = await preClient.query(
    `UPDATE notifications SET delivery_token = $1, updated_at = NOW()
     WHERE id = $2 AND delivery_token IS NULL`,
    [deliveryToken, notification['id']]
    );
    if (!claimResult.rowCount) {
    await preClient.query('ROLLBACK');
    return { success: true, delivered: true }; // another worker claimed it
    }

    // Validate the adapter BEFORE committing 'sending' state, so a missing
    // adapter never leaves the notification permanently stuck in 'sending'.
    // Capture to a local variable so TypeScript can narrow away 'undefined'.
    const resolvedAdapter = this.adapters[notification.channel];
    if (!resolvedAdapter) {
    await preClient.query('ROLLBACK');
    return { success: false, error: `No adapter configured for channel '${notification.channel}'` };
    }
    capturedAdapter = resolvedAdapter;

    // Failed notifications arriving for automatic retry must be reset to
    // 'pending' via SQL so the domain pending→sending transition stays valid.
    if (notification.status === 'failed') {
    await preClient.query(
      `UPDATE notifications SET status = 'pending', updated_at = NOW() WHERE id = $1`,
      [notification['id']]
    );
    }

    // isPending() is now true (either originally or after SQL reset above).
    sendingNotification = notification.start();
    await this.notifications.save(sendingNotification, preClient);

    notificationChannel = notification.channel;
    notificationOrgId = notification['orgId'];

    await preClient.query('COMMIT');
  } catch (preError) {
    try { await preClient.query('ROLLBACK'); } catch { /* ignore secondary error */ }
    const msg = preError instanceof Error ? preError.message : String(preError);
    logger.error('Pre-delivery transaction failed', preError instanceof Error ? preError : new Error(msg), { notificationId });
    return { success: false, error: msg };
  } finally {
    // Release BEFORE external I/O — this is the key pool-exhaustion fix.
    preClient.release();
  }

  // ── External I/O: no DB client held ─────────────────────────────────────
  const message: SendNotificationInput = {
    channel: notificationChannel,
    to: sendingNotification.payload.to ?? '',
    template: sendingNotification.template,
    payload: sendingNotification.payload,
  };

  let deliveryError: string | undefined;
  let deliverySucceeded = false;
  try {
    await capturedAdapter.send(message);
    deliverySucceeded = true;
  } catch (adapterErr: unknown) {
    deliveryError = adapterErr instanceof Error ? adapterErr.message : String(adapterErr);
    recordSpanException(adapterErr instanceof Error ? adapterErr : new Error(deliveryError));
  }

  // ── TX2: Post-delivery state update ─────────────────────────────────────
  const postClient = await this.pool.connect();
  try {
    await postClient.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await postClient.query('SET LOCAL statement_timeout = $1', [10000]);

    if (deliverySucceeded) {
    await this.attempts.record(sendingNotification['id'], attemptNumber, 'success', undefined, postClient);
    const deliveredNotification = sendingNotification.succeed();
    await this.notifications.save(deliveredNotification, postClient);
    await postClient.query(
      `UPDATE notifications SET delivery_committed_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [sendingNotification['id']]
    );
    await writeToOutbox(postClient, new NotificationSent().toEnvelope(sendingNotification['id']));
    await postClient.query('COMMIT');

    await this.auditLog('notification_sent', notificationOrgId, {
      notificationId: sendingNotification['id'],
      channel: notificationChannel,
      template: sendingNotification.template,
    });
    addSpanAttributes({ 'notification.channel': notificationChannel, 'notification.result': 'delivered' });
    try {
      getBusinessKpis().recordNotificationDelivered(notificationChannel);
      getSloTracker().recordSuccess('slo.notification.delivery_rate');
    } catch { /* not initialized */ }

    return { success: true, delivered: true };
    } else {
    const errorMessage = deliveryError ?? 'Unknown delivery error';
    await this.attempts.record(sendingNotification['id'], attemptNumber, 'failure', errorMessage, postClient);
    const failedNotification = sendingNotification.fail();
    await this.notifications.save(failedNotification, postClient);
    await this.dlq.record(sendingNotification['id'], notificationChannel, errorMessage, postClient);
    await writeToOutbox(postClient, new NotificationFailed().toEnvelope(sendingNotification['id'], errorMessage));
    await postClient.query('COMMIT');

    await this.auditLog('notification_failed', notificationOrgId, {
      notificationId: sendingNotification['id'],
      channel: notificationChannel,
      error: errorMessage,
    });
    addSpanAttributes({ 'notification.channel': notificationChannel, 'notification.result': 'failed' });
    try {
      getBusinessKpis().recordNotificationFailed(notificationChannel);
      getSloTracker().recordFailure('slo.notification.delivery_rate');
    } catch { /* not initialized */ }

    return { success: false, error: errorMessage };
    }
  } catch (postError) {
    try { await postClient.query('ROLLBACK'); } catch { /* ignore secondary error */ }
    const msg = postError instanceof Error ? postError.message : String(postError);
    logger.error('Post-delivery transaction failed', postError instanceof Error ? postError : new Error(msg), {
    notificationId,
    deliverySucceeded,
    });
    return { success: false, error: msg };
  } finally {
    postClient.release();
  }
  }

  /**
  * Process multiple notifications in batch.
  *
  * Each notification gets its own independent transaction pair (TX1+TX2).
  * Concurrency is capped at 5 to avoid pool exhaustion.
  *
  * @param notificationIds - IDs to process
  * @returns Map of ID → result
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
  const CONCURRENCY = 5;
  const chunks = this.chunkArray(notificationIds, CONCURRENCY);

  for (const chunk of chunks) {
    const chunkResults = await Promise.all(
    chunk.map(async (id) => ({ id, result: await this.process(id) }))
    );
    for (const { id, result } of chunkResults) {
    results.set(id, result);
    }
  }

  return results;
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
  }

  /**
  * Structured audit log — entityId always logged for forensic traceability.
  */
  private async auditLog(
  action: string,
  entityId: string,
  details: Record<string, unknown>
  ): Promise<void> {
  logger.info(`[AUDIT][notification] ${action}`, {
    entityId,
    ...details,
    timestamp: new Date().toISOString(),
  });
  }
}
