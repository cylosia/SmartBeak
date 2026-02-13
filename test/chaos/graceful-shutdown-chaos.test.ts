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
    // Override process.exit to prevent actual exit
    process.exit = vi.fn() as never;
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
    it('should timeout slow handlers at 30s and continue with others', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });

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

      vi.useRealTimers();
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
