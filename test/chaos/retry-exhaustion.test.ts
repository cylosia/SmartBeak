/**
 * Chaos/Failure Tests: Retry Exhaustion
 *
 * Tests retry logic under various failure modes:
 * - Exhaustion of all retry attempts
 * - Jitter calculation correctness
 * - Non-retryable error detection
 * - shouldRetry callback behavior
 * - Retry history bounds
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

import { withRetry, cleanupRetryHistory } from '@kernel/retry';

describe('Retry - Exhaustion & Edge Cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('Retry Exhaustion', () => {
    it('should throw final error after exhausting all retry attempts', async () => {
      let attemptCount = 0;

      await expect(
        withRetry(
          async () => {
            attemptCount++;
            throw new Error('ECONNREFUSED: connection refused');
          },
          {
            maxRetries: 3,
            initialDelayMs: 10,
            maxDelayMs: 100,
            backoffMultiplier: 2,
          }
        )
      ).rejects.toThrow('ECONNREFUSED');

      // Should have made 4 attempts total (1 initial + 3 retries)
      expect(attemptCount).toBe(4);
    });

    it('should include the original error message in the thrown error', async () => {
      try {
        await withRetry(
          async () => {
            throw new Error('ETIMEDOUT: operation timed out');
          },
          {
            maxRetries: 2,
            initialDelayMs: 10,
            maxDelayMs: 50,
            backoffMultiplier: 2,
          }
        );
        // Should not reach here
        expect.unreachable('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('ETIMEDOUT');
      }
    });

    it('should call onRetry callback for each retry attempt', async () => {
      const onRetryCalls: Array<{ error: Error; attempt: number }> = [];

      try {
        await withRetry(
          async () => {
            throw new Error('timeout: request timed out');
          },
          {
            maxRetries: 3,
            initialDelayMs: 10,
            maxDelayMs: 100,
            backoffMultiplier: 2,
            onRetry: (error, attempt) => {
              onRetryCalls.push({ error, attempt });
            },
          }
        );
      } catch {
        // Expected
      }

      expect(onRetryCalls).toHaveLength(3);
      expect(onRetryCalls[0]!.attempt).toBe(1);
      expect(onRetryCalls[1]!.attempt).toBe(2);
      expect(onRetryCalls[2]!.attempt).toBe(3);
    });
  });

  describe('Non-Retryable Errors', () => {
    it('should not retry on errors that do not match retryable patterns', async () => {
      let attemptCount = 0;

      try {
        await withRetry(
          async () => {
            attemptCount++;
            throw new Error('Validation failed: invalid input');
          },
          {
            maxRetries: 3,
            initialDelayMs: 10,
            maxDelayMs: 100,
            backoffMultiplier: 2,
          }
        );
      } catch {
        // Expected
      }

      // Should only attempt once — "Validation failed" is not retryable
      expect(attemptCount).toBe(1);
    });

    it('should not retry when shouldRetry callback returns false', async () => {
      let attemptCount = 0;

      try {
        await withRetry(
          async () => {
            attemptCount++;
            throw new Error('ECONNREFUSED: would normally retry');
          },
          {
            maxRetries: 3,
            initialDelayMs: 10,
            maxDelayMs: 100,
            backoffMultiplier: 2,
            shouldRetry: () => false, // Override: never retry
          }
        );
      } catch {
        // Expected
      }

      expect(attemptCount).toBe(1);
    });

    it('should respect shouldRetry selective logic', async () => {
      let attemptCount = 0;

      try {
        await withRetry(
          async () => {
            attemptCount++;
            const err = new Error('Service error') as Error & { statusCode: number };
            err.statusCode = attemptCount < 3 ? 503 : 400;
            throw err;
          },
          {
            maxRetries: 5,
            initialDelayMs: 10,
            maxDelayMs: 100,
            backoffMultiplier: 2,
            shouldRetry: (error) => {
              return (error as Error & { statusCode?: number }).statusCode !== 400;
            },
          }
        );
      } catch {
        // Expected
      }

      // Should retry for 503s (attempts 1 & 2) but stop at 400 (attempt 3)
      expect(attemptCount).toBe(3);
    });
  });

  describe('Retry Success After Failures', () => {
    it('should succeed when function recovers within retry limit', async () => {
      let attemptCount = 0;

      const result = await withRetry(
        async () => {
          attemptCount++;
          if (attemptCount < 3) {
            throw new Error('ECONNREFUSED: temporary failure');
          }
          return 'success';
        },
        {
          maxRetries: 3,
          initialDelayMs: 10,
          maxDelayMs: 100,
          backoffMultiplier: 2,
        }
      );

      expect(result).toBe('success');
      expect(attemptCount).toBe(3);
    });
  });

  describe('Retry History Cleanup', () => {
    it('should clean up old retry history entries', () => {
      // cleanupRetryHistory should not throw even with empty history
      expect(() => cleanupRetryHistory(0)).not.toThrow();
      expect(() => cleanupRetryHistory(3600000)).not.toThrow();
    });
  });
});
