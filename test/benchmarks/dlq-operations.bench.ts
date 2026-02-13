/**
 * Performance Benchmark: DLQ Operations
 *
 * Measures InMemoryDLQ add, list, and cleanup performance
 * to prevent regression in dead letter queue handling.
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
  getRequestId: () => 'bench-request-id',
  getRequestContext: () => ({ requestId: 'bench-request-id' }),
}));

import { getDLQStorage, DLQ, type DLQMessage } from '@kernel/dlq';

function createDLQMessage(id: string, index: number): DLQMessage {
  return {
    id,
    originalQueue: 'bench-queue',
    payload: { index },
    error: { message: `Error ${index}` },
    attempts: 3,
    maxAttempts: 3,
    failedAt: new Date().toISOString(),
    firstFailedAt: new Date().toISOString(),
  };
}

describe('DLQ Operations Benchmarks', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Purge existing messages
    await DLQ.purge();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await DLQ.purge();
  });

  describe('DLQ Add Performance', () => {
    it('should add 5000 messages in < 500ms', async () => {
      const MESSAGES = 5000;
      const MAX_TOTAL_MS = 500;
      const storage = getDLQStorage();

      const start = performance.now();

      for (let i = 0; i < MESSAGES; i++) {
        await storage.enqueue(createDLQMessage(`bench-add-${i}`, i));
      }

      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(MAX_TOTAL_MS);

      const count = await storage.count();
      expect(count).toBe(MESSAGES);
    });

    it('should maintain < 0.2ms avg per enqueue operation', async () => {
      const MESSAGES = 1000;
      const MAX_AVG_MS = 0.2;
      const storage = getDLQStorage();

      const start = performance.now();

      for (let i = 0; i < MESSAGES; i++) {
        await storage.enqueue(createDLQMessage(`bench-avg-${i}`, i));
      }

      const elapsed = performance.now() - start;
      const avgMs = elapsed / MESSAGES;

      expect(avgMs).toBeLessThan(MAX_AVG_MS);
    });
  });

  describe('DLQ List Performance', () => {
    it('should list 100 messages from a 5000-entry DLQ in < 50ms', async () => {
      const TOTAL = 5000;
      const PAGE_SIZE = 100;
      const MAX_TOTAL_MS = 50;
      const storage = getDLQStorage();

      // Populate
      for (let i = 0; i < TOTAL; i++) {
        await storage.enqueue(createDLQMessage(`bench-list-${i}`, i));
      }

      const start = performance.now();

      const page = await storage.peek(PAGE_SIZE);

      const elapsed = performance.now() - start;

      expect(page).toHaveLength(PAGE_SIZE);
      expect(elapsed).toBeLessThan(MAX_TOTAL_MS);
    });

    it('should handle peek with small limit efficiently', async () => {
      const storage = getDLQStorage();

      // Populate with 1000 messages
      for (let i = 0; i < 1000; i++) {
        await storage.enqueue(createDLQMessage(`bench-peek-${i}`, i));
      }

      const start = performance.now();

      const page = await storage.peek(10);

      const elapsed = performance.now() - start;

      expect(page).toHaveLength(10);
      expect(elapsed).toBeLessThan(20);
    });
  });

  describe('DLQ Purge Performance', () => {
    it('should purge 5000 entries in < 500ms', async () => {
      const TOTAL = 5000;
      const MAX_TOTAL_MS = 500;

      // Populate
      const storage = getDLQStorage();
      for (let i = 0; i < TOTAL; i++) {
        await storage.enqueue(createDLQMessage(`bench-purge-${i}`, i));
      }

      const beforeCount = await storage.count();
      expect(beforeCount).toBe(TOTAL);

      const start = performance.now();

      await DLQ.purge();

      const elapsed = performance.now() - start;

      const afterCount = await storage.count();
      expect(afterCount).toBe(0);
      expect(elapsed).toBeLessThan(MAX_TOTAL_MS);
    });
  });

  describe('DLQ Stats Performance', () => {
    it('should return stats in < 1ms even with many entries', async () => {
      const storage = getDLQStorage();
      const TOTAL = 2000;

      for (let i = 0; i < TOTAL; i++) {
        await storage.enqueue(createDLQMessage(`bench-stats-${i}`, i));
      }

      const start = performance.now();

      const stats = await DLQ.stats();

      const elapsed = performance.now() - start;

      expect(stats.total).toBe(TOTAL);
      expect(elapsed).toBeLessThan(1);
    });
  });
});
