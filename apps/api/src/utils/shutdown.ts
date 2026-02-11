/**
* Centralized shutdown manager
* Prevents multiple competing SIGTERM/SIGINT handlers
*
* DEPRECATED: Import from @shutdown package instead
* This file is kept for backward compatibility
*/

export {
  // Types
  type ShutdownHandler,
  // Functions
  registerShutdownHandler,
  clearShutdownHandlers,
  getHandlerCount,
  gracefulShutdown,
  resetShutdownState,
  getIsShuttingDown,
  setupShutdownHandlers,
  removeShutdownHandlers,
  areShutdownHandlersRegistered,
} from '@shutdown';
