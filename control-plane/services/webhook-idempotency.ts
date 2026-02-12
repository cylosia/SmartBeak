import { Pool, PoolClient } from 'pg';
import { getLogger } from '../../packages/kernel/logger';

const logger = getLogger('webhook-idempotency');

/**
* Result of idempotency check
*/
export interface IdempotencyResult {
  isNew: boolean;
  storedAt?: Date;
  /** P1-3 FIX: Reason for non-new result to distinguish duplicates from contention */
  reason?: 'duplicate' | 'lock_contention';
}

/**
*
* P1-1 FIX: Uses pg_advisory_xact_lock (transaction-level) instead of session-level locks.
* Transaction-level locks auto-release on COMMIT/ROLLBACK, preventing lock leaks.
*
* P1-2 FIX: Replaced busy-wait spin loop with single pg_try_advisory_xact_lock attempt.
* No longer holds a connection for up to 10 seconds doing nothing.
*
* P1-3 FIX: Lock contention now returns a distinct reason so callers can retry.
*
* P1-7 FIX: Uses PostgreSQL hashtext() for better hash distribution, plus two-key
* advisory lock to reduce collision probability.
*
* @param pool - Database pool
* @param provider - Webhook provider name
* @param eventId - Provider's event ID
* @returns Object indicating if this is a new event
*/
export async function ensureIdempotent(
  pool: Pool,
  provider: string,
  eventId: string
): Promise<IdempotencyResult> {
  if (!provider || typeof provider !== 'string') {
    throw new Error('Valid provider is required');
  }
  if (!eventId || typeof eventId !== 'string') {
    throw new Error('Valid eventId is required');
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL statement_timeout = $1', ['10s']);

    // P1-1 FIX: Use transaction-level advisory lock (auto-releases on COMMIT/ROLLBACK)
    // P1-7 FIX: Use PostgreSQL hashtext() for better distribution + two-key lock
    // P1-2 FIX: Single non-blocking attempt instead of busy-wait spin loop
    const lockResult = await client.query(
      'SELECT pg_try_advisory_xact_lock(hashtext($1), hashtext($2)) as acquired',
      [provider, eventId]
    );

    if (!lockResult.rows[0].acquired) {
      // P1-3 FIX: Return distinct reason for lock contention (not a duplicate)
      await client.query('ROLLBACK');
      return { isNew: false, reason: 'lock_contention' };
    }

    // Use INSERT ... ON CONFLICT for atomic check-and-insert
    const { rows } = await client.query(
      `INSERT INTO webhook_events (provider, event_id, received_at, processed)
      VALUES ($1, $2, NOW(), false)
      ON CONFLICT (provider, event_id) DO NOTHING
      RETURNING received_at`,
      [provider, eventId]
    );

    if (rows.length > 0) {
      // New event - commit and return
      await client.query('COMMIT');
      return { isNew: true, storedAt: rows[0].received_at };
    }

    // Event already exists - fetch its details using client (not pool)
    const { rows: existingRows } = await client.query(
      `SELECT received_at, processed FROM webhook_events
      WHERE provider = $1 AND event_id = $2`,
      [provider, eventId]
    );

    await client.query('COMMIT');

    return {
      isNew: false,
      reason: 'duplicate',
      storedAt: existingRows[0]?.received_at
    };
  } catch (error) {
    // P2-16 FIX: Use structured logger instead of console.error
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      const rollbackErr = rollbackError instanceof Error
        ? rollbackError
        : new Error(String(rollbackError));

      logger.error('Rollback failed during idempotency check', rollbackErr);

      // Chain errors for debugging
      const originalErr = error instanceof Error ? error : new Error(String(error));
      throw new Error(
        `Webhook idempotency check failed: ${originalErr.message}. ` +
        `Additionally, rollback failed: ${rollbackErr.message}`
      );
    }
    throw error;
  } finally {
    client.release();
  }
}

/**
* Mark a webhook event as processed
*/
export async function markProcessed(
  pool: Pool,
  provider: string,
  eventId: string,
  // P2-17 FIX: Use PoolClient type directly instead of complex conditional type
  client?: PoolClient
): Promise<void> {
  const dbClient = client || await pool.connect();
  const shouldRelease = !client;

  try {
    await dbClient.query(
      `UPDATE webhook_events
      SET processed = true, processed_at = NOW()
      WHERE provider = $1 AND event_id = $2`,
      [provider, eventId]
    );
  } finally {
    if (shouldRelease) {
      (dbClient as PoolClient).release();
    }
  }
}

/**
* Check if a webhook event exists without inserting
*/
export async function checkIdempotency(
  pool: Pool,
  provider: string,
  eventId: string,
  // P2-17 FIX: Use PoolClient type directly instead of complex conditional type
  client?: PoolClient
): Promise<boolean> {
  const dbClient = client || await pool.connect();
  const shouldRelease = !client;

  try {
    const { rows } = await dbClient.query(
      `SELECT 1 FROM webhook_events
      WHERE provider = $1 AND event_id = $2`,
      [provider, eventId]
    );
    return rows.length > 0;
  } finally {
    if (shouldRelease) {
      (dbClient as PoolClient).release();
    }
  }
}

// Generic database interface for legacy compatibility
export interface LegacyDb {
  webhook_events: {
    findOne(query: { provider: string; event_id: string }): Promise<unknown>;
    insert(doc: { provider: string; event_id: string }): Promise<void>;
  };
}

/**
* Legacy function for backward compatibility
* @deprecated Use ensureIdempotent with Pool instead.
* WARNING: This function has a TOCTOU race condition (findOne + insert is not atomic).
* Two concurrent calls can both see findOne return null, both insert, causing duplicate processing.
*/
export async function ensureIdempotentLegacy(
  db: LegacyDb,
  provider: string,
  eventId: string
): Promise<boolean> {
  const exists = await db.webhook_events.findOne({ provider, event_id: eventId });
  if (exists) return false;
  await db.webhook_events.insert({ provider, event_id: eventId });
  return true;
}
