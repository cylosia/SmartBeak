#!/usr/bin/env tsx
import { initializeJobScheduler } from './index';
// P1-9 FIX: Import from shared package instead of cross-app import from apps/web
import { validateEnv } from '@config/validation';
import { shutdownTelemetry } from '@smartbeak/monitoring';
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

// P2-13 FIX: Remove emoji and \n from structured log messages
logger.info('Starting SmartBeak background worker');

// Validate environment
try {
  validateEnv();
  logger.info('Environment validated');
}
catch (error) {
  const err = error instanceof Error ? error : new Error(String(error));
  logger.error('Environment validation failed', err);
  process.exit(1);
}

// Initialize scheduler and workers
const scheduler = initializeJobScheduler(undefined, undefined);
logger.info('Job workers started');
logger.info('Registered queues: high_priority, ai-tasks, publishing, low_priority_exports, notifications, analytics');
logger.info('Waiting for jobs...');

// P1-10 FIX: Shared shutdown function with timeout protection
const SHUTDOWN_TIMEOUT_MS = 10000; // 10 second max shutdown time

async function gracefulShutdown(signal: string): Promise<void> {
  logger.info(`${signal} received, shutting down gracefully`);

  try {
    await Promise.race([
      scheduler.stop(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Shutdown timeout')), SHUTDOWN_TIMEOUT_MS)
      )
    ]);
    logger.info('Worker stopped');

    // Flush pending OTel spans
    await shutdownTelemetry();
    logger.info('Telemetry shutdown complete');
  } catch (shutdownError) {
    logger.error('Forced shutdown due to timeout or error',
      shutdownError instanceof Error ? shutdownError : new Error(String(shutdownError))
    );
  }
}

// P1-15 FIX: All signal handlers wrapped in try-catch to handle synchronous throws
// from gracefulShutdown() in addition to async rejection handling
process.on('SIGTERM', () => {
  try {
    gracefulShutdown('SIGTERM')
      .catch((err) => logger.error('SIGTERM handler error', err instanceof Error ? err : new Error(String(err))))
      .finally(() => process.exit(0));
  } catch (syncErr) {
    logger.error('Sync error in SIGTERM handler', syncErr instanceof Error ? syncErr : new Error(String(syncErr)));
    process.exit(1);
  }
});

process.on('SIGINT', () => {
  try {
    gracefulShutdown('SIGINT')
      .catch((err) => logger.error('SIGINT handler error', err instanceof Error ? err : new Error(String(err))))
      .finally(() => process.exit(0));
  } catch (syncErr) {
    logger.error('Sync error in SIGINT handler', syncErr instanceof Error ? syncErr : new Error(String(syncErr)));
    process.exit(1);
  }
});

// Handle uncaught errors
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', err);

  try {
    gracefulShutdown('uncaughtException')
      .catch((shutdownErr) => logger.error('Shutdown error after uncaught exception', shutdownErr instanceof Error ? shutdownErr : new Error(String(shutdownErr))))
      .finally(() => {
        setTimeout(() => {
          logger.error('Forcing exit after shutdown attempt');
          process.exit(1);
        }, 1000);
      });
  } catch (syncErr) {
    logger.error('Sync error in uncaughtException handler', syncErr instanceof Error ? syncErr : new Error(String(syncErr)));
    process.exit(1);
  }
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', reason instanceof Error ? reason : new Error(String(reason)));

  try {
    gracefulShutdown('unhandledRejection')
      .catch((shutdownErr) => logger.error('Shutdown error after unhandled rejection', shutdownErr instanceof Error ? shutdownErr : new Error(String(shutdownErr))))
      .finally(() => {
        setTimeout(() => process.exit(1), 1000);
      });
  } catch (syncErr) {
    logger.error('Sync error in unhandledRejection handler', syncErr instanceof Error ? syncErr : new Error(String(syncErr)));
    process.exit(1);
  }
});

// Keep process alive but don't block shutdown
// Without .unref(), the event loop will never be empty and graceful shutdown fails
const keepAlive = setInterval(() => { }, 1000);
keepAlive.unref();
