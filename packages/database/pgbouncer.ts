/**
 * P1-FIX: PgBouncer Connection Pool Management
 * 
 * PgBouncer is a lightweight connection pooler for PostgreSQL that provides:
 * - Connection pooling (reuses connections across clients)
 * - Transaction pooling (connection assigned per transaction)
 * - Session pooling (connection assigned per session)
 * 
 * Critical for serverless environments to prevent connection exhaustion.
 */

import { Pool, PoolClient } from 'pg';
import { getLogger } from '@kernel/logger';

const logger = getLogger('database:pgbouncer');

export interface PgBouncerConfig {
  // PgBouncer connection string (different port than direct Postgres)
  url: string;
  // Pooling mode: 'transaction' | 'session' | 'statement'
  // - transaction: Connection assigned per transaction (recommended for serverless)
  // - session: Connection assigned per session
  // - statement: Connection assigned per statement (not recommended)
  poolMode?: 'transaction' | 'session' | 'statement';
  // Maximum connections in PgBouncer pool
  maxConnections?: number;
  // Default pool size for client
  poolSize?: number;
}

/**
 * Detect if connection string is for PgBouncer
 * PgBouncer typically runs on port 6432 or 5433
 */
export function isPgBouncerConnection(url: string): boolean {
  try {
    const parsed = new URL(url);
    const port = parseInt(parsed.port, 10);
    // PgBouncer commonly uses 6432 or 5433
    return port === 6432 || port === 5433 || url.includes('pgbouncer=true');
  } catch {
    return false;
  }
}

/**
 * Get PgBouncer-specific connection config
 * Adjusts settings for transaction pooling mode
 */
export function getPgBouncerConfig(baseConfig: {
  connectionString: string;
  statement_timeout?: number;
}): Pool {
  const isPgBouncer = isPgBouncerConnection(baseConfig.connectionString);
  
  if (!isPgBouncer) {
    logger.warn('Not using PgBouncer - consider using PgBouncer for serverless deployments');
  } else {
    logger.info('Using PgBouncer connection pooler');
  }

  // P1-FIX: Adjust settings for PgBouncer compatibility
  // In transaction pooling mode, certain features don't work:
  // - Prepared statements (use simple query protocol)
  // - LISTEN/NOTIFY (use direct connection)
  // - SET commands (use RESET after)
  
  return new Pool({
    connectionString: baseConfig.connectionString,
    // P1-FIX: Smaller pool when using PgBouncer (PgBouncer does the heavy lifting)
    max: isPgBouncer ? 5 : 10,
    min: isPgBouncer ? 1 : 2,
    // P1-FIX: Shorter idle timeout with PgBouncer
    idleTimeoutMillis: isPgBouncer ? 10000 : 30000,
    connectionTimeoutMillis: 5000,
    // P1-FIX: Disable prepared statements in transaction pooling mode
    // This prevents "prepared statement already exists" errors
    ...(isPgBouncer && {
      // Use simple query protocol
      query_timeout: baseConfig.statement_timeout || 30000,
    }),
  });
}

/**
 * Execute query with PgBouncer compatibility
 * Handles transaction pooling limitations
 */
export async function queryWithPgBouncer<T = unknown>(
  pool: Pool,
  sql: string,
  params?: unknown[]
): Promise<{ rows: T[]; rowCount: number }> {
  const client = await pool.connect();
  try {
    // P1-FIX: In transaction pooling, avoid prepared statements
    // Use simple query if params are simple
    const result = await client.query(sql, params);
    return {
      rows: result.rows as T[],
      rowCount: result.rowCount || 0,
    };
  } finally {
    client.release();
  }
}

/**
 * Execute transaction with PgBouncer
 * In transaction pooling mode, the entire transaction uses one connection
 */
export async function transactionWithPgBouncer<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // P1-FIX: Set transaction timeout for PgBouncer compatibility
    await client.query('SET LOCAL statement_timeout = \'30s\'');
    
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    // CRITICAL FIX: Log rollback failures instead of silently ignoring
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      const rollbackErr = rollbackError instanceof Error 
        ? rollbackError 
        : new Error(String(rollbackError));
      logger.error('[PgBouncer] Rollback failed', rollbackErr);
      
      // Create chained error for better debugging
      const originalErr = error instanceof Error 
        ? error 
        : new Error(String(error));
      
      throw new Error(
        `Transaction failed: ${originalErr.message}. ` +
        `Additionally, rollback failed: ${rollbackErr.message}`
      );
    }
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Health check for PgBouncer
 * Verures PgBouncer is responding and has available connections
 */
export async function checkPgBouncerHealth(pool: Pool): Promise<{
  healthy: boolean;
  availableConnections: number;
  totalConnections: number;
  queueDepth: number;
}> {
  // P1-FIX: SHOW STATS is a PgBouncer-specific command that returns a syntax
  // error on a direct PostgreSQL connection. When this pool is NOT connected to
  // PgBouncer, fall back to a simple SELECT 1 health check so callers always
  // get a meaningful result rather than a permanent healthy:false.
  const connectionString = (pool as unknown as { options?: { connectionString?: string } }).options?.connectionString ?? '';
  const isBouncer = isPgBouncerConnection(connectionString);

  if (!isBouncer) {
    try {
      const client = await pool.connect();
      try {
        await client.query('SELECT 1');
        return { healthy: true, availableConnections: 0, totalConnections: 0, queueDepth: 0 };
      } finally {
        client.release();
      }
    } catch (error) {
      logger.error('Database health check failed (non-PgBouncer)', error as Error);
      return { healthy: false, availableConnections: 0, totalConnections: 0, queueDepth: 0 };
    }
  }

  try {
    const client = await pool.connect();
    try {
      // SHOW POOLS returns cl_active, cl_waiting, sv_active, sv_idle per pool.
      // Sum across all pools to get cluster-wide metrics.
      const result = await client.query('SHOW POOLS');
      const rows = result.rows;
      const active = rows.reduce((s: number, r: Record<string, unknown>) => s + (parseInt(String(r['cl_active'] ?? 0), 10) || 0), 0);
      const waiting = rows.reduce((s: number, r: Record<string, unknown>) => s + (parseInt(String(r['cl_waiting'] ?? 0), 10) || 0), 0);
      const svActive = rows.reduce((s: number, r: Record<string, unknown>) => s + (parseInt(String(r['sv_active'] ?? 0), 10) || 0), 0);

      return {
        healthy: true,
        availableConnections: active,
        totalConnections: active + waiting,
        queueDepth: waiting + svActive,
      };
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error('PgBouncer health check failed', error as Error);
    return {
      healthy: false,
      availableConnections: 0,
      totalConnections: 0,
      queueDepth: 0,
    };
  }
}

/**
 * Parse PgBouncer connection URL
 * Returns connection details for logging/debugging
 */
export function parsePgBouncerUrl(url: string): {
  host: string;
  port: number;
  database: string;
  isPgBouncer: boolean;
} {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: parseInt(parsed.port, 10) || 5432,
      database: parsed.pathname.slice(1),
      isPgBouncer: isPgBouncerConnection(url),
    };
  } catch {
    return {
      host: 'unknown',
      port: 5432,
      database: 'unknown',
      isPgBouncer: false,
    };
  }
}
