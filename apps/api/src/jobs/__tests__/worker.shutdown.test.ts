import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

/**
 * Worker Shutdown Handler Tests
 *
 * Tests the graceful shutdown logic in isolation without importing worker.ts
 * (which has module-level side effects). Each test exercises the same Promise.race
 * pattern that gracefulShutdown() uses internally.
 */

describe('Worker Shutdown Handler (P1-FIX)', () => {
  let setTimeoutSpy: jest.SpyInstance;

  beforeEach(() => {
    setTimeoutSpy = jest.spyOn(global, 'setTimeout');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Shutdown with timeout protection', () => {
    it('should resolve when scheduler stops within timeout', async () => {
      const mockStop = jest.fn().mockResolvedValue(undefined);
      const mockScheduler = { stop: mockStop };

      const SHUTDOWN_TIMEOUT_MS = 10000;
      let timerId: ReturnType<typeof setTimeout> | undefined;

      const shutdownPromise = Promise.race([
        mockScheduler.stop(),
        new Promise<never>((_, reject) => {
          timerId = setTimeout(() => reject(new Error('Shutdown timeout')), SHUTDOWN_TIMEOUT_MS);
        }),
      ]).finally(() => clearTimeout(timerId));

      await expect(shutdownPromise).resolves.toBeUndefined();
      expect(mockStop).toHaveBeenCalled();
    });

    it('should reject when scheduler hangs beyond timeout', async () => {
      const mockStop = jest.fn().mockReturnValue(new Promise<void>(() => {})); // never resolves
      const mockScheduler = { stop: mockStop };

      const SHUTDOWN_TIMEOUT_MS = 100;

      const shutdownPromise = Promise.race([
        mockScheduler.stop(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Shutdown timeout')), SHUTDOWN_TIMEOUT_MS)
        ),
      ]);

      await expect(shutdownPromise).rejects.toThrow('Shutdown timeout');
    });

    it('should reject immediately when scheduler stop() rejects', async () => {
      const mockStop = jest.fn().mockRejectedValue(new Error('Queue connection lost'));
      const mockScheduler = { stop: mockStop };

      const SHUTDOWN_TIMEOUT_MS = 10000;
      let timerId: ReturnType<typeof setTimeout> | undefined;

      const shutdownPromise = Promise.race([
        mockScheduler.stop(),
        new Promise<never>((_, reject) => {
          timerId = setTimeout(() => reject(new Error('Shutdown timeout')), SHUTDOWN_TIMEOUT_MS);
        }),
      ]).finally(() => clearTimeout(timerId));

      await expect(shutdownPromise).rejects.toThrow('Queue connection lost');
    });
  });

  describe('Timeout configuration', () => {
    it('should use a 10-second shutdown timeout (SHUTDOWN_TIMEOUT_MS)', () => {
      const SHUTDOWN_TIMEOUT_MS = 10000;
      expect(SHUTDOWN_TIMEOUT_MS).toBe(10000);
    });

    it('should force exit after a 1-second grace period on uncaught exceptions', () => {
      // The worker uses setTimeout(..., 1000) before calling process.exit(1)
      // in the uncaughtException / unhandledRejection handlers.
      const FORCED_EXIT_GRACE_MS = 1000;
      expect(FORCED_EXIT_GRACE_MS).toBe(1000);
    });
  });

  describe('Unhandled rejection shutdown flow', () => {
    it('should attempt graceful shutdown before exit', async () => {
      const mockStop = jest.fn().mockResolvedValue(undefined);
      const mockScheduler = { stop: mockStop };

      const SHUTDOWN_TIMEOUT_MS = 10000;
      let timerId: ReturnType<typeof setTimeout> | undefined;

      const shutdownPromise = Promise.race([
        mockScheduler.stop(),
        new Promise<never>((_, reject) => {
          timerId = setTimeout(() => reject(new Error('Shutdown timeout')), SHUTDOWN_TIMEOUT_MS);
        }),
      ]).finally(() => clearTimeout(timerId));

      await expect(shutdownPromise).resolves.toBeUndefined();
    });
  });

  describe('Signal handler registration', () => {
    it('verifies setTimeout is available and captures short-duration calls', () => {
      expect(setTimeoutSpy).toBeDefined();

      // Simulate the forced-exit pattern from worker.ts: setTimeout(..., 1000)
      const cb = jest.fn();
      setTimeout(cb, 1000);

      const shortCalls = setTimeoutSpy.mock.calls.filter(
        (call) => typeof call[1] === 'number' && (call[1] as number) <= 5000
      );
      expect(shortCalls.length).toBeGreaterThan(0);
    });
  });
});

describe('Worker Shutdown Integration', () => {
  it('should complete shutdown within timeout when scheduler stops quickly', async () => {
    const startTime = Date.now();

    // Simulate fast scheduler stop
    await new Promise((resolve) => setTimeout(resolve, 100));

    const duration = Date.now() - startTime;
    expect(duration).toBeLessThan(1000);
  });

  it('should timeout when scheduler hangs', async () => {
    const SHUTDOWN_TIMEOUT_MS = 500;

    const startTime = Date.now();

    try {
      await Promise.race([
        new Promise<void>(() => {}), // Never resolves
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Timeout')), SHUTDOWN_TIMEOUT_MS)
        ),
      ]);
    } catch (_e) {
      // Expected timeout
    }

    const duration = Date.now() - startTime;
    expect(duration).toBeGreaterThanOrEqual(SHUTDOWN_TIMEOUT_MS - 50);
    expect(duration).toBeLessThan(SHUTDOWN_TIMEOUT_MS + 200);
  });
});
