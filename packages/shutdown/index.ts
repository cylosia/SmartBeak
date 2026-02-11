import { getLogger } from '@kernel/logger';

/**
* Centralized Shutdown Manager Package
* Prevents multiple competing SIGTERM/SIGINT handlers
*
* All shutdown handlers should be registered through this module
* to ensure graceful coordinated shutdown.
*
* This package was extracted from apps/api/src/utils/shutdown.ts
* to prevent cross-boundary imports from apps/web/lib/db.ts
*/

/** Logger instance for shutdown operations */
const logger = getLogger({ service: 'shutdown' });

/** Shutdown handler function type */
export type ShutdownHandler = () => Promise<void> | void;

/** Set of registered shutdown handlers */
const handlers: Set<ShutdownHandler> = new Set();

/** Flag indicating if shutdown is in progress */
let isShuttingDown = false;

// ============================================================================
// Handler Management
// ============================================================================

/**
* Register a shutdown handler to be called during graceful shutdown
* @param handler - Function to call during shutdown (can be async)
* @returns Function to unregister the handler
*/
export function registerShutdownHandler(handler: ShutdownHandler): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

/**
* Unregister all shutdown handlers
* Useful for testing
*/
export function clearShutdownHandlers(): void {
  handlers.clear();
}

/**
* Get the count of registered handlers
* Useful for testing and monitoring
*/
export function getHandlerCount(): number {
  return handlers.size;
}

// ============================================================================
// Shutdown Execution
// ============================================================================

/**
* Execute graceful shutdown with all registered handlers
* @param signal - The signal that triggered the shutdown
* @param exitCode - Exit code to use (default: 0 for graceful, 1 for forced)
*/
export async function gracefulShutdown(signal: string, exitCode = 0): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`Received ${signal}, starting graceful shutdown...`);

  // Use a longer timeout to avoid interrupting in-flight operations
  const SHUTDOWN_TIMEOUT_MS = 60000;

  const timeout = setTimeout(() => {
  logger["error"]('Shutdown timeout exceeded, forcing exit');
  process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  try {
  // P1-FIX: Execute all registered handlers with error isolation
  const handlerTimeoutMs = 30000;
  const handlerPromises = Array.from(handlers).map(async (handler, index) => {
    const handlerName = handler.name || `handler-${index}`;
    try {
    const result = handler();
    // Handle both sync and async handlers with timeout
    if (result && typeof result.then === 'function') {
      await Promise.race([
        result,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Handler ${handlerName} timed out`)), handlerTimeoutMs)
        )
      ]);
    }
    logger.info(`Shutdown handler ${handlerName} completed successfully`);
    } catch (err) {
    // P1-FIX: Log error but don't stop other handlers
    logger["error"](`Shutdown handler ${handlerName} failed:`, err as Error);
    // Continue with other handlers - don't let one failure stop shutdown
    }
  });

  // P1-FIX: Use Promise.allSettled to ensure all handlers complete
  const results = await Promise.allSettled(handlerPromises);
  const failures = results.filter(r => r.status === 'rejected');
  if (failures.length > 0) {
    logger["error"](`${failures.length} shutdown handlers failed`);
  }
  } catch (error) {
  // P1-FIX: Catch any unexpected errors during shutdown
  logger["error"]('Unexpected error during shutdown:', error as Error);
  } finally {
  clearTimeout(timeout);
  process.exit(exitCode);
  }
}

/**
* Reset the shutdown state
* Useful for testing
*/
export function resetShutdownState(): void {
  isShuttingDown = false;
}

/**
* Check if shutdown is in progress
*/
export function getIsShuttingDown(): boolean {
  return isShuttingDown;
}

// ============================================================================
// Global Handler Setup
// ============================================================================

/** Flag indicating if global handlers are registered */
let isRegistered = false;

/**
* Setup global shutdown handlers (SIGTERM/SIGINT)
* Safe to call multiple times - handlers are registered only once
* P1-FIX: Added try/catch around shutdown logic
*/
export function setupShutdownHandlers(): void {
  if (isRegistered) return;
  isRegistered = true;

  process.on('SIGTERM', async () => {
  try {
    await gracefulShutdown('SIGTERM');
  } catch (error) {
    logger["error"]('SIGTERM shutdown error:', error as Error);
    process.exit(1);
  }
  });

  process.on('SIGINT', async () => {
  try {
    await gracefulShutdown('SIGINT');
  } catch (error) {
    logger["error"]('SIGINT shutdown error:', error as Error);
    process.exit(1);
  }
  });
}

/**
* Remove global shutdown handlers
* Useful for testing
*/
export function removeShutdownHandlers(): void {
  if (!isRegistered) return;
  isRegistered = false;

  process.removeAllListeners('SIGTERM');
  process.removeAllListeners('SIGINT');
}

/**
* Check if global handlers are registered
*/
export function areShutdownHandlersRegistered(): boolean {
  return isRegistered;
}
