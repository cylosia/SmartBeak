// P1-FIX: Removed BOM character
import { Pool, PoolClient } from 'pg';
import { getLogger } from '@kernel/logger';
import { Semaphore, PoolExhaustionError } from '@kernel/semaphore';

const logger = getLogger('database:pool');

// P1-FIX: Valid sort columns whitelist to prevent injection
const VALID_SORT_COLUMNS = [
  'id', 'created_at', 'updated_at', 'status', 'domain_id', 'title',
  'published_at', 'archived_at', 'name', 'email', 'priority', 'order'
] as const;

export type ValidSortColumn = typeof VALID_SORT_COLUMNS[number];

/**
 * Validate sort column against whitelist
 * P1-FIX: Prevents SQL injection via sort parameter
 */
export function validateSortColumn(column: string): ValidSortColumn {
  if (!VALID_SORT_COLUMNS.includes(column as ValidSortColumn)) {
    throw new Error(`Invalid sort column: ${column}. Must be one of: ${VALID_SORT_COLUMNS.join(', ')}`);
  }
  return column as ValidSortColumn;
}

// P0-FIX #4: Track advisory locks WITH their client connections.
// Advisory locks are session-scoped in PostgreSQL - they can only be released
// on the same connection that acquired them. Previously, releaseAllAdvisoryLocks()
// acquired a NEW connection and tried to release locks, which silently failed.
const activeAdvisoryLocks = new Map<string, PoolClient>();

/**
 * Acquire advisory lock with tracking
 * P0-FIX: Returns PoolClient so caller holds the connection (required for session-based locks)
 * IMPORTANT: Caller MUST call releaseAdvisoryLock() to release both lock and connection
 */
export async function acquireAdvisoryLock(lockId: string, timeoutMs = 5000): Promise<PoolClient> {
  const pool = await getPool();
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const client = await pool.connect();
    try {
      // SECURITY FIX (Finding 20): Use hashtext() to convert string to bigint
      // pg_try_advisory_lock requires bigint, not string
      const { rows } = await client.query(
        'SELECT pg_try_advisory_lock(hashtext($1)) as acquired',
        [lockId]
      );

      if (rows[0]?.acquired) {
        activeAdvisoryLocks.set(lockId, client);
        return client; // Return client, DON'T release - caller must hold connection
      }
      // Only release if we didn't get the lock
      client.release();
    } catch (error) {
      client.release();
      throw error;
    }

    // Wait 50ms before retry
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  throw new Error(`Failed to acquire advisory lock ${lockId} within ${timeoutMs}ms`);
}

/**
 * Release advisory lock
 * P1-FIX: Accepts the client returned by acquireAdvisoryLock and releases it
 */
export async function releaseAdvisoryLock(client: PoolClient, lockId: string): Promise<void> {
  try {
    // SECURITY FIX (Finding 20): Must match hashtext() used in acquire
    await client.query('SELECT pg_advisory_unlock(hashtext($1))', [lockId]);
    activeAdvisoryLocks.delete(lockId);
  } finally {
    activeAdvisoryLocks.delete(lockId);
    client.release(); // Now safe to release
  }
}

/**
 * Release all tracked advisory locks
 * P1-FIX: Cleanup function for shutdown
 */
// P0-FIX #4: Release locks on their ORIGINAL connections (session-scoped locks).
export async function releaseAllAdvisoryLocks(): Promise<void> {
  if (activeAdvisoryLocks.size === 0) return;

  for (const [lockId, originalClient] of activeAdvisoryLocks) {
    try {
      // Must use hashtext() to match the lock acquired in acquireAdvisoryLock
      await originalClient.query('SELECT pg_advisory_unlock(hashtext($1))', [lockId]);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error(`Failed to release advisory lock ${lockId}`, err);
    } finally {
      try {
        originalClient.release();
      } catch {
        // Client may already be released
      }
    }
  }
  activeAdvisoryLocks.clear();
}

// P1-FIX: Pool initialization tracking for validation
let poolValidated = false;

let poolInstance: Pool | null = null;
let poolInitializing = false;
let poolInitPromise: Promise<Pool> | null = null;

/**
 * Get the database connection string from environment
 * Lazy validation - only called when connection is needed
 */
function getConnectionString(): string {
  const connectionString = process.env['CONTROL_PLANE_DB'];

  if (!connectionString) {
    throw new Error(
      'DATABASE_NOT_CONFIGURED: CONTROL_PLANE_DB environment variable is required. ' +
      'Please set it to your PostgreSQL connection string.'
    );
  }

  return connectionString;
}

