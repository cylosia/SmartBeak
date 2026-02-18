import { knex, Knex } from 'knex';
import { registerShutdownHandler, setupShutdownHandlers } from './utils/shutdown';
import { getLogger } from '@kernel/logger';
import { emitCounter } from '@kernel/metrics';

/**
 * Database Connection
 * Provides Knex.js database instance for apps/api
 *
 * LOW FIX L4: Replaced console.log with structured logger
 * LOW FIX L23: Use const instead of let where appropriate

 * MEDIUM FIX M4: Added connection metrics tracking
 * MEDIUM FIX M5: Added query timeout support
 */
// Note: In production, these imports should use the package name: @kernel/logger
const logger = getLogger('database');
// Validate database URL
const connectionString = process.env['CONTROL_PLANE_DB'];
if (!connectionString) {
  throw new Error('CONTROL_PLANE_DB environment variable is required. ' +
    'Please set it to your PostgreSQL connection string.');
}
// Check for placeholder values
if (/placeholder|example|user:password/i.test(connectionString)) {
  throw new Error('CONTROL_PLANE_DB contains placeholder values. ' +
    'Please set your actual database connection string.');
}
// P2-FIX #22: Convert to boolean. Previously evaluated to a string value (e.g. "1"),
// which is truthy but not boolean - would fail === true checks.
const isServerless = !!(process.env['VERCEL'] || process.env['AWS_LAMBDA_FUNCTION_NAME']);

// Security: Explicit SSL configuration for production environments.
// Defaults to rejecting unauthorized certificates (MITM protection).
// Set DB_SSL_REJECT_UNAUTHORIZED=false only for known self-signed cert scenarios.
const sslConfig = process.env['NODE_ENV'] === 'production'
  ? { ssl: { rejectUnauthorized: process.env['DB_SSL_REJECT_UNAUTHORIZED'] !== 'false' } }
  : {};

const config = {
  client: 'postgresql',
  connection: {
    connectionString,
    ...sslConfig,
    // P1-FIX #17: Terminate transactions idle for >60s. The managed pool in
    // packages/database/pool sets this, but this Knex pool didn't, allowing
    // abandoned transactions to hold locks indefinitely.
    idle_in_transaction_session_timeout: 60000,
    // P1-9 FIX: Add statement_timeout for ALL environments (was only set for serverless).
    // Without this, non-serverless standalone queries can run indefinitely, exhausting the pool.
    statement_timeout: isServerless ? 3000 : 30000,
  },
  pool: {
    min: isServerless ? 0 : 2,  // P0-FIX: Start with 0 for serverless
    max: isServerless ? 5 : 20,  // P0-FIX: Limit to 5 for serverless
    // P0-FIX: Reduced timeouts for serverless compatibility (Vercel 5s limit)
    acquireTimeoutMillis: isServerless ? 4000 : 30000,
    createTimeoutMillis: isServerless ? 4000 : 30000,
    destroyTimeoutMillis: 5000,
    idleTimeoutMillis: isServerless ? 10000 : 30000,
    reapIntervalMillis: 1000,
    createRetryIntervalMillis: 200,
  },
  // Note: statement_timeout is set in the connection config above (idle_in_transaction_session_timeout block).
  acquireConnectionTimeout: isServerless ? 5000 : 60000,
  migrations: {
    tableName: 'schema_migrations',
    directory: '../../migrations/sql',
  },
  // Debug logging in development
  debug: process.env['NODE_ENV'] === 'development' && process.env['DEBUG_DB'] === 'true',
};
// P0-FIX: Lazy initialization for Knex to prevent connection storms in serverless
let dbInstance: Knex | null = null;

const connectionMetrics = {
  totalQueries: 0,
  failedQueries: 0,
  slowQueries: 0,
};

