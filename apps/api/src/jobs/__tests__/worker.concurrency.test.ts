/**
 * P1 ASYNC/CONCURRENCY TESTS: Worker Process
 * 
 * Tests for:
 * - Unhandled promise rejection handling
 * - Process exit on critical errors
 * - Graceful shutdown behavior
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Worker - Async/Concurrency Tests', () => {
  let processExitSpy: ReturnType<typeof vi.spyOn>;
  const processOnHandlers: Map<string, (...args: unknown[]) => void> = new Map();

  beforeEach(() => {
    // Install fake timers before anything else so vi.advanceTimersByTime() works.
    vi.useFakeTimers();
    vi.clearAllMocks();
    processOnHandlers.clear();

    // Mock process.exit to prevent actual exit
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined) => {
      throw new Error(`PROCESS_EXIT_${code}`);
    });

    // Mock process.on to capture handlers
    vi.spyOn(process, 'on').mockImplementation((event: string | symbol, listener: (...args: unknown[]) => void) => {
      if (typeof event === 'string') {
        processOnHandlers.set(event, listener);
      }
      return process;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('Unhandled Promise Rejection', () => {
    it('should exit process(1) on unhandled rejection', async () => {
      // Import the worker module to register handlers
      await import('../worker');

      const unhandledRejectionHandler = processOnHandlers.get('unhandledRejection');
      expect(unhandledRejectionHandler).toBeDefined();

      // Simulate unhandled rejection
      const testError = new Error('Test unhandled rejection');
      
      expect(() => {
        unhandledRejectionHandler!(testError);
      }).toThrow('PROCESS_EXIT_1');

      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should handle non-Error rejection reasons', async () => {
      await import('../worker');

      const unhandledRejectionHandler = processOnHandlers.get('unhandledRejection');
      
      // Test with string rejection
      expect(() => {
        unhandledRejectionHandler!('string rejection');
      }).toThrow('PROCESS_EXIT_1');

      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should handle object rejection reasons', async () => {
      await import('../worker');

      const unhandledRejectionHandler = processOnHandlers.get('unhandledRejection');
      
      // Test with object rejection
      expect(() => {
        unhandledRejectionHandler!({ custom: 'error' });
      }).toThrow('PROCESS_EXIT_1');

      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('Uncaught Exception', () => {
    it('should exit process(1) on uncaught exception after cleanup', async () => {
      await import('../worker');

      const uncaughtExceptionHandler = processOnHandlers.get('uncaughtException');
      expect(uncaughtExceptionHandler).toBeDefined();

      const testError = new Error('Test uncaught exception');
      
      // Should not throw immediately due to setTimeout
      uncaughtExceptionHandler!(testError);
      
      // Process exit is delayed by 5 seconds
      expect(processExitSpy).not.toHaveBeenCalled();
      
      // Fast-forward time
      vi.advanceTimersByTime(5000);
    });
  });

  describe('Signal Handling', () => {
    it('should register SIGTERM handler', async () => {
      await import('../worker');

      const sigtermHandler = processOnHandlers.get('SIGTERM');
      expect(sigtermHandler).toBeDefined();
    });

    it('should register SIGINT handler', async () => {
      await import('../worker');

      const sigintHandler = processOnHandlers.get('SIGINT');
      expect(sigintHandler).toBeDefined();
    });
  });
});
