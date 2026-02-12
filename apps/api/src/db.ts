import { knex, Knex } from 'knex';
import { registerShutdownHandler, setupShutdownHandlers } from './utils/shutdown';
import { createDatabaseHealthCheck } from '@kernel/health-check';
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

const config = {
  client: 'postgresql',
  connection: {
    connectionString,
    // P1-FIX #17: Terminate transactions idle for >60s. The managed pool in
    // packages/database/pool sets this, but this Knex pool didn't, allowing
    // abandoned transactions to hold locks indefinitely.
    idle_in_transaction_session_timeout: 60000,
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
  // P0-FIX: Statement timeout for serverless (must be < 5s)
  ...(isServerless && {
    statement_timeout: 3000,  // 3s max query time in serverless
  }),
  acquireConnectionTimeout: isServerless ? 5000 : 60000,
  migrations: {
    tableName: 'knex_migrations',
    directory: './migrations',
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
    // LOW FIX L4: Use structured logger
    dbInstance.on('query-error', (error: Error) => {
      logger.error('Query error', error);
    });

    dbInstance.on('error', (error: Error) => {
      logger.error('Database pool error', error);
    });

    // Track query metrics
    dbInstance.on('query', () => {
      connectionMetrics.totalQueries++;
    });
    dbInstance.on('query-response', (_response: unknown, obj: { startTime?: number }) => {
      if (obj.startTime) {
        const duration = Date.now() - obj.startTime;
        if (duration > 1000) {
          connectionMetrics.slowQueries++;
        }
      }
    });
    dbInstance.on('query-error', () => {
      connectionMetrics.failedQueries++;
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
    return typeof val === 'function' ? (val as Function).bind(instance) : val;
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
const RETRY_DEBOUNCE_MS = 5000; // Wait 5 seconds before allowing retry
const MAX_RETRY_COUNT = 5;
/**
 * Calculate backoff delay with exponential backoff + jitter
 */
function getRetryBackoff(): number {
  const baseDelay = Math.min(30000, 1000 * Math.pow(2, analyticsRetryCount));
  const jitter = Math.random() * 1000;
  return baseDelay + jitter;
}
/**
 * Check if we're in the retry debounce period
 */
function isInRetryDebounce(): boolean {
  if (!lastAnalyticsError)
    return false;
  const elapsed = Date.now() - lastAnalyticsError;
  return elapsed < RETRY_DEBOUNCE_MS;
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
      logger.error('Error destroying old analytics connection', err as Error);
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
    connection: replicaUrl,
    pool: {
      ...config.pool,
      // Smaller pool for read-only replica
      min: 1,
      max: 10,
    },
  });
  // Test connection before returning
  await instance.raw('SELECT 1');

  instance.on('error', async (err: Error) => {
    logger.error('Analytics DB runtime error', err);
    // Update error state for backoff
    lastAnalyticsError = Date.now();
    analyticsRetryCount = Math.min(analyticsRetryCount + 1, MAX_RETRY_COUNT);
    // Destroy the instance to force reconnection on next call
    const inst = analyticsDbInstance;
    analyticsDbInstance = null;
    analyticsDbPromise = null;
    if (inst) {
      try {
        await inst.destroy();
      }
      catch {
        // Ignore destroy errors
      }
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
    // P1-FIX #13: Set analyticsDbUrl synchronously BEFORE the async reset to prevent
    // concurrent calls from both entering this block and creating duplicate connections.
    analyticsDbUrl = replicaUrl;
    await resetAnalyticsDb();
  }
  // Return existing instance if available
  if (analyticsDbInstance) {
    return analyticsDbInstance;
  }

  // P1-FIX: Track analytics DB initialization metrics
  const initStartTime = Date.now();

  if (isInRetryDebounce()) {
    const remainingMs = RETRY_DEBOUNCE_MS - (Date.now() - (lastAnalyticsError || 0));
    logger.warn(`Analytics DB in retry debounce (${Math.ceil(remainingMs / 1000)}s remaining), using primary`);
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
        
        logger.error('Failed to initialize analytics DB', { 
          error: err.message, 
          stack: err.stack,
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
    logger.error('Database connection failed', error as Error);
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
  // Add timeout to prevent hanging
  const timeout = (ms: number): Promise<never> => new Promise((_, reject) => setTimeout(() => reject(new Error(`Shutdown timeout after ${ms}ms`)), ms));
  // P0-FIX: Use getDb() to ensure lazy initialization and check if initialized
  const instance = dbInstance;
  if (instance) {
    promises.push(Promise.race([
      instance.destroy(),
      timeout(30000)
    ]).catch(err => {
      logger.error('Error closing primary DB connection', err as Error);
    }));
  }
  if (analyticsDbInstance) {
    const instance = analyticsDbInstance;
    analyticsDbInstance = null;
    promises.push(Promise.race([
      instance.destroy(),
      timeout(30000)
    ]).catch(err => {
      logger.error('Error closing analytics DB connection', err as Error);
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
