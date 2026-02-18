/**
 * Centralized shutdown manager for web layer
 * Prevents multiple competing SIGTERM/SIGINT handlers
 *
 * Duplicated from api layer to maintain architectural boundaries
 * All shutdown handlers should be registered through this module
 * to ensure graceful coordinated shutdown.
 *
 * MEDIUM FIX R2: Add timer cleanup in error paths
 * MEDIUM FIX R3: Add cleanup on shutdown
 * MEDIUM FIX R4: Add signal handling
 * MEDIUM FIX R5: Add resource limits
 * MEDIUM FIX M6: Extract magic numbers to constants
 * MEDIUM FIX M16: Add JSDoc comments
 * MEDIUM FIX E17: Add proper error handling in empty catch blocks
 */

// P2-FIX: @kernel/logger is not in apps/web dependencies (architectural boundary).
// Use structured console wrappers so shutdown events are observable in production
// logs rather than silently swallowed.  Replace with a proper logger if/when the
// web package takes a dependency on @kernel.
const getLogger = (name: string) => ({
  debug: (...args: unknown[]) => console.debug(`[${name}]`, ...args),
  info:  (...args: unknown[]) => console.info(`[${name}]`, ...args),
  warn:  (...args: unknown[]) => console.warn(`[${name}]`, ...args),
  error: (...args: unknown[]) => console.error(`[${name}]`, ...args),
});

/** Logger instance for shutdown operations */
const logger = getLogger('shutdown');

/** Shutdown handler function type */
export type ShutdownHandler = () => Promise<void> | void;

/** Handler registration with metadata */
interface HandlerRegistration {
  handler: ShutdownHandler;
  name: string;
  priority: number;
}

/** Set of registered shutdown handlers */
const handlers: Set<HandlerRegistration> = new Set();

/** Set of active timers for cleanup */
const activeTimers: Set<ReturnType<typeof setTimeout>> = new Set();

/** Flag indicating if shutdown is in progress */
let isShuttingDown = false;

const SHUTDOWN_TIMEOUT_MS = 60000;
const HANDLER_TIMEOUT_MS = 30000;
const FORCE_EXIT_TIMEOUT_MS = 5000;

// ============================================================================
// Handler Management
// ============================================================================

/**
 * Register a shutdown handler to be called during graceful shutdown
 * MEDIUM FIX M16: Add JSDoc comments
 *
 * @param handler - Function to call during shutdown (can be async)
 * @param options - Registration options
 * @param options.name - Handler name for logging
 * @param options.priority - Handler priority (lower = earlier)
 * @returns Function to unregister the handler
 */
export function registerShutdownHandler(
  handler: ShutdownHandler,
  options?: { name?: string; priority?: number }
): () => void {
  const registration: HandlerRegistration = {
    handler,
    name: options?.name || handler.name || 'anonymous',
    priority: options?.priority ?? 50,
  };

  handlers.add(registration);
  logger.debug(`Registered shutdown handler: ${registration.name}`);

  return () => {
    handlers.delete(registration);
    logger.debug(`Unregistered shutdown handler: ${registration.name}`);
  };
}

/**
 * Register a timer for automatic cleanup on shutdown
 * MEDIUM FIX R2: Add timer cleanup in error paths
 * MEDIUM FIX M16: Add JSDoc comments
 *
 * @param timer - Timer to register
 * @returns The timer for chaining
 */
export function registerTimer<T extends ReturnType<typeof setTimeout>>(timer: T): T {
  activeTimers.add(timer);
  return timer;
}

/**
 * Clear a registered timer
 * MEDIUM FIX R2: Add timer cleanup in error paths
 * MEDIUM FIX M16: Add JSDoc comments
 *
 * @param timer - Timer to clear
 */
export function clearRegisteredTimer(timer: ReturnType<typeof setTimeout>): void {
  clearTimeout(timer);
  activeTimers.delete(timer);
}

// ============================================================================
// Cleanup Functions
// ============================================================================

/**
 * Clean up all registered timers
 * MEDIUM FIX R2: Add timer cleanup in error paths
 * MEDIUM FIX M16: Add JSDoc comments
 */
function cleanupTimers(): void {
  for (const timer of activeTimers) {
    clearTimeout(timer);
  }
  activeTimers.clear();
  logger.debug('Cleaned up all registered timers');
}

