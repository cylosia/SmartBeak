



import { Pool, PoolClient } from 'pg';

import { getLogger } from '@kernel/logger';

import { NotificationPreference } from '../../domain/entities/NotificationPreference';
import { NotificationPreferenceRepository, LockOptions } from '../../application/ports/NotificationPreferenceRepository';

const logger = getLogger('notification:preference:repository');

/**
* Repository implementation for NotificationPreference using PostgreSQL
* */
export class PostgresNotificationPreferenceRepository implements NotificationPreferenceRepository {
  constructor(private pool: Pool) {}

  /**
  * Get notification preferences for a user
  * @param userId - User ID
  * @param client - Optional PoolClient for transaction participation
  * @param options - Optional lock options (e.g., forUpdate)
  * @returns Array of NotificationPreference
  */
  async getForUser(userId: string, client?: PoolClient, options?: LockOptions): Promise<NotificationPreference[]> {
  // Validate input
  if (!userId || typeof userId !== 'string') {
    throw new Error('userId must be a non-empty string');
  }
  // Performance: Limit results to prevent unbounded queries
  const MAX_LIMIT = 100;
  const lockClause = options?.forUpdate ? 'FOR UPDATE' : '';

  try {
    const queryable = client || this.pool;
    const { rows } = await queryable.query(
    `SELECT id, user_id, channel, enabled, frequency
    FROM notification_preferences WHERE user_id = $1
    LIMIT $2 ${lockClause}`,
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
  * @param client - Optional PoolClient for transaction participation
  * @param options - Optional lock options (e.g., forUpdate)
  * @returns NotificationPreference or null if not found
  */
  async getByUserAndChannel(
  userId: string,
  channel: string,
  client?: PoolClient,
  options?: LockOptions
  ): Promise<NotificationPreference | null> {
  // Validate inputs
  if (!userId || typeof userId !== 'string') {
    throw new Error('userId must be a non-empty string');
  }
  if (!channel || typeof channel !== 'string') {
    throw new Error('channel must be a non-empty string');
  }
  const lockClause = options?.forUpdate ? 'FOR UPDATE' : '';

  try {
    const queryable = client || this.pool;
    const { rows } = await queryable.query(
    `SELECT id, user_id, channel, enabled, frequency
    FROM notification_preferences
    WHERE user_id = $1 AND channel = $2 ${lockClause}`,
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
  * @param client - Optional PoolClient for transaction participation
  */
  async upsert(pref: NotificationPreference, client?: PoolClient): Promise<void> {
  // Validate input
  if (!pref || typeof pref["id"] !== 'string') {
    throw new Error('preference must have a valid id');
  }
  try {
    const queryable = client || this.pool;
    // P1-FIX: Conflict target must be (user_id, channel) — the unique constraint
    // that governs business identity — not (id).  ON CONFLICT (id) never triggers
    // when a new UUID is generated for a new preference, so concurrent inserts for
    // the same (user, channel) pair would race and produce a unique-constraint
    // violation instead of the intended upsert.
    await queryable.query(
    `INSERT INTO notification_preferences (id, user_id, channel, enabled, frequency)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (user_id, channel)
    DO UPDATE SET id = EXCLUDED.id, enabled = EXCLUDED.enabled, frequency = EXCLUDED.frequency`,
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
  * @param client - Optional PoolClient for transaction participation
  */
  async delete(id: string, client?: PoolClient): Promise<void> {
  // Validate input
  if (!id || typeof id !== 'string') {
    throw new Error('id must be a non-empty string');
  }
  try {
    const queryable = client || this.pool;
    await queryable.query(
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
  * @param client - Optional PoolClient for transaction participation. When provided,
  *   the caller manages the transaction (no internal BEGIN/COMMIT).
  */
  async batchSave(prefs: NotificationPreference[], client?: PoolClient): Promise<void> {
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
    await this.batchSave(prefs.slice(i, i + CHUNK_SIZE), client);
    }
    return;
  }

  // P1-FIX: Use ON CONFLICT (user_id, channel) for the same reason as upsert().
  // Both the client-provided and self-managed paths must use the same target.
  const BATCH_SQL = `INSERT INTO notification_preferences (id, user_id, channel, enabled, frequency)
    SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[], $4::bool[], $5::text[])
    ON CONFLICT (user_id, channel) DO UPDATE SET
    id = EXCLUDED.id,
    enabled = EXCLUDED.enabled,
    frequency = EXCLUDED.frequency`;
  const BATCH_PARAMS = [
    prefs.map(p => p["id"]),
    prefs.map(p => p.userId),
    prefs.map(p => p.channel),
    prefs.map(p => p.isEnabled()),
    prefs.map(p => p.frequency)
  ];

  // When a client is provided, the caller manages the transaction
  if (client) {
    await client.query(BATCH_SQL, BATCH_PARAMS);
    return;
  }

  // No client provided — manage our own transaction
  const ownClient = await this.pool.connect();
  try {
    await ownClient.query('BEGIN');
    await ownClient.query(BATCH_SQL, BATCH_PARAMS);
    await ownClient.query('COMMIT');
  } catch (error) {
    // P1-FIX: Wrap ROLLBACK in its own try-catch so a failed ROLLBACK doesn't
    // replace the original error that the caller needs to see.
    try { await ownClient.query('ROLLBACK'); } catch { /* ignore secondary error */ }
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to batch save preferences', err, { count: prefs.length });
    throw error;
  } finally {
    ownClient.release();
  }
  }
}
