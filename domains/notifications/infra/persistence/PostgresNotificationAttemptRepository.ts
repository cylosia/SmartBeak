

import { Pool } from 'pg';
import { randomUUID } from 'crypto';

import { getLogger } from '@kernel/logger';

const logger = getLogger('notification:attempt:repository');

/**
* Repository implementation for Notification Attempts using PostgreSQL
* */
export class PostgresNotificationAttemptRepository {
  constructor(private pool: Pool) {}

  /**
  * Record a notification attempt
  */
  async record(
  notificationId: string,
  attempt: number,
  status: 'success' | 'failure',
  error?: string
  ): Promise<void> {
  // Validate inputs
  if (!notificationId || typeof notificationId !== 'string') {
    throw new Error('notificationId must be a non-empty string');
  }
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new Error('attempt must be a positive integer');
  }

  // Limit error message length
  const safeError = error && error.length > 1000 ? error.slice(0, 1000) + '...' : error;

  try {
    await this.pool.query(
    `INSERT INTO notification_attempts (id, notification_id, attempt_number, status, error)
    VALUES ($1, $2, $3, $4, $5)`,
    [randomUUID(), notificationId, attempt, status, safeError ?? null]
    );
  } catch (err) {
    logger.error('Failed to record notification attempt', err as Error, {
    });
    throw err;
  }
  }

  /**
  * Get attempts for a notification
  */
  async listByNotification(notificationId: string, limit: number = 100): Promise<Array<{
  id: string;
  attemptNumber: number;
  status: string;
  error: string | null;
  createdAt: Date;
  }>> {
  // Validate input
  if (!notificationId || typeof notificationId !== 'string') {
    throw new Error('notificationId must be a non-empty string');
  }
  // Validate and cap limit
  const MAX_LIMIT = 1000;
  const safeLimit = Math.min(Math.max(1, limit), MAX_LIMIT);
  try {
    const { rows } = await this.pool.query(
    `SELECT id, attempt_number, status, error, created_at
    FROM notification_attempts
    WHERE notification_id = $1
    ORDER BY attempt_number ASC
    LIMIT $2`,
    [notificationId, safeLimit]
    );

    return rows.map(r => ({
    id: r["id"],
    attemptNumber: r.attempt_number,
    status: r["status"],
    error: r.error,
    createdAt: r.created_at,
    }));
  } catch (err) {
    logger.error('Failed to list notification attempts', err as Error, { notificationId });
    throw err;
  }
  }

  /**
  * Count attempts for a notification
  */
  async countByNotification(notificationId: string): Promise<number> {
  // Validate input
  if (!notificationId || typeof notificationId !== 'string') {
    throw new Error('notificationId must be a non-empty string');
  }
  try {
    const { rows } = await this.pool.query(
    `SELECT COUNT(*) as count
    FROM notification_attempts
    WHERE notification_id = $1`,
    [notificationId]
    );

    return parseInt(rows[0]?.count || '0', 10);
  } catch (err) {
    logger.error('Failed to count notification attempts', err as Error, { notificationId });
    throw err;
  }
  }
}