/**
 * Lazy initialization of the PostgreSQL connection pool
 * Pattern: Promise-based coordination to prevent race conditions
 * P1-FIX: Added connection validation on pool creation
 */
async function getPool(): Promise<Pool> {
  if (poolInstance) return poolInstance;
  if (poolInitializing && poolInitPromise) return poolInitPromise;

  poolInitializing = true;
  poolInitPromise = (async () => {
    const connectionString = getConnectionString();

    poolInstance = new Pool({
      // P0-FIX: connectionString was validated but never passed to Pool.
      // Without it, pg falls back to PGHOST/PGPORT/etc env vars or localhost:5432,
      // silently ignoring CONTROL_PLANE_DB.
      connectionString,
      // P1-FIX: PostgreSQL timeouts to prevent runaway queries
      statement_timeout: 30000,  // 30 seconds max query time
      idle_in_transaction_session_timeout: 60000,  // 60 seconds max idle in transaction
      // P1-FIX: Connection pool sizing - reduced max to prevent overload
      max: 10, // Reduced from 20 to prevent connection pool exhaustion
      min: 2,
      idleTimeoutMillis: 30000, // Close idle connections after 30 seconds
      connectionTimeoutMillis: 5000, // Fail fast if can't connect within 5 seconds
      // P1-FIX: Connection lifecycle management to prevent churn
      keepAlive: true,
    });

    // P1-FIX: Validate pool by testing a connection
    if (!poolValidated) {
      try {
        const client = await poolInstance.connect();
        await client.query('SELECT 1');
        client.release();
        poolValidated = true;
        logger.info('Database pool validated successfully');
      } catch (error) {
        poolInstance = null;
        poolInitializing = false;
        poolInitPromise = null;
        const err = error instanceof Error ? error : new Error(String(error));
        throw new Error(`Failed to validate database connection: ${err.message}`);
      }
    }

    // Handle pool errors to prevent crashes
    poolInstance.on('error', (err) => {
      logger.error('Unexpected pool error', err);
      // Don't exit - let the application handle reconnection
    });

    // Track pool metrics
    setupPoolMetrics(poolInstance);

    return poolInstance;
  })();

  return poolInitPromise;
}

// P0-FIX: Connection metrics tracking with pool exhaustion alerts
const connectionMetrics = {
  totalQueries: 0,
  failedQueries: 0,
  slowQueries: 0,
  activeConnections: 0,
  waitingClients: 0,
  poolExhaustionEvents: 0,
  lastExhaustionTime: null as number | null,
};

// P0-FIX: Pool exhaustion monitoring
const POOL_EXHAUSTION_THRESHOLD = 0.8; // Alert when 80% of pool is used
const POOL_EXHAUSTION_COOLDOWN_MS = 60000; // 1 minute between alerts

/**
 * Check if pool is approaching exhaustion and log alert
 */
function checkPoolExhaustion(pool: Pool): void {
  const totalConnections = pool.totalCount;
  const activeConnections = pool.totalCount - pool.idleCount;
  const utilization = totalConnections > 0 ? activeConnections / totalConnections : 0;
  const waitingClients = pool.waitingCount;
  
  // Update metrics
  connectionMetrics.activeConnections = activeConnections;
  connectionMetrics.waitingClients = waitingClients;
  
  // Check for pool exhaustion
  const now = Date.now();
  const lastAlert = connectionMetrics.lastExhaustionTime;
  const cooldownElapsed = !lastAlert || (now - lastAlert) > POOL_EXHAUSTION_COOLDOWN_MS;
  
  if ((utilization >= POOL_EXHAUSTION_THRESHOLD || waitingClients > 5) && cooldownElapsed) {
    connectionMetrics.poolExhaustionEvents++;
    connectionMetrics.lastExhaustionTime = now;
    
    logger.error('DATABASE POOL EXHAUSTION ALERT', new Error(`utilization: ${(utilization * 100).toFixed(1)}%, activeConnections: ${activeConnections}, totalConnections: ${totalConnections}, waitingClients: ${waitingClients}, maxPoolSize: ${pool.options.max}, message: Connection pool approaching exhaustion. Consider increasing pool size or optimizing queries.`));
  }
}

/**
 * Setup pool metrics tracking with exhaustion monitoring
 */