export function getDb(): Knex {
  if (!dbInstance) {
    dbInstance = knex(config);
    
    // Handle pool errors to prevent crashes
    dbInstance.on('error', (error: Error) => {
      logger.error('Database pool error', error);
    });

    // Track query metrics using performance.now() for accurate sub-millisecond durations.
    // Keyed by Knex's __knexQueryUid to correctly pair query/response/error events.
    // BUG-DB-01 fix: merged two separate query-error listeners into one to prevent
    //   double-counting on any re-initialization path.
    // BUG-DB-02 fix: use performance.now() delta instead of Date.now() - obj.startTime;
    //   Knex sets obj.startTime via performance.now(), so subtracting Date.now()
    //   (a Unix epoch in ms) from a process-relative float always produced ~1.7e12ms,
    //   classifying every query as slow.
    const queryStartTimes = new Map<string, number>();
    dbInstance.on('query', (obj: { __knexQueryUid?: string }) => {
      connectionMetrics.totalQueries++;
      if (obj['__knexQueryUid']) {
        queryStartTimes.set(obj['__knexQueryUid'], performance.now());
      }
    });
    dbInstance.on('query-response', (_response: unknown, obj: { __knexQueryUid?: string }) => {
      const uid = obj['__knexQueryUid'];
      if (uid) {
        const start = queryStartTimes.get(uid);
        if (start !== undefined) {
          queryStartTimes.delete(uid);
          if (performance.now() - start > 1000) {
            connectionMetrics.slowQueries++;
          }
        }
      }
    });
    dbInstance.on('query-error', (error: Error, obj: { __knexQueryUid?: string }) => {
      logger.error('Query error', error);
      connectionMetrics.failedQueries++;
      if (obj['__knexQueryUid']) {
        queryStartTimes.delete(obj['__knexQueryUid']);
      }
    });
  }
  return dbInstance;
}

// P0-FIX: Export db as a Proxy for backward compatibility
// This ensures lazy initialization even when accessed directly
export const db = new Proxy({} as Knex, {
  get: (_target, prop) => {
    const instance = getDb();
    // P2-FIX #25: Bind function properties to preserve 'this' context.
    // Without binding, methods that use 'this' internally lose their context
    // when called through the proxy.
    const val = instance[prop as keyof Knex];
    return typeof val === 'function' ? (val as (...args: unknown[]) => unknown).bind(instance) : val;
  }
});
/**
 * Get connection metrics for monitoring
 * MEDIUM FIX M4: Expose connection metrics
 */


export type AnalyticsDbState =
  | { status: 'uninitialized' }
  | { status: 'initializing' }
  | { status: 'ready'; instance: Knex }
  | { status: 'error'; error: Error };

export type KnexType = Knex;

// P0-FIX: Return actual pool metrics instead of hardcoded zeros
export function getConnectionMetrics(): { 
  totalQueries: number; 
  failedQueries: number; 
  slowQueries: number; 
  totalConnections: number; 
  idleConnections: number; 
  waitingClients: number;
  poolUtilization: number;
} {
  // P0-FIX: Don't initialize new instance just to get metrics
  if (!dbInstance) {
    return {
      ...connectionMetrics,
      totalConnections: 0,
      idleConnections: 0,
      waitingClients: 0,
      poolUtilization: 0,
    };
  }

  // Get actual pool stats from Knex client
  const pool = dbInstance.client?.pool;
  const poolSize = pool?.size || 0;
  const available = pool?.available || 0;
  const waiting = pool?.waiting || 0;
  const maxSize = isServerless ? 5 : 20;
  
  return {
    ...connectionMetrics,
    totalConnections: poolSize,
    idleConnections: available,
    waitingClients: waiting,
    poolUtilization: maxSize > 0 ? (poolSize - available) / maxSize : 0,
  };
}
// ============================================================================
// ANALYTICS DATABASE - Fixed Race Conditions
// ============================================================================
/**
 * Analytics database state

 */
let analyticsDbInstance: Knex | null = null;
let analyticsDbPromise: Promise<Knex> | null = null;
let analyticsDbUrl: string | null = null;

let lastAnalyticsError: number | null = null;
let analyticsRetryCount = 0;
const MAX_RETRY_COUNT = 5;
/**
 * Check if we're in the retry debounce period (exponential backoff).
 * BUG-DB-06 fix: previously used fixed RETRY_DEBOUNCE_MS (5 s) constant.
 */
function isInRetryDebounce(): boolean {
  if (!lastAnalyticsError)
    return false;
  const elapsed = Date.now() - lastAnalyticsError;
  // Deterministic part of backoff (no jitter) used for comparison so the
  // window is stable across multiple isInRetryDebounce() calls in one request.
  const backoffMs = Math.min(30000, 1000 * Math.pow(2, analyticsRetryCount));
  return elapsed < backoffMs;
}
/**
 * Reset analytics DB state (for URL changes or manual reset)
 */
async function resetAnalyticsDb(): Promise<void> {
  if (analyticsDbInstance) {
    const oldInstance = analyticsDbInstance;
    analyticsDbInstance = null;
    analyticsDbUrl = null;
    try {
      await oldInstance.destroy();
    }
    catch (err) {
      logger.error('Error destroying old analytics connection', err instanceof Error ? err : new Error(String(err)));
    }
  }
  analyticsDbPromise = null;
  lastAnalyticsError = null;
  analyticsRetryCount = 0;
}
/**
 * Internal function to create analytics DB connection
 */
