

import { Pool } from 'pg';
import { randomUUID } from 'crypto';

import { getLogger } from '@kernel/logger';

const logger = getLogger('notification:dlq:repository');

// Maximum limit constant
const MAX_LIMIT = 1000;

/**
* Repository implementation for Notification DLQ (Dead Letter Queue) using PostgreSQL
* */
export class PostgresNotificationDLQRepository {
  constructor(private pool: Pool) {}

  /**
  * Record a notification in the DLQ
  */
  async record(notificationId: string, channel: string, reason: string): Promise<void> {
  // Validate input parameters
  if (!notificationId || typeof notificationId !== 'string') {
    throw new Error('notificationId must be a non-empty string');
  }
  if (!channel || typeof channel !== 'string') {
    throw new Error('channel must be a non-empty string');
  }
  if (!reason || typeof reason !== 'string') {
    throw new Error('reason must be a non-empty string');
  }

  try {
    await this.pool.query(
    `INSERT INTO notification_dlq (id, notification_id, channel, reason)
    VALUES ($1, $2, $3, $4)`,
    [randomUUID(), notificationId, channel, reason]
    );
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to record DLQ entry', err, {
    notificationId, channel, reason
    });
    throw error;
  }
  }

  /**
  * List DLQ entries scoped by organization
  * P1-FIX: Added orgId parameter to prevent cross-org data leakage.
  * Previously accepted only `limit` and returned all orgs' DLQ entries.
  */
  async list(orgId: string, limit = 50): Promise<Array<{
  id: string;
  notificationId: string;
  channel: string;
  reason: string;
  createdAt: Date;
  }>> {
  if (!orgId || typeof orgId !== 'string') {
    throw new Error('orgId must be a non-empty string');
  }
  // Validate limit
  const safeLimit = Math.min(Math.max(1, limit), MAX_LIMIT);

  try {
    const { rows } = await this.pool.query(
    `SELECT d.id, d.notification_id, d.channel, d.reason, d.created_at
    FROM notification_dlq d
    INNER JOIN notifications n ON d.notification_id = n.id
    WHERE n.org_id = $1
    ORDER BY d.created_at DESC
    LIMIT $2`,
    [orgId, safeLimit]
    );

    return rows.map(r => ({
    id: r["id"],
    notificationId: r.notification_id,
    channel: r.channel,
    reason: r.reason,
    createdAt: r.created_at,
    }));
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to list DLQ entries', err);
    throw error;
  }
  }

  /**
  * Delete DLQ entry by ID, scoped to the caller's org.
  * P0-FIX: Added orgId — without it any caller could delete any org's DLQ
  * entries, destroying compliance/audit records across tenants.
  */
  async delete(id: string, orgId: string): Promise<void> {
  if (!id || typeof id !== 'string') {
    throw new Error('id must be a non-empty string');
  }
  if (!orgId || typeof orgId !== 'string') {
    throw new Error('orgId must be a non-empty string');
  }
  try {
    await this.pool.query(
    `DELETE FROM notification_dlq
    WHERE id = $1
    AND notification_id IN (
      SELECT id FROM notifications WHERE org_id = $2
    )`,
    [id, orgId]
    );
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to delete DLQ entry', err, { id, orgId });
    throw error;
  }
  }

  /**
  * Get DLQ entry by ID, scoped to the caller's org.
  * P0-FIX: Added orgId — without it any caller could read any org's DLQ
  * entries (cross-tenant notification failure data leak).
  */
  async getById(id: string, orgId: string): Promise<{
  id: string;
  notificationId: string;
  channel: string;
  reason: string;
  createdAt: Date;
  } | null> {
  if (!id || typeof id !== 'string') {
    throw new Error('id must be a non-empty string');
  }
  if (!orgId || typeof orgId !== 'string') {
    throw new Error('orgId must be a non-empty string');
  }
  try {
    const { rows } = await this.pool.query(
    `SELECT d.id, d.notification_id, d.channel, d.reason, d.created_at
    FROM notification_dlq d
    JOIN notifications n ON d.notification_id = n.id
    WHERE d.id = $1 AND n.org_id = $2`,
    [id, orgId]
    );

    if (!rows[0]) return null;

    return {
    id: rows[0]["id"],
    notificationId: rows[0].notification_id,
    channel: rows[0].channel,
    reason: rows[0].reason,
    createdAt: rows[0].created_at,
    };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to get DLQ entry by ID', err, { id, orgId });
    throw error;
  }
  }
}
