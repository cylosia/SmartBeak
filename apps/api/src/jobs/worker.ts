#!/usr/bin/env tsx
import { initializeJobScheduler } from './index';
import { validateEnv } from '../../../web/lib/env';
import { getLogger } from '@kernel/logger';
/**
 * Background Worker Entry Point
 * Starts job workers to process queued jobs
 *
 * Usage:
 *   npm run worker
 *   OR
 *   tsx apps/api/src/jobs/worker.ts
 */
const logger = getLogger('worker');
logger.info('🚀 Starting SmartBeak background worker...\n');
// Validate environment
try {
  validateEnv();
  logger.info('✅ Environment validated\n');
}
catch (error) {
  const err = error instanceof Error ? error : new Error(String(error));
  logger.error('❌ Environment validation failed', err);
  process.exit(1);
}
// Initialize scheduler and workers
const scheduler = initializeJobScheduler(undefined, undefined);
logger.info('✅ Job workers started');
logger.info('📋 Registered queues: high_priority, ai-tasks, publishing, low_priority_exports, notifications, analytics');
logger.info('\nWaiting for jobs...\n');
// Handle graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('\n🛑 SIGTERM received, shutting down gracefully...');
  await scheduler.stop();
  logger.info('✅ Worker stopped');
  process.exit(0);
});
process.on('SIGINT', async () => {
  logger.info('\n🛑 SIGINT received, shutting down gracefully...');
  await scheduler.stop();
  logger.info('✅ Worker stopped');
  process.exit(0);
});
// Handle uncaught errors
// P1-FIX: Add timeout protection for graceful shutdown
process.on('uncaughtException', async (err) => {
  logger.error('Uncaught exception', err);
  
  // P1-FIX: Race shutdown against timeout to prevent hanging
  const SHUTDOWN_TIMEOUT_MS = 10000; // 10 second max shutdown time
  
  try {
    await Promise.race([
      scheduler.stop(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Shutdown timeout')), SHUTDOWN_TIMEOUT_MS)
      )
    ]);
    logger.info('Graceful shutdown completed after uncaught exception');
  } catch (shutdownError) {
    logger.error('Forced shutdown due to timeout or error', 
      shutdownError instanceof Error ? shutdownError : new Error(String(shutdownError))
    );
  }
  
  // P1-FIX: Shorter grace period before forced exit
  setTimeout(() => {
    logger.error('Forcing exit after shutdown attempt');
    process.exit(1);
  }, 1000);
});
// P1-FIX: Add unhandledRejection shutdown handling with timeout protection
process.on('unhandledRejection', async (reason) => {
  logger.error('Unhandled rejection', reason instanceof Error ? reason : new Error(String(reason)));
  
  // P1-FIX: Attempt graceful shutdown on unhandled rejection too
  const SHUTDOWN_TIMEOUT_MS = 10000;
  
  try {
    await Promise.race([
      scheduler.stop(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Shutdown timeout')), SHUTDOWN_TIMEOUT_MS)
      )
    ]);
    logger.info('Graceful shutdown completed after unhandled rejection');
  } catch (shutdownError) {
    logger.error('Forced shutdown due to timeout or error',
      shutdownError instanceof Error ? shutdownError : new Error(String(shutdownError))
    );
  }
  
  setTimeout(() => process.exit(1), 1000);
});
// P0-FIX: Keep process alive but don't block shutdown
// Without .unref(), the event loop will never be empty and graceful shutdown fails
const keepAlive = setInterval(() => { }, 1000);
keepAlive.unref();