async function createAnalyticsDbConnection(replicaUrl: string): Promise<Knex> {
  const instance = knex({
    ...config,
    connection: {
      connectionString: replicaUrl,
      ...sslConfig,
    },
    pool: {
      ...config.pool,
      // F18-FIX: Use min:0 in serverless (matching main DB pattern).
      // Previously hardcoded min:1, eagerly creating connections on cold start.
      min: isServerless ? 0 : 1,
      max: isServerless ? 5 : 10,
    },
  });
  // Test connection before returning
  await instance.raw('SELECT 1');

  instance.on('error', (err: Error) => {
    logger.error('Analytics DB runtime error', err);
    // Update error state for backoff
    lastAnalyticsError = Date.now();
    analyticsRetryCount = Math.min(analyticsRetryCount + 1, MAX_RETRY_COUNT);
    // Destroy the instance to force reconnection on next call
    const inst = analyticsDbInstance;
    analyticsDbInstance = null;
    analyticsDbPromise = null;
    if (inst) {
      void inst.destroy().catch(() => {
        // Ignore destroy errors
      });
    }
  });
  return instance;
}
/**
 * Analytics database (read-only replica)

 *
 * IMPORTANT: This function is now async. Callers must await it.
 *
 * @returns Promise<Knex> - Analytics DB instance or primary DB if analytics unavailable
 */
export async function analyticsDb(): Promise<Knex> {
  const replicaUrl = process.env['ANALYTICS_DB_URL'];
  // Return primary if no replica configured
  if (!replicaUrl) {
    if (process.env['NODE_ENV'] !== 'production') {
      logger.debug('Analytics DB not configured, using primary database');
    }
    // Use getDb() to ensure lazy initialization pattern is respected
    return getDb();
  }

  if (replicaUrl !== analyticsDbUrl) {
    // P0-FIX: Capture the stale instance BEFORE nulling it.
    // resetAnalyticsDb() checks `if (analyticsDbInstance)` to destroy the old pool —
    // nulling it first causes the old Knex connection pool to leak on every URL change
    // (e.g. replica failover), eventually exhausting Postgres max_connections.
    const staleInstance = analyticsDbInstance;
    analyticsDbUrl = replicaUrl;
    analyticsDbInstance = null;
    analyticsDbPromise = null;
    lastAnalyticsError = null;
    analyticsRetryCount = 0;
    if (staleInstance) {
      await staleInstance.destroy().catch((err: unknown) => {
        logger.error('Failed to destroy stale analytics DB instance', err instanceof Error ? err : new Error(String(err)));
      });
    }
  }
  // Return existing instance if available
  if (analyticsDbInstance) {
    return analyticsDbInstance;
  }

  // P1-FIX: Track analytics DB initialization metrics
  const initStartTime = Date.now();

  if (isInRetryDebounce()) {
    const backoffMs = Math.min(30000, 1000 * Math.pow(2, analyticsRetryCount));
    const remainingMs = backoffMs - (Date.now() - (lastAnalyticsError || 0));
    logger.warn(`Analytics DB in retry debounce (${Math.ceil(Math.max(0, remainingMs) / 1000)}s remaining), using primary`);
    return getDb();
  }

  if (!analyticsDbPromise) {
    analyticsDbPromise = (async () => {
      try {
        logger.info('Initializing analytics DB connection...');
        const instance = await createAnalyticsDbConnection(replicaUrl);
        // Success - reset error state
        analyticsDbInstance = instance;
        lastAnalyticsError = null;
        analyticsRetryCount = 0;
        logger.info('Analytics DB connection initialized successfully');
        return instance;
      }
      catch (error) {
        // P1-FIX: Log error with context and emit metrics
        const err = error instanceof Error ? error : new Error(String(error));
        const durationMs = Date.now() - initStartTime;
        
        logger.error('Failed to initialize analytics DB', err, {
          durationMs,
          retryCount: analyticsRetryCount
        });
        
        // P1-FIX: Emit error metrics for monitoring
        emitCounter('analytics_db_init_failed', 1, { 
          error_type: err.name,
          retry_count: String(analyticsRetryCount)
        });
        emitCounter('analytics_db_init_duration_ms', durationMs);

        lastAnalyticsError = Date.now();
        analyticsRetryCount = Math.min(analyticsRetryCount + 1, MAX_RETRY_COUNT);
        // Clear promise so next call can retry (after debounce)
        analyticsDbPromise = null;
        // Return primary as fallback
        return getDb();
      }
    })();
  }
  return analyticsDbPromise;
}


