


import { Pool } from 'pg';

import { getLogger } from '@kernel/logger';

import { NotificationPreference } from '../../domain/entities/NotificationPreference';
import { NotificationPreferenceRepository } from '../../application/ports/NotificationPreferenceRepository';

const logger = getLogger('notification:preference:repository');

/**
* Repository implementation for NotificationPreference using PostgreSQL
* */
export class PostgresNotificationPreferenceRepository implements NotificationPreferenceRepository {
  constructor(private pool: Pool) {}

  /**
  * Get notification preferences for a user
  * @param userId - User ID
  * @returns Array of NotificationPreference
  */
  async getForUser(userId: string): Promise<NotificationPreference[]> {
  // Validate input
  if (!userId || typeof userId !== 'string') {
    throw new Error('userId must be a non-empty string');
  }
  // Performance: Limit results to prevent unbounded queries
  const MAX_LIMIT = 100;

  try {
    const { rows } = await this.pool.query(
    `SELECT id, user_id, channel, enabled, frequency
    FROM notification_preferences WHERE user_id = $1
    LIMIT $2`,
    [userId, MAX_LIMIT]
    );

    return rows.map(r =>
    NotificationPreference.reconstitute(
    r["id"],
    r.user_id,
    r.channel,
    r.enabled,
    r.frequency
    )
    );
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to get preferences for user', err, { userId });
    throw error;
  }
  }

  /**
  * Get preference by user and channel
  * @param userId - User ID
  * @param channel - Channel name
  * @returns NotificationPreference or null if not found
  */
  async getByUserAndChannel(
  userId: string,
  channel: string
  ): Promise<NotificationPreference | null> {
  // Validate inputs
  if (!userId || typeof userId !== 'string') {
    throw new Error('userId must be a non-empty string');
  }
  if (!channel || typeof channel !== 'string') {
    throw new Error('channel must be a non-empty string');
  }
  try {
    const { rows } = await this.pool.query(
    `SELECT id, user_id, channel, enabled, frequency
    FROM notification_preferences
    WHERE user_id = $1 AND channel = $2`,
    [userId, channel]
    );

    if (!rows[0]) {
    return null;
    }

    return NotificationPreference.reconstitute(
    rows[0]["id"],
    rows[0].user_id,
    rows[0].channel,
    rows[0].enabled,
    rows[0].frequency
    );
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to get preference by user and channel', err, { userId, channel });
    throw error;
  }
  }

  /**
  * Upsert a notification preference
  * @param pref - NotificationPreference to upsert
  */
  async upsert(pref: NotificationPreference): Promise<void> {
  // Validate input
  if (!pref || typeof pref["id"] !== 'string') {
    throw new Error('preference must have a valid id');
  }
  try {
    await this.pool.query(
    `INSERT INTO notification_preferences (id, user_id, channel, enabled, frequency)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (id)
    DO UPDATE SET enabled = $4, frequency = $5`,
    [pref["id"], pref.userId, pref.channel, pref.isEnabled(), pref.frequency]
    );
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to upsert notification preference', err, {
    id: pref["id"],
    userId: pref.userId
    });
    throw error;
  }
  }

  /**
  * Delete a preference
  * @param id - Preference ID to delete
  */
  async delete(id: string): Promise<void> {
  // Validate input
  if (!id || typeof id !== 'string') {
    throw new Error('id must be a non-empty string');
  }
  try {
    await this.pool.query(
    'DELETE FROM notification_preferences WHERE id = $1',
    [id]
    );
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to delete notification preference', err, { id });
    throw error;
  }
  }

  /**
  * Batch save preferences for better performance
  * @param prefs - Array of NotificationPreference to save
  */
  async batchSave(prefs: NotificationPreference[]): Promise<void> {
  // Validate input
  if (!Array.isArray(prefs)) {
    throw new Error('prefs must be an array');
  }

  if (prefs.length === 0) return;

  // Validate batch size limit
  const MAX_BATCH_SIZE = 1000;
  if (prefs.length > MAX_BATCH_SIZE) {
    throw new Error(
    `Batch size ${prefs.length} exceeds maximum allowed ${MAX_BATCH_SIZE}. ` +
    `Split into smaller batches.`
    );
  }

  // Limit chunk size for processing
  const CHUNK_SIZE = 100;
  if (prefs.length > CHUNK_SIZE) {
    for (let i = 0; i < prefs.length; i += CHUNK_SIZE) {
    await this.batchSave(prefs.slice(i, i + CHUNK_SIZE));
    }
    return;
  }

  const client = await this.pool.connect();
  try {
    await client.query('BEGIN');

    // Use unnest for efficient batch insert
    await client.query(
    `INSERT INTO notification_preferences (id, user_id, channel, enabled, frequency)
    SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[], $4::bool[], $5::text[])
    ON CONFLICT (id) DO UPDATE SET
    enabled = EXCLUDED.enabled,
    frequency = EXCLUDED.frequency`,
    [
    prefs.map(p => p["id"]),
    prefs.map(p => p.userId),
    prefs.map(p => p.channel),
    prefs.map(p => p.isEnabled()),
    prefs.map(p => p.frequency)
    ]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to batch save preferences', err, { count: prefs.length });
    throw error;
  } finally {
    client.release();
  }
  }
}
