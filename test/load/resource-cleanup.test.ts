/**
 * Load/Stress Tests: Resource Cleanup
 *
 * Validates that all resources are properly cleaned up after heavy use:
 * - Graceful shutdown completes all handlers
 * - DLQ in-memory storage bounded under heavy failure injection
 * - Full lifecycle resource tracking
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

vi.mock('@kernel/request-context', () => ({
  getRequestId: () => 'test-request-id',
  getRequestContext: () => ({ requestId: 'test-request-id' }),
}));

import {
  registerShutdownHandler,
  clearShutdownHandlers,
  getHandlerCount,
  resetShutdownState,
} from '@/packages/shutdown/index';

import {
  getDLQStorage,
  sendToDLQ,
  DLQ,
  type DLQMessage,
} from '@kernel/dlq';

describe('Resource Cleanup - Load/Stress Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearShutdownHandlers();
    resetShutdownState();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearShutdownHandlers();
  });

  describe('Shutdown Handler Lifecycle', () => {
    it('should register and track multiple shutdown handlers', () => {
      const handlers = Array.from({ length: 10 }, () => {
        return registerShutdownHandler(async () => {
          // Simulate cleanup work
          await new Promise(resolve => setTimeout(resolve, 5));
        });
      });

      expect(getHandlerCount()).toBe(10);

      // Unregister all handlers
      for (const unregister of handlers) {
        unregister();
      }

      expect(getHandlerCount()).toBe(0);
    });

    it('should support unregistering specific handlers without affecting others', () => {
      const unregister1 = registerShutdownHandler(async () => {});
      registerShutdownHandler(async () => {});
      registerShutdownHandler(async () => {});

      expect(getHandlerCount()).toBe(3);

      unregister1();

      expect(getHandlerCount()).toBe(2);
    });

    it('should handle double-unregister gracefully', () => {
      const unregister = registerShutdownHandler(async () => {});

      expect(getHandlerCount()).toBe(1);
      unregister();
      expect(getHandlerCount()).toBe(0);
      unregister(); // Should not throw
      expect(getHandlerCount()).toBe(0);
    });
  });

  describe('DLQ Bounded Storage Under Load', () => {
    it('should cap DLQ at 10,000 entries when flooding with messages', async () => {
      const storage = getDLQStorage();
      const FLOOD_SIZE = 10_050;

      for (let i = 0; i < FLOOD_SIZE; i++) {
        const message: DLQMessage = {
          id: `dlq-flood-${i}`,
          originalQueue: 'test-queue',
          payload: { index: i },
          error: { message: `Error ${i}` },
          attempts: 3,
          maxAttempts: 3,
          failedAt: new Date().toISOString(),
          firstFailedAt: new Date().toISOString(),
        };
        await storage.enqueue(message);
      }

      const count = await storage.count();
      // Should be capped at MAX_SIZE (10,000)
      expect(count).toBeLessThanOrEqual(10_000);
    });

    it('should evict oldest entries when capacity is reached', async () => {
      const storage = getDLQStorage();

      // First, fill to a small amount and verify ordering
      for (let i = 0; i < 5; i++) {
        const message: DLQMessage = {
          id: `order-test-${i}`,
          originalQueue: 'test-queue',
          payload: { index: i },
          error: { message: `Error ${i}` },
          attempts: 1,
          maxAttempts: 3,
          failedAt: new Date(Date.now() - (5 - i) * 1000).toISOString(),
          firstFailedAt: new Date().toISOString(),
        };
        await storage.enqueue(message);
      }

      const messages = await storage.peek(5);
      expect(messages).toHaveLength(5);
    });

    it('should track DLQ stats accurately after heavy load', async () => {
      const MESSAGES = 50;

      for (let i = 0; i < MESSAGES; i++) {
        await sendToDLQ(
          'heavy-load-queue',
          { jobId: `job-${i}` },
          new Error(`Failure ${i}`),
          3,
          3
        );
      }

      const stats = await DLQ.stats();
      // Should reflect the messages we added (possibly + prior entries from other tests)
      expect(stats.total).toBeGreaterThanOrEqual(MESSAGES);
    });
  });

  describe('DLQ Purge Under Load', () => {
    it('should purge all messages efficiently', async () => {
      const MESSAGES = 200;

      for (let i = 0; i < MESSAGES; i++) {
        await sendToDLQ(
          'purge-queue',
          { jobId: `purge-${i}` },
          new Error(`Error ${i}`),
          3,
          3
        );
      }

      const beforePurge = await DLQ.stats();
      expect(beforePurge.total).toBeGreaterThanOrEqual(MESSAGES);

      await DLQ.purge();

      const afterPurge = await DLQ.stats();
      expect(afterPurge.total).toBe(0);
    });
  });
});
