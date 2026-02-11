import { Pool } from 'pg';

﻿

/**
* Result of idempotency check
*/
export interface IdempotencyResult {
  isNew: boolean;
  storedAt?: Date;
}

// Advisory lock key space for webhook idempotency
const WEBHOOK_LOCK_KEY_BASE = 1000000;

/**
* Generate advisory lock key for webhook event
*/
function getWebhookLockKey(provider: string, eventId: string): number {
  // Simple hash combining provider and eventId
  const str = `${provider}:${eventId}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
  const char = str.charCodeAt(i);
  hash = ((hash << 5) - hash) + char;
  hash = hash & hash; // Convert to 32bit integer
  }
  return WEBHOOK_LOCK_KEY_BASE + Math.abs(hash);
}

/**
*
* Uses pg_advisory_lock to ensure only one process can check/insert
* a webhook event at a time, preventing race conditions.
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
  const lockKey = getWebhookLockKey(provider, eventId);

  try {
  await client.query('BEGIN');
  await client.query('SET LOCAL statement_timeout = $1', [10000]); // 10 seconds for quick lookups

  // P0-FIX: Use non-blocking lock with timeout
  const startTime = Date.now();
  const timeoutMs = 10000; // 10 second timeout
  let lockAcquired = false;
  
  while (Date.now() - startTime < timeoutMs) {
    const lockResult = await client.query(
      'SELECT pg_try_advisory_lock($1) as acquired',
      [lockKey]
    );
    if (lockResult.rows[0].acquired) {
      lockAcquired = true;
      break;
    }
    // Wait 100ms before retry
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  if (!lockAcquired) {
    return { isNew: false }; // Timeout - couldn't acquire lock
  }

  try {
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
    storedAt: existingRows[0]?.received_at
    };
  } finally {
    // Always release the advisory lock
    await client.query('SELECT pg_advisory_unlock($1)', [lockKey]);
  }
  } catch (error) {
    // CRITICAL FIX: Log rollback failures instead of silently ignoring
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      const rollbackErr = rollbackError instanceof Error 
        ? rollbackError 
        : new Error(String(rollbackError));
      
      console.error('[webhook-idempotency] Rollback failed:', rollbackErr);
      
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
  client?: Pool extends { connect(): infer C } ? C : never
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
    (dbClient as { release(): void }).release();
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
  client?: Pool extends { connect(): infer C } ? C : never
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
    (dbClient as { release(): void }).release();
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
* @deprecated Use ensureIdempotent with Pool instead
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
