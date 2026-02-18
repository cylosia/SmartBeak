/**
 * Chaos/Failure Tests: Graceful Shutdown
 *
 * Tests shutdown manager under fault injection:
 * - Shutdown handler throws → others still execute
 * - Shutdown handler hangs → per-handler timeout triggers
 * - Double SIGTERM → isShuttingDown prevents re-entry
 * - Handler registration/unregistration during shutdown
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@kernel/logger', () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  registerShutdownHandler,
  clearShutdownHandlers,
  getHandlerCount,
  gracefulShutdown,
  resetShutdownState,
  getIsShuttingDown,
} from '@/packages/shutdown/index';

describe('Graceful Shutdown - Chaos Scenarios', () => {
  // Mock process.exit to prevent test runner from exiting
  const originalExit = process.exit;

  beforeEach(() => {
    vi.clearAllMocks();
    clearShutdownHandlers();
    resetShutdownState();
    // Override process.exit to prevent actual exit.
    // P2-9 FIX: cast via unknown instead of directly to never. process.exit has
    // return type never; casting vi.fn() directly to never is semantically wrong
    // (the mock returns undefined, not never) and confuses the type-checker.
    (process.exit as unknown as (code?: number) => void) = vi.fn();
  });

  afterEach(() => {
    process.exit = originalExit;
    clearShutdownHandlers();
    resetShutdownState();
    vi.restoreAllMocks();
  });

  describe('Handler Failure Isolation', () => {
    it('should execute all handlers even when one throws (Promise.allSettled)', async () => {
      const executionLog: string[] = [];

      registerShutdownHandler(async () => {
        executionLog.push('handler-1-start');
        executionLog.push('handler-1-complete');
      });

      registerShutdownHandler(async () => {
        executionLog.push('handler-2-start');
        throw new Error('Handler 2 crashed!');
      });

      registerShutdownHandler(async () => {
        executionLog.push('handler-3-start');
        executionLog.push('handler-3-complete');
      });

      await gracefulShutdown('SIGTERM');

      // Handlers 1 and 3 should have completed despite handler 2 failing
      expect(executionLog).toContain('handler-1-start');
      expect(executionLog).toContain('handler-1-complete');
      expect(executionLog).toContain('handler-2-start');
      expect(executionLog).toContain('handler-3-start');
      expect(executionLog).toContain('handler-3-complete');
    });

    it('should still call process.exit even when handlers fail', async () => {
      registerShutdownHandler(async () => {
        throw new Error('Critical failure');
      });

      await gracefulShutdown('SIGTERM');

      expect(process.exit).toHaveBeenCalledWith(0);
    });
  });

  describe('Handler Timeout', () => {
    // P1-17 FIX: scope fake timer setup/teardown to this describe block via nested
    // beforeEach/afterEach. Previously vi.useFakeTimers() was called inside the test
    // body and vi.useRealTimers() appeared after assertions — if any assertion failed,
    // the exception propagated past useRealTimers(), leaving all subsequent tests in
    // the suite running with fake timers active (causing hangs and incorrect results).
    // P2-8 FIX: shouldAdvanceTime: false (was true). true causes real wall-clock time
    // to advance alongside fake time, creating non-deterministic races on slow CI
    // machines where the real 30s handler timeout could fire before advanceTimersByTimeAsync
    // completes, making tests pass or fail unpredictably depending on system load.
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: false });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should timeout slow handlers at 30s and continue with others', async () => {
      const executionLog: string[] = [];

      registerShutdownHandler(async () => {
        executionLog.push('fast-handler-done');
      });

      registerShutdownHandler(async () => {
        // This handler will hang (simulated by a promise that takes longer than 30s)
        await new Promise(resolve => setTimeout(resolve, 35000));
        executionLog.push('slow-handler-done'); // Should not reach
      });

      registerShutdownHandler(async () => {
        executionLog.push('another-fast-handler-done');
      });

      const shutdownPromise = gracefulShutdown('SIGTERM');

      // Advance time past the handler timeout (30s)
      await vi.advanceTimersByTimeAsync(31000);

      await shutdownPromise;

      expect(executionLog).toContain('fast-handler-done');
      expect(executionLog).toContain('another-fast-handler-done');
    });

    it('should call process.exit(1) when the global 60s shutdown timeout is exceeded', async () => {
      // P1-8 FIX: Test that the global SHUTDOWN_TIMEOUT_MS = 60000 safety net fires.
      // Previously only the 30s per-handler timeout was tested; the outer 60s timeout
      // (which calls process.exit(1) and is the last-resort escape hatch) had zero
      // coverage. A regression removing or extending that timeout would go undetected,
      // leaving the process hung indefinitely on broken shutdown handlers in production.
      registerShutdownHandler(async () => {
        // This handler never resolves — simulates a completely hung handler that
        // also suppresses the per-handler timeout (e.g. a Promise.race override).
        await new Promise<void>(() => { /* intentionally never resolves */ });
      });

      const shutdownPromise = gracefulShutdown('SIGTERM');

      // Advance fake time past the global 60s shutdown timeout
      await vi.advanceTimersByTimeAsync(61000);

      await shutdownPromise;

      // The global timeout must have fired process.exit(1)
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });

  describe('Double SIGTERM Prevention', () => {
    it('should prevent re-entry via isShuttingDown flag', async () => {
      let callCount = 0;

      registerShutdownHandler(async () => {
        callCount++;
      });

      // First shutdown
      await gracefulShutdown('SIGTERM');

      // Reset to test re-entry protection
      // Note: isShuttingDown is set to true by first call
      expect(getIsShuttingDown()).toBe(true);

      // Second call should be a no-op
      await gracefulShutdown('SIGTERM');

      // Handler should only have been called once
      expect(callCount).toBe(1);
      // P1-9 FIX: Assert process.exit was called exactly once. Without this, a
      // re-entry guard regression (where isShuttingDown check is accidentally removed)
      // would pass the callCount assertion but call process.exit twice — undetected.
      expect(process.exit).toHaveBeenCalledTimes(1);
      expect(process.exit).toHaveBeenCalledWith(0);
    });
  });

  describe('Sync Handler Support', () => {
    it('should handle synchronous shutdown handlers', async () => {
      const executionLog: string[] = [];

      registerShutdownHandler(() => {
        executionLog.push('sync-handler');
      });

      registerShutdownHandler(async () => {
        executionLog.push('async-handler');
      });

      await gracefulShutdown('SIGINT');

      expect(executionLog).toContain('sync-handler');
      expect(executionLog).toContain('async-handler');
    });
  });

  describe('Handler Count Tracking', () => {
    it('should track handler count accurately through add/remove cycles', () => {
      expect(getHandlerCount()).toBe(0);

      const unregister1 = registerShutdownHandler(async () => {});
      expect(getHandlerCount()).toBe(1);

      const unregister2 = registerShutdownHandler(async () => {});
      expect(getHandlerCount()).toBe(2);

      unregister1();
      expect(getHandlerCount()).toBe(1);

      unregister2();
      expect(getHandlerCount()).toBe(0);
    });
  });

  describe('Exit Code Behavior', () => {
    it('should exit with code 0 for graceful shutdown', async () => {
      registerShutdownHandler(async () => {});

      await gracefulShutdown('SIGTERM', 0);

      expect(process.exit).toHaveBeenCalledWith(0);
    });

    it('should exit with custom code when specified', async () => {
      registerShutdownHandler(async () => {});

      await gracefulShutdown('SIGTERM', 1);

      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });
});
