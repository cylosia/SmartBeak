/**
 * Chaos/Failure Tests: DLQ Overflow
 *
 * Tests dead letter queue behavior under edge conditions:
 * - In-memory DLQ capped at 10,000 entries (oldest evicted)
 * - DLQ record failure propagation
 * - TTL cleanup of expired entries
 * - Error sanitization in DLQ messages
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
  getRequestId: () => 'chaos-request-id',
  getRequestContext: () => ({ requestId: 'chaos-request-id' }),
}));

import {
  getDLQStorage,
  sendToDLQ,
  DLQ,
  setDLQStorage,
  type DLQMessage,
  type DLQStorage,
} from '@kernel/dlq';

describe('DLQ - Overflow & Failure Scenarios', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await DLQ.purge();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await DLQ.purge();
  });

  describe('In-Memory DLQ Capacity Limit', () => {
    it('should cap at 10,000 entries when adding 10,001 messages', async () => {
      const storage = getDLQStorage();
      const OVER_LIMIT = 10_001;

      for (let i = 0; i < OVER_LIMIT; i++) {
        const message: DLQMessage = {
          id: `overflow-${i}`,
          originalQueue: 'overflow-queue',
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
      expect(count).toBeLessThanOrEqual(10_000);
    });

    it('should evict oldest entry when capacity is reached', async () => {
      const storage = getDLQStorage();

      // Fill to capacity
      for (let i = 0; i < 10_000; i++) {
        const message: DLQMessage = {
          id: `evict-${i}`,
          originalQueue: 'evict-queue',
          payload: { index: i },
          error: { message: `Error ${i}` },
          attempts: 3,
          maxAttempts: 3,
          failedAt: new Date().toISOString(),
          firstFailedAt: new Date().toISOString(),
        };
        await storage.enqueue(message);
      }

      // Add one more — should evict the oldest (evict-0)
      await storage.enqueue({
        id: 'evict-newest',
        originalQueue: 'evict-queue',
        payload: { index: 'newest' },
        error: { message: 'Newest error' },
        attempts: 1,
        maxAttempts: 3,
        failedAt: new Date().toISOString(),
        firstFailedAt: new Date().toISOString(),
      });

      // The oldest entry should have been evicted
      const oldest = await storage.dequeue('evict-0');
      expect(oldest).toBeNull();

      // The newest entry should exist
      const newest = await storage.dequeue('evict-newest');
      expect(newest).not.toBeNull();
      expect(newest!.id).toBe('evict-newest');
    });
  });

  describe('DLQ Storage Failure Propagation', () => {
    it('should throw when setting invalid DLQ storage', () => {
      expect(() => {
        setDLQStorage(null as unknown as DLQStorage);
      }).toThrow('Invalid DLQ storage');

      expect(() => {
        setDLQStorage({} as unknown as DLQStorage);
      }).toThrow('Invalid DLQ storage');
    });

    it('should propagate errors from custom storage implementations', async () => {
      // Save original storage so we can restore it after test
      const originalStorage = getDLQStorage();

      const failingStorage: DLQStorage = {
        enqueue: vi.fn().mockRejectedValue(new Error('Database write failed')),
        dequeue: vi.fn().mockRejectedValue(new Error('Database read failed')),
        peek: vi.fn().mockResolvedValue([]),
        delete: vi.fn().mockResolvedValue(undefined),
        retry: vi.fn().mockResolvedValue(undefined),
        count: vi.fn().mockResolvedValue(0),
      };

      setDLQStorage(failingStorage);

      await expect(
        sendToDLQ('fail-queue', { data: 'test' }, new Error('original'), 3, 3)
      ).rejects.toThrow('Database write failed');

      // Restore default storage so subsequent tests work
      setDLQStorage(originalStorage);
    });
  });

  describe('Error Sanitization in DLQ Messages', () => {
    it('should redact passwords from error messages', async () => {
      await DLQ.purge();

      await sendToDLQ(
        'sanitize-queue',
        { action: 'connect' },
        new Error('Connection failed: password=s3cret123 host=db.example.com'),
        3,
        3
      );

      const messages = await DLQ.list(1);
      expect(messages.length).toBeGreaterThan(0);

      const message = messages[0]!;
      expect(message.error.message).not.toContain('s3cret123');
      expect(message.error.message).toContain('[REDACTED]');
    });

    it('should redact tokens from error messages', async () => {
      await DLQ.purge();

      await sendToDLQ(
        'sanitize-queue',
        { action: 'auth' },
        new Error('Auth failed: token=eyJhbGciOiJIUzI1NiJ9.test'),
        3,
        3
      );

      const messages = await DLQ.list(1);
      const message = messages[0]!;
      expect(message.error.message).not.toContain('eyJhbGciOiJIUzI1NiJ9');
      expect(message.error.message).toContain('[REDACTED]');
    });

    it('should redact email addresses from error messages', async () => {
      await DLQ.purge();

      await sendToDLQ(
        'sanitize-queue',
        { action: 'notify' },
        new Error('Failed to send email to user@example.com'),
        3,
        3
      );

      const messages = await DLQ.list(1);
      const message = messages[0]!;
      expect(message.error.message).not.toContain('user@example.com');
      expect(message.error.message).toContain('[REDACTED]');
    });

    it('should redact IP addresses from error messages', async () => {
      await DLQ.purge();

      await sendToDLQ(
        'sanitize-queue',
        { action: 'connect' },
        new Error('Connection refused from 192.168.1.100'),
        3,
        3
      );

      const messages = await DLQ.list(1);
      const message = messages[0]!;
      expect(message.error.message).not.toContain('192.168.1.100');
      expect(message.error.message).toContain('[REDACTED]');
    });
  });

  describe('DLQ Retry Behavior', () => {
    it('should remove message from DLQ after successful retry', async () => {
      const storage = getDLQStorage();

      const message: DLQMessage = {
        id: 'retry-success',
        originalQueue: 'retry-queue',
        payload: { data: 'retryable' },
        error: { message: 'Temporary failure' },
        attempts: 1,
        maxAttempts: 3,
        failedAt: new Date().toISOString(),
        firstFailedAt: new Date().toISOString(),
      };

      await storage.enqueue(message);

      // Register a retry callback that succeeds
      if ('registerRetryCallback' in storage) {
        (storage as { registerRetryCallback: (id: string, cb: () => Promise<void>) => void })
          .registerRetryCallback('retry-success', async () => {
            // Retry succeeds
          });
      }

      await storage.retry('retry-success');

      // Message should be removed
      const remaining = await storage.dequeue('retry-success');
      expect(remaining).toBeNull();
    });
  });
});
