


import { Pool, PoolClient } from 'pg';
import { validateNotificationPayload } from '@domain/shared/infra/validation/DatabaseSchemas';

import { getLogger } from '@kernel/logger';

import { Notification } from '../../domain/entities/Notification';
import { NotificationPayload } from '../../domain/entities/Notification';
import { NotificationRepository } from '../../application/ports/NotificationRepository';

const logger = getLogger('notification:repository');

/**
* Repository implementation for Notification using PostgreSQL
*
* P0-FIX: Proper transaction boundaries with BEGIN/COMMIT/ROLLBACK
*
* */
export class PostgresNotificationRepository implements NotificationRepository {
  constructor(private pool: Pool) {}

  private getQueryable(client?: PoolClient): Pool | PoolClient {
  return client || this.pool;
  }

  /**
  * Execute within transaction boundary
  * P0-FIX: Proper transaction wrapper with BEGIN/COMMIT/ROLLBACK
  */
  async withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
    await client.query('BEGIN');
    await client.query('SET LOCAL statement_timeout = $1', [30000]); // 30 seconds
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
    } catch (error) {
    try {
        await client.query('ROLLBACK');
    } catch (rollbackError) {
        const rollbackErr = rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
        logger.error('Rollback failed', rollbackErr);
    }
    throw error;
    } finally {
    client.release();
    }
  }

  /**
  * Get notification by ID

  * @param id - Notification ID
  * @param client - Optional client for transaction context
  * @returns Notification or null if not found
  */
  async getById(id: string, client?: PoolClient): Promise<Notification | null> {
  // Validate input
  if (!id || typeof id !== 'string') {
    throw new Error('id must be a non-empty string');
  }
  try {
    const queryable = this.getQueryable(client);
    const { rows } = await queryable.query(
    `SELECT id, org_id, user_id, channel, template, payload, status
    FROM notifications
    WHERE id = $1`,
    [id]
    );

    if (!rows[0]) {
    return null;
    }

    const r = rows[0];
    // Use reconstitute for immutable entity creation
    // Runtime validation of payload before type assertion
    const payload = typeof r.payload === 'object' && r.payload !== null
    ? (r.payload as NotificationPayload)
    : { data: r.payload } as NotificationPayload;

    return Notification.reconstitute(
    r["id"],
    r.org_id,
    r.user_id,
    r.channel,
    r.template,
    payload,
    r["status"]
    );
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to get notification by ID', err, { id });
    throw error;
  }
  }

  /**
  * Save a notification

  * @param notification - Notification to save
  * @param client - Optional client for transaction context
  */
  async save(notification: Notification, client?: PoolClient): Promise<void> {
  // Validate input
  if (!notification || typeof notification["id"] !== 'string') {
    throw new Error('notification must have a valid id');
  }
  // Validate JSONB payload before saving
  validateNotificationPayload(notification.payload);
  try {
    const queryable = this.getQueryable(client);

    // P1-FIX: Update all fields on conflict, not just status
    await queryable.query(
    `INSERT INTO notifications (id, org_id, user_id, channel, template, payload, status)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (id) DO UPDATE SET
    org_id = EXCLUDED.org_id,
    user_id = EXCLUDED.user_id,
    channel = EXCLUDED.channel,
    template = EXCLUDED.template,
    payload = EXCLUDED.payload,
    status = EXCLUDED.status,
    updated_at = now()`,
    [
    notification["id"],
    notification["orgId"],
    notification.userId,
    notification.channel,
    notification.template,
    JSON.stringify(notification.payload),
    notification["status"]
    ]
    );
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to save notification', err, {
    id: notification["id"],
    orgId: notification["orgId"]
    });
    throw error;
  }
  }

  /**
  * List pending notifications with pagination

  * @param limit - Maximum number of results
  * @param offset - Pagination offset
  * @param client - Optional client for transaction context
  * @returns Array of Notification
  */
  async listPending(
  limit: number = 100,
  offset: number = 0,
  client?: PoolClient
  ): Promise<Notification[]> {
  // Validate input parameters
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1) {
    throw new Error('limit must be a positive integer');
  }
  if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0) {
    throw new Error('offset must be a non-negative integer');
  }

  // P0-CRITICAL FIX: Clamp limit and offset to prevent unbounded pagination
  const MAX_SAFE_OFFSET = 10000;
  const safeLimit = Math.min(Math.max(1, limit), 500);
  const safeOffset = Math.min(Math.max(0, offset), MAX_SAFE_OFFSET);

  try {
    const queryable = this.getQueryable(client);
    const { rows } = await queryable.query(
    `SELECT id, org_id, user_id, channel, template, payload, status
    FROM notifications
    WHERE status IN ('pending', 'failed')
    ORDER BY created_at ASC
    LIMIT $1 OFFSET $2`,
    [safeLimit, safeOffset]
    );

    return rows.map(r => {
    // Runtime validation of payload before type assertion
    const payload = typeof r.payload === 'object' && r.payload !== null
    ? (r.payload as NotificationPayload)
    : { data: r.payload } as NotificationPayload;

    return Notification.reconstitute(
    r["id"],
    r.org_id,
    r.user_id,
    r.channel,
    r.template,
    payload,
    r["status"]
    );
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to list pending notifications', err);
    throw error;
  }
  }

  /**
  * List notifications by user with pagination

  * @param userId - User ID
  * @param limit - Maximum number of results
  * @param offset - Pagination offset
  * @param client - Optional client for transaction context
  * @returns Array of Notification
  */
  async listByUser(
  userId: string,
  limit: number = 20,
  offset: number = 0,
  client?: PoolClient
  ): Promise<Notification[]> {
  // Validate input parameters
  if (!userId || typeof userId !== 'string') {
    throw new Error('userId must be a non-empty string');
  }
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1) {
    throw new Error('limit must be a positive integer');
  }
  if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0) {
    throw new Error('offset must be a non-negative integer');
  }

  // P0-CRITICAL FIX: Clamp limit and offset to prevent unbounded pagination
  const MAX_SAFE_OFFSET = 10000;
  const safeLimit = Math.min(Math.max(1, limit), 100);
  const safeOffset = Math.min(Math.max(0, offset), MAX_SAFE_OFFSET);

  try {
    const queryable = this.getQueryable(client);
    const { rows } = await queryable.query(
    `SELECT id, org_id, user_id, channel, template, payload, status
    FROM notifications
    WHERE user_id = $1
    ORDER BY created_at DESC
    LIMIT $2 OFFSET $3`,
    [userId, safeLimit, safeOffset]
    );

    return rows.map(r => {
    // Runtime validation of payload before type assertion
    const payload = typeof r.payload === 'object' && r.payload !== null
    ? (r.payload as NotificationPayload)
    : { data: r.payload } as NotificationPayload;

    return Notification.reconstitute(
    r["id"],
    r.org_id,
    r.user_id,
    r.channel,
    r.template,
    payload,
    r["status"]
    );
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to list notifications by user', err, { userId });
    throw error;
  }
  }

  /**
  * Batch save notifications using unnest for efficient batch insert
  * P0-FIX: Proper transaction boundaries with automatic rollback

  * @param notifications - Array of Notification to save
  * @param client - Optional client for transaction context
  */
  async batchSave(notifications: Notification[], client?: PoolClient): Promise<void> {
  if (notifications.length === 0) return;

  const MAX_BATCH_SIZE = 1000;
  if (notifications.length > MAX_BATCH_SIZE) {
    throw new Error(
    `Batch size ${notifications.length} exceeds maximum allowed ${MAX_BATCH_SIZE}. ` +
    `Split into smaller batches.`
    );
  }

  // Performance: Limit chunk size for processing
  const CHUNK_SIZE = 100;
  if (notifications.length > CHUNK_SIZE) {
    for (let i = 0; i < notifications.length; i += CHUNK_SIZE) {
    await this.batchSave(notifications.slice(i, i + CHUNK_SIZE), client);
    }
    return;
  }

  // Validate all payloads before insert
  for (const notification of notifications) {
    validateNotificationPayload(notification.payload);
  }

  if (client) {
    await this.executeBatchSave(notifications, client);
    return;
  }

  // P0-FIX: Proper transaction boundary with explicit ROLLBACK
  const newClient = await this.pool.connect();
  try {
    await newClient.query('BEGIN');
    await newClient.query('SET LOCAL statement_timeout = $1', [60000]); // 60 seconds for batch
    await this.executeBatchSave(notifications, newClient);
    await newClient.query('COMMIT');
  } catch (error) {
    try {
    await newClient.query('ROLLBACK');
    } catch (rollbackError) {
    logger.error('Batch save rollback failed', rollbackError as Error);
    }
    throw error;
  } finally {
    newClient.release();
  }
  }

  /**
  * Internal batch save execution
  */
  private async executeBatchSave(
  notifications: Notification[],
  client: PoolClient
  ): Promise<void> {
  // Use unnest for efficient batch insert
  await client.query(
    `INSERT INTO notifications (id, org_id, user_id, channel, template, payload, status)
    SELECT * FROM UNNEST(
    $1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::jsonb[], $7::text[]
    )
    -- P1-FIX: Update all fields on conflict, not just status
    ON CONFLICT (id) DO UPDATE SET
    org_id = EXCLUDED.org_id,
    user_id = EXCLUDED.user_id,
    channel = EXCLUDED.channel,
    template = EXCLUDED.template,
    payload = EXCLUDED.payload,
    status = EXCLUDED.status,
    updated_at = now()`,
    [
    notifications.map(n => n["id"]),
    notifications.map(n => n["orgId"]),
    notifications.map(n => n.userId),
    notifications.map(n => n.channel),
    notifications.map(n => n.template),
    notifications.map(n => JSON.stringify(n.payload)),
    notifications.map(n => n["status"]),
    ]
  );
  }

  /**
  * Delete old notifications for cleanup

  * @param olderThan - Delete notifications older than this date
  * @param limit - Maximum number to delete
  * @param client - Optional client for transaction context
  * @returns Number of deleted notifications
  */
  async deleteOld(
  olderThan: Date,
  limit: number = 10000,
  client?: PoolClient
  ): Promise<number> {
  // Validate inputs
  if (!(olderThan instanceof Date) || isNaN(olderThan.getTime())) {
    throw new Error('olderThan must be a valid Date');
  }
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('limit must be a positive integer');
  }
  // Performance: Clamp limit to prevent unbounded deletions
  const safeLimit = Math.min(Math.max(1, limit), 10000);

  try {
    const queryable = this.getQueryable(client);
    const result = await queryable.query(
    `DELETE FROM notifications
    WHERE id IN (
    SELECT id FROM notifications
    WHERE created_at < $1
    AND status IN ('delivered', 'failed')
    LIMIT $2
    )`,
    [olderThan, safeLimit]
    );

    return result.rowCount || 0;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to delete old notifications', err);
    throw error;
  }
  }
}
