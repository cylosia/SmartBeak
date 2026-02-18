#!/usr/bin/env tsx
import { writeFileSync } from 'fs';
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
// P0-2 FIX: Wrap scheduler initialization in try/catch. Previously this was
// bare at module level — if initializeJobScheduler() threw synchronously, it
// would be an uncaught exception BEFORE the process.on('uncaughtException')
// handler was registered, bypassing graceful shutdown entirely.
function createScheduler(): ReturnType<typeof initializeJobScheduler> {
  try {
    return initializeJobScheduler(undefined, undefined);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to initialize job scheduler', err);
    process.exit(1);
  }
}
const scheduler = createScheduler();
logger.info('Job workers started');
logger.info('Registered queues: high_priority, ai-tasks, publishing, low_priority_exports, notifications, analytics');
logger.info('Waiting for jobs...');

// P1-10 FIX: Shared shutdown function with timeout protection
const SHUTDOWN_TIMEOUT_MS = 10000; // 10 second max shutdown time for scheduler
// P1-TELEMETRY FIX: Telemetry shutdown also needs its own timeout — an OTel
// exporter hanging on a dead collector would otherwise stall graceful shutdown
// indefinitely after scheduler.stop() has already completed.
const TELEMETRY_SHUTDOWN_MS = 5000; // 5 second max for telemetry flush

// P0-HEARTBEAT FIX: Write heartbeat file so the K8s liveness probe can detect
// a live process. The probe checks that /tmp/worker-heartbeat-<pid> was modified
// within the last 120 seconds; we update it every 30 seconds.
// P2-HEARTBEAT-PID FIX: Include the PID in the filename so that multiple worker
// processes running in the same container (e.g. during rolling restarts or
// dev environments) do not race to overwrite the same file.
const HEARTBEAT_FILE = `/tmp/worker-heartbeat-${process.pid}`;
const HEARTBEAT_INTERVAL_MS = 30000;

function writeHeartbeat(): void {
  try {
    writeFileSync(HEARTBEAT_FILE, String(Date.now()));
  } catch (err) {
    logger.warn('Failed to write heartbeat file', {
      error: err instanceof Error ? err['message'] : String(err),
    });
  }
}

// Write an initial heartbeat immediately so the probe passes during warm-up.
writeHeartbeat();
const heartbeatInterval = setInterval(writeHeartbeat, HEARTBEAT_INTERVAL_MS);
heartbeatInterval.unref();

// P2-4 FIX: Guard against concurrent gracefulShutdown() invocations.
// If SIGTERM fires while an uncaughtException is mid-shutdown (or vice versa),
// a second call to scheduler.stop() could cause undefined behavior depending
// on the scheduler implementation. The guard ensures only one shutdown runs.
let shutdownInProgress = false;

async function gracefulShutdown(signal: string): Promise<void> {
  if (shutdownInProgress) {
    logger.warn(`${signal} received but shutdown already in progress — skipping duplicate`);
    return;
  }
  shutdownInProgress = true;
  logger.info(`${signal} received, shutting down gracefully`);

  // Stop heartbeat writes so the probe detects a dead worker if shutdown hangs.
  clearInterval(heartbeatInterval);

  try {
    // Always clear the timeout timer when the race settles, whether stop() wins or
    // the timeout wins, so the dangling timer does not hold the event loop open.
    let shutdownTimerId: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      scheduler.stop(),
      new Promise<never>((_, reject) => {
        shutdownTimerId = setTimeout(() => reject(new Error('Shutdown timeout')), SHUTDOWN_TIMEOUT_MS);
      }),
    ]).finally(() => {
      clearTimeout(shutdownTimerId);
    });
    logger.info('Worker stopped');

    // Flush pending OTel spans — wrap in its own timeout so a hung exporter
    // (e.g. collector unreachable) cannot stall the entire shutdown sequence.
    let telemetryTimerId: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      shutdownTelemetry(),
      new Promise<never>((_, reject) => {
        telemetryTimerId = setTimeout(
          () => reject(new Error('Telemetry shutdown timeout')),
          TELEMETRY_SHUTDOWN_MS
        );
      }),
    ]).finally(() => {
      clearTimeout(telemetryTimerId);
    });
    logger.info('Telemetry shutdown complete');
  } catch (shutdownError) {
    logger.error('Forced shutdown due to timeout or error',
      shutdownError instanceof Error ? shutdownError : new Error(String(shutdownError))
    );
    // Re-throw so callers can distinguish clean vs forced shutdown.
    throw shutdownError;
  }
}

// P1-15 FIX: All signal handlers wrapped in try-catch to handle synchronous throws
// from gracefulShutdown() in addition to async rejection handling.
// P0-EXIT-CODE FIX: Exit with code 1 when graceful shutdown fails so that
// Kubernetes (and monitoring) can detect unhealthy terminations.
process.on('SIGTERM', () => {
  try {
    gracefulShutdown('SIGTERM')
      .then(() => process.exit(0))
      .catch((err) => {
        logger.error('SIGTERM handler error', err instanceof Error ? err : new Error(String(err)));
        process.exit(1);
      });
  } catch (syncErr) {
    logger.error('Sync error in SIGTERM handler', syncErr instanceof Error ? syncErr : new Error(String(syncErr)));
    process.exit(1);
  }
});

process.on('SIGINT', () => {
  try {
    gracefulShutdown('SIGINT')
      .then(() => process.exit(0))
      .catch((err) => {
        logger.error('SIGINT handler error', err instanceof Error ? err : new Error(String(err)));
        process.exit(1);
      });
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
