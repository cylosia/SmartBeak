/**
 * Database Configuration
 * 
 * Database connection and query settings.
 */

import { parseIntEnv } from './env';

export const dbConfig = {
  /** Connection pool size */
  poolSize: parseIntEnv('DB_POOL_SIZE', 20),

  /** Statement timeout in milliseconds */
  statementTimeoutMs: parseIntEnv('DB_STATEMENT_TIMEOUT_MS', 30000),

  /** Connection timeout in milliseconds */
  connectionTimeoutMs: parseIntEnv('DB_CONNECTION_TIMEOUT_MS', 10000),

  /** Query timeout for complex operations in milliseconds */
  queryTimeoutMs: parseIntEnv('DB_QUERY_TIMEOUT_MS', 60000),
} as const;