function setupPoolMetrics(pool: Pool): void {
  pool.on('connect', () => {
    connectionMetrics.activeConnections++;
  });

  pool.on('remove', () => {
    connectionMetrics.activeConnections--;
  });

  pool.on('acquire', () => {
    connectionMetrics.waitingClients = pool.waitingCount;
    // P0-FIX: Check for pool exhaustion on every acquire
    checkPoolExhaustion(pool);
  });
  
  // P0-FIX: Monitor for errors that indicate pool exhaustion
  pool.on('error', (err) => {
    const errorMessage = err.message.toLowerCase();
    if (errorMessage.includes('timeout') || errorMessage.includes('exhausted')) {
      connectionMetrics.poolExhaustionEvents++;
      connectionMetrics.lastExhaustionTime = Date.now();
      logger.error('Pool error - possible exhaustion', err);
    }
  });
}

/**
 * P1-FIX: Validate query result count matches expectation
 * Throws error if count doesn't match (helps catch partial failures)
 */
export function validateResultCount(actual: number, expected: number, operation: string): void {
  if (actual !== expected) {
    throw new Error(
      `Result count mismatch for ${operation}: expected ${expected}, got ${actual}`
    );
  }
}

/**
 * P1-FIX: Verify row count for operations that expect specific changes
 * Returns true if verification passes, false otherwise
 */
export function verifyRowCount(
  rowCount: number,
  expectedMin: number,
  expectedMax: number,
  operation: string
): boolean {
  if (rowCount < expectedMin || rowCount > expectedMax) {
    logger.warn(`Row count verification failed for ${operation}: expected ${expectedMin}-${expectedMax}, got ${rowCount}`);
    return false;
  }
  return true;
}

/**
 * Get connection metrics for monitoring
 */
export function getConnectionMetrics(): typeof connectionMetrics & {
  totalConnections: number;
  idleConnections: number;
  waitingClients: number;
} {
  if (!poolInstance) {
    return {
      ...connectionMetrics,
      totalConnections: 0,
      idleConnections: 0,
      waitingClients: 0,
    };
  }

  return {
    ...connectionMetrics,
    totalConnections: poolInstance.totalCount,
    idleConnections: poolInstance.idleCount,
    waitingClients: poolInstance.waitingCount,
  };
}

/**
 * Get the PostgreSQL pool (lazy initialized)
 */
export async function getPoolInstance(): Promise<Pool> {
  return getPool();
}

/**
 * Export a proxy that throws if accessed before initialization
 */
export const pool = new Proxy({} as Pool, {
  get(_, prop: string | symbol) {
    if (!poolInstance) {
      throw new Error('Pool not initialized. Use getPoolInstance() async function instead.');
    }
    const value = poolInstance[prop as keyof Pool];
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(poolInstance) : value;
  }
});

// ============================================================================
// Backpressure Gate
// ============================================================================

// Gate: allow max 8 concurrent connections (of 10 pool max) to leave headroom
const POOL_GATE_MAX = 8;
const POOL_GATE_MAX_WAITERS = 10;
const poolGate = new Semaphore(POOL_GATE_MAX);

/**
 * Acquire a database connection with backpressure protection.
 * Rejects early when the pool is near capacity, preventing
 * requests from queuing indefinitely on pool.connect().
 *
 * @param timeoutMs - Max time to wait for a permit (default: 3000ms)
 * @returns PoolClient with release() wrapped to also release the semaphore
 * @throws PoolExhaustionError if backpressure is active
 */
export async function acquireConnection(timeoutMs = 3000): Promise<PoolClient> {
  const pool = await getPool();

  // Reject immediately if too many waiters are queued
  if (poolGate.waiting > POOL_GATE_MAX_WAITERS) {
    throw new PoolExhaustionError(
      `Database pool backpressure: ${poolGate.waiting} requests waiting. Try again later.`
    );
  }

  // Try to acquire a permit
  const acquired = poolGate.tryAcquire();
  if (!acquired) {
    try {
      await poolGate.acquire(timeoutMs);
    } catch {
      throw new PoolExhaustionError(
        'Database pool backpressure: could not acquire connection permit within timeout'
      );
    }
  }

  try {
    const client = await pool.connect();
    // Wrap release to also release the semaphore permit
    const originalRelease = client.release.bind(client);
    client.release = (err?: boolean | Error) => {
      poolGate.release();
      return originalRelease(err);
    };
    return client;
  } catch (error) {
    poolGate.release();
    throw error;
  }
}

/**
 * Get backpressure metrics for monitoring
 */
export function getBackpressureMetrics(): {
  available: number;
  waiting: number;
  max: number;
} {
  return {
    available: poolGate.available,
    waiting: poolGate.waiting,
    max: poolGate.max,
  };
}

export { PoolExhaustionError };

// Export internal getPool for other modules
export { getPool };
