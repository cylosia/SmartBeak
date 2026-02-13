/**
 * P1 TEST: Safe Handler - Error-Resilient Execution Tests
 *
 * Tests input validation, timeout handling, retry logic,
 * error categorization, and failure callback execution.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runSafely } from '../safe-handler';

// Mock logger
vi.mock('@kernel/logger', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    log: vi.fn(),
  }),
}));

// Mock request context
vi.mock('../request-context', () => ({
  getRequestContext: () => ({
    requestId: 'test-req-id',
    userId: 'user-1',
    orgId: 'org-1',
  }),
}));

describe('runSafely', () => {
  const validPlugin = 'test-plugin';
  const validEvent = 'user.created';
  const onFailure = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================================
  // Input Validation
  // ============================================================================

  describe('input validation', () => {
    it('should throw for empty plugin name', async () => {
      await expect(
        runSafely('', validEvent, vi.fn().mockResolvedValue(undefined), onFailure),
      ).rejects.toThrow('Invalid plugin');
    });

    it('should throw for non-string plugin', async () => {
      await expect(
        runSafely(123 as unknown as string, validEvent, vi.fn().mockResolvedValue(undefined), onFailure),
      ).rejects.toThrow('Invalid plugin');
    });

    it('should throw for plugin exceeding max length', async () => {
      await expect(
        runSafely('x'.repeat(101), validEvent, vi.fn().mockResolvedValue(undefined), onFailure),
      ).rejects.toThrow('exceeds maximum length');
    });

    it('should throw for empty event name', async () => {
      await expect(
        runSafely(validPlugin, '', vi.fn().mockResolvedValue(undefined), onFailure),
      ).rejects.toThrow('Invalid eventName');
    });

    it('should throw for non-function handler', async () => {
      await expect(
        runSafely(validPlugin, validEvent, 'not-a-fn' as unknown as () => Promise<void>, onFailure),
      ).rejects.toThrow('Invalid handler');
    });

    it('should throw for non-function onFailure', async () => {
      await expect(
        runSafely(validPlugin, validEvent, vi.fn().mockResolvedValue(undefined), 'not-a-fn' as unknown as (f: { plugin: string; eventName: string; error: unknown }) => Promise<void>),
      ).rejects.toThrow('Invalid onFailure');
    });
  });

  // ============================================================================
  // Successful Execution
  // ============================================================================

  describe('successful execution', () => {
    it('should execute handler successfully', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      await runSafely(validPlugin, validEvent, handler, onFailure);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(onFailure).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Retry Logic
  // ============================================================================

  describe('retry logic', () => {
    it('should retry on retryable errors (network)', async () => {
      const handler = vi.fn()
        .mockRejectedValueOnce(new Error('connection refused'))
        .mockResolvedValue(undefined);

      await runSafely(validPlugin, validEvent, handler, onFailure);
      expect(handler.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(onFailure).not.toHaveBeenCalled();
    }, 15000);

    it('should NOT retry validation errors', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('validation failed'));

      await runSafely(validPlugin, validEvent, handler, onFailure);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(onFailure).toHaveBeenCalledTimes(1);
    });

    it('should call onFailure after all retries exhausted', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('connection timeout'));

      await runSafely(validPlugin, validEvent, handler, onFailure);
      expect(onFailure).toHaveBeenCalledTimes(1);
      expect(onFailure).toHaveBeenCalledWith(
        expect.objectContaining({
          plugin: validPlugin,
          eventName: validEvent,
        }),
      );
    }, 30000);
  });

  // ============================================================================
  // Failure Handler
  // ============================================================================

  describe('failure handler', () => {
    it('should throw if onFailure itself throws', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('validation error'));
      const failingOnFailure = vi.fn().mockRejectedValue(new Error('onFailure broke'));

      await expect(
        runSafely(validPlugin, validEvent, handler, failingOnFailure),
      ).rejects.toThrow('onFailure broke');
    });
  });
});