// ============================================================================
// Shutdown Execution
// ============================================================================

/**
 * Execute graceful shutdown with all registered handlers
 * MEDIUM FIX R2: Add timer cleanup in error paths
 * MEDIUM FIX R3: Add cleanup on shutdown
 * MEDIUM FIX R4: Add signal handling
 * MEDIUM FIX M16: Add JSDoc comments
 *
 * @param signal - The signal that triggered the shutdown
 */
export async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    logger.warn('Shutdown already in progress, ignoring signal');
    return;
  }
  isShuttingDown = true;

  logger.info(`Received ${signal}, starting graceful shutdown...`);

  // Set up force exit timeout
  const forceExitTimer = setTimeout(() => {
    logger.error('Force exit timeout exceeded, terminating immediately');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS + FORCE_EXIT_TIMEOUT_MS);

  // Set up shutdown timeout
  const timeout = setTimeout(() => {
    logger.error('Shutdown timeout exceeded, forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  try {
    // Sort handlers by priority (lower = earlier)
    const sortedHandlers = [...handlers].sort((a, b) => a.priority - b.priority);

    // Execute all registered handlers in sequence with individual timeouts
    const handlerPromises = sortedHandlers.map(async (registration, index) => {
      const handlerName = registration.name || `handler-${index}`;
      let handlerTimer: ReturnType<typeof setTimeout> | null = null;

      try {
        logger.debug(`Executing shutdown handler: ${handlerName}`);
        const result = registration.handler();

        // Handle both sync and async handlers with timeout
        if (result && typeof result.then === 'function') {
          const timeoutPromise = new Promise<never>((_, reject) => {
            handlerTimer = setTimeout(() => {
              reject(new Error(`Handler ${handlerName} timed out`));
            }, HANDLER_TIMEOUT_MS);
          });

          await Promise.race([result, timeoutPromise]);
        }

        logger.debug(`Shutdown handler completed: ${handlerName}`);
      } catch (err) {
                logger.error(`Shutdown handler ${handlerName} failed:`, err instanceof Error ? err : new Error(String(err)));
      } finally {
                if (handlerTimer) {
          clearTimeout(handlerTimer);
        }
      }
    });

    await Promise.all(handlerPromises);

        cleanupTimers();

    logger.info('Graceful shutdown completed');
  } catch (error) {
        logger.error('Error during shutdown:', error instanceof Error ? error : new Error(String(error)));
  } finally {
    clearTimeout(timeout);
    clearTimeout(forceExitTimer);
    process.exit(0);
  }
}

/**
 * Perform immediate shutdown without waiting for handlers
 * MEDIUM FIX R4: Add signal handling
 * MEDIUM FIX M16: Add JSDoc comments
 *
 * @param reason - Reason for immediate exit
 */
export function immediateShutdown(reason: string): void {
  logger.error(`Immediate shutdown requested: ${reason}`);
  cleanupTimers();
  process.exit(1);
}

// ============================================================================
// Global Handler Setup
// ============================================================================

/** Flag indicating if global handlers are registered */
let isRegistered = false;

/**
 * Setup global shutdown handlers (SIGTERM/SIGINT)
 * Safe to call multiple times - handlers are registered only once
 * MEDIUM FIX R4: Add signal handling
 * MEDIUM FIX M16: Add JSDoc comments
 */
export function setupShutdownHandlers(): void {
  if (isRegistered) return;
  isRegistered = true;

  // Handle graceful shutdown signals
  process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => void gracefulShutdown('SIGINT'));

  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception:', error instanceof Error ? error : new Error(String(error)));
    void gracefulShutdown('uncaughtException');
  });

  // Handle unhandled rejections
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection: ' + (reason instanceof Error ? reason.message : String(reason)));
    void gracefulShutdown('unhandledRejection');
  });

  logger.debug('Shutdown handlers registered');
}

/**
 * Check if shutdown is in progress
 * MEDIUM FIX M16: Add JSDoc comments
 *
 * @returns True if shutdown is in progress
 */
export function isShutdownInProgress(): boolean {
  return isShuttingDown;
}

/**
 * Get registered handler count
 * MEDIUM FIX M16: Add JSDoc comments
 *
 * @returns Number of registered handlers
 */
export function getHandlerCount(): number {
  return handlers.size;
}