/**
 * Synchronous version - returns primary DB (for backward compatibility)
 * @deprecated Use analyticsDb() async version instead
 */
export function getAnalyticsDbSync(): Knex {

  if (analyticsDbInstance) {
    return analyticsDbInstance;
  }
  const replicaUrl = process.env['ANALYTICS_DB_URL'];
  if (replicaUrl && !analyticsDbPromise) {
    // Trigger async initialization (but can't wait for it)
    // P1-FIX: Log errors instead of swallowing them
    analyticsDb().catch((error) => { 
      const err = error instanceof Error ? error : new Error(String(error));
      logger.warn('Analytics DB async initialization failed (using fallback)', { 
        error: err.message,
        fallback: 'primary_db'
      });
      emitCounter('analytics_db_async_init_failed', 1);
    });
  }
  return getDb();
}
/**
 * Check if analytics DB is available and healthy
 */
export async function isAnalyticsDbHealthy(): Promise<boolean> {
  const replicaUrl = process.env['ANALYTICS_DB_URL'];
  if (!replicaUrl)
    return false;
  try {
    const client = await analyticsDb();
    // If we got the primary back, analytics is not healthy
    if (client === getDb())
      return false;
    // Quick health check
    await client.raw('SELECT 1');
    return true;
  }
  catch {
    return false;
  }
}
/**
 * Test database connection
 * MEDIUM FIX M4: Enhanced health check with metrics
 */
export async function testConnection(): Promise<boolean> {
  try {
    // P0-FIX: Use getDb() to ensure lazy initialization
    const instance = getDb();
    await instance.raw('SELECT 1');
    logger.info('Database connection successful');
    return true;
  }
  catch (error) {
    logger.error('Database connection failed', error instanceof Error ? error : new Error(String(error)));
    return false;
  }
}

export interface HealthCheckResult {
  healthy: boolean;
  latency: number;
  error?: string;
  metrics?: ReturnType<typeof getConnectionMetrics>;
}

/**
 * Enhanced health check with metrics
 * MEDIUM FIX M4: Expose connection metrics
 */
export async function checkHealth(): Promise<HealthCheckResult> {
  const start = Date.now();
  try {
    // P0-FIX: Use getDb() to ensure lazy initialization
    const instance = getDb();
    await instance.raw('SELECT 1');
    return {
      healthy: true,
      latency: Date.now() - start,
      metrics: getConnectionMetrics(),
    };
  }
  catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      healthy: false,
      latency: Date.now() - start,
      error: errorMessage,
      metrics: getConnectionMetrics(),
    };
  }
}
/**
 * Graceful shutdown

 */
export async function closeConnection(): Promise<void> {
  logger.info('Closing database connection...');
  const promises: Promise<void>[] = [];
  // BUG-DB-07 fix: clear the timeout after the race settles to prevent a 30-second
  // timer from firing after clean shutdown and emitting a spurious UnhandledPromiseRejection.
  // Promise.race() does not cancel the losing promise; the timer must be cleared explicitly.
  const withShutdownTimeout = (promise: Promise<void>, ms: number): Promise<void> => {
    let id: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<void>((_, reject) => {
      id = setTimeout(() => reject(new Error(`Shutdown timeout after ${ms}ms`)), ms);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => {
      if (id !== undefined) clearTimeout(id);
    });
  };
  // P0-FIX: Use getDb() to ensure lazy initialization and check if initialized
  const instance = dbInstance;
  // FIX: Null out dbInstance before destroying so any concurrent getDb() call
  // after shutdown creates a fresh pool rather than returning the destroyed one.
  dbInstance = null;
  if (instance) {
    promises.push(withShutdownTimeout(
      instance.destroy(),
      30000
    ).catch(err => {
      logger.error('Error closing primary DB connection', err instanceof Error ? err : new Error(String(err)));
    }));
  }
  if (analyticsDbInstance) {
    const instance = analyticsDbInstance;
    analyticsDbInstance = null;
    promises.push(withShutdownTimeout(
      instance.destroy(),
      30000
    ).catch(err => {
      logger.error('Error closing analytics DB connection', err instanceof Error ? err : new Error(String(err)));
    }));
  }
  await Promise.all(promises);
  logger.info('Database connection closed');
}
// Register shutdown handler for database cleanup
setupShutdownHandlers();
registerShutdownHandler(async () => {
  await closeConnection();
});
