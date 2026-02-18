/**
 * Web App Database Module
 * 
 * This is a thin wrapper that re-exports from the shared @database package.
 * This eliminates code duplication while maintaining backward compatibility.
 * 
 * For new code, consider importing directly from @database.
 */

import { registerShutdownHandler, setupShutdownHandlers } from './shutdown';
// P1-FIX: Restored real structured logger. The no-op stub that replaced it caused all
// database errors (pool close failures, shutdown errors) to be silently discarded,
// leaving on-call engineers completely blind to web-tier DB failures in production.
import { getLogger } from '@kernel/logger';

// Re-export everything from the shared database package
export {
  // Pool exports
  getPoolInstance,
  getConnectionMetrics,
  validateResultCount,
  verifyRowCount,
  validateSortColumn,
  acquireAdvisoryLock,
  releaseAdvisoryLock,
  releaseAllAdvisoryLocks,
  pool,
  type ValidSortColumn,
  
  // Knex exports
  getDb,
  getKnex,
  
  // Transaction exports
  withTransaction,
  withLock,
  batchInsert,
  query,
  type TransactionOptions,
  type IsolationLevel,
  type TrackedClient,
  type WhereCondition,
  type AllowedTable,
  
  // JSONB exports
  MAX_JSONB_SIZE,
  MAX_JSONB_SIZE_LARGE,
  validateJSONBSize,
  serializeForJSONB,
  wouldFitInJSONB,
  truncateJSONB,
  
  // Error exports
  sanitizeDBError,
  isDBError,
  createSanitizedError,
  
  // Health exports
  checkHealth,
  checkSequenceHealth,
  getDatabaseStatus,
} from '@database';

// Import for shutdown handler registration
import { getPoolInstance as getPool } from '@database';

const logger = getLogger('database:web');

// Register shutdown handlers for the web app
let shutdownHandlersRegistered = false;

function registerShutdownHandlers(): void {
  if (shutdownHandlersRegistered) return;
  shutdownHandlersRegistered = true;

  setupShutdownHandlers();
  registerShutdownHandler(async () => {
    logger.info('Closing web app database connections...');
    try {
      const pool = await getPool();
      await pool.end();
      logger.info('Web app database pool closed successfully');
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error('Error closing web app pool', error);
    }
  });
}

// Auto-register on module load
registerShutdownHandlers();

// Additional web-specific database utilities can be added here
// For now, all functionality is provided by the shared @database package
