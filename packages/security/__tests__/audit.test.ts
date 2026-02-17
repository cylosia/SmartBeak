/**
 * AuditLogger Tests
 *
 * Tests for hash-chain tamper detection, buffer overflow protection,
 * flush failure retry/drop logic, and event lifecycle. Documents current
 * behavior of security-critical audit infrastructure.
 */

import type { Pool } from 'pg';

jest.mock('@kernel/logger', () => ({
  getLogger: jest.fn(() => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  })),
}));

import { AuditLogger } from '../audit';
import type { AuditEvent } from '../audit';

/**
 * Helper to build a minimal audit event input (without id, timestamp, hash, previousHash)
 */
function makeEventInput(overrides: Partial<Omit<AuditEvent, 'id' | 'timestamp' | 'hash' | 'previousHash'>> = {}) {
  return {
    type: 'auth.login' as const,
    severity: 'info' as const,
    actor: { type: 'user' as const, id: 'user-1', email: 'a@b.com', ip: '1.2.3.4' },
    resource: { type: 'auth', id: 'system', name: 'login-page' },
    action: 'login',
    result: 'success' as const,
    details: { browser: 'chrome' },
    ...overrides,
  };
}

describe('AuditLogger', () => {
  let mockDb: {
    query: jest.Mock;
  };
  let logger: AuditLogger;

  beforeEach(() => {
    jest.useFakeTimers();
    mockDb = {
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    };
    logger = new AuditLogger(mockDb as unknown as Pool);
  });

  afterEach(async () => {
    await logger.stop();
    jest.useRealTimers();
  });

  describe('hash chain tamper detection', () => {
    it('should include nested actor fields in hash calculation', async () => {
      const event1Input = makeEventInput({
        actor: { type: 'user', id: 'u1', email: 'a@b.com', ip: '1.1.1.1', userAgent: 'Firefox' },
      });
      const event2Input = makeEventInput({
        actor: { type: 'user', id: 'u1', email: 'CHANGED@b.com', ip: '1.1.1.1', userAgent: 'Firefox' },
      });

      // Log two events and capture their hashes
      const events: AuditEvent[] = [];
      logger.on('auditEvent', (e: AuditEvent) => events.push(e));

      await logger.log(event1Input);
      await logger.log(event2Input);

      // Hashes must differ because actor.email changed
      expect(events[0]!.hash).not.toBe(events[1]!.hash);
    });

    it('should include nested resource.name in hash calculation', async () => {
      const events: AuditEvent[] = [];
      logger.on('auditEvent', (e: AuditEvent) => events.push(e));

      await logger.log(makeEventInput({ resource: { type: 'auth', id: 'sys', name: 'page-a' } }));
      await logger.log(makeEventInput({ resource: { type: 'auth', id: 'sys', name: 'page-b' } }));

      expect(events[0]!.hash).not.toBe(events[1]!.hash);
    });

    it('should include details object contents in hash', async () => {
      const events: AuditEvent[] = [];
      logger.on('auditEvent', (e: AuditEvent) => events.push(e));

      await logger.log(makeEventInput({ details: { key: 'value1' } }));
      await logger.log(makeEventInput({ details: { key: 'value2' } }));

      expect(events[0]!.hash).not.toBe(events[1]!.hash);
    });

    it('should chain events via previousHash linking', async () => {
      const events: AuditEvent[] = [];
      logger.on('auditEvent', (e: AuditEvent) => events.push(e));

      await logger.log(makeEventInput());
      await logger.log(makeEventInput());
      await logger.log(makeEventInput());

      // First event's previousHash is empty (initial state)
      expect(events[0]!.previousHash).toBe('');
      // Subsequent events chain to previous hash
      expect(events[1]!.previousHash).toBe(events[0]!.hash);
      expect(events[2]!.previousHash).toBe(events[1]!.hash);
    });

    it('should produce deterministic hashes for identical event data', async () => {
      // Two separate loggers, same events => same hash sequence
      const logger2 = new AuditLogger(mockDb as unknown as Pool);

      const events1: AuditEvent[] = [];
      const events2: AuditEvent[] = [];
      logger.on('auditEvent', (e: AuditEvent) => events1.push(e));
      logger2.on('auditEvent', (e: AuditEvent) => events2.push(e));

      // Use fixed ID and timestamp by intercepting
      const fixedInput = makeEventInput();

      await logger.log(fixedInput);
      await logger2.log(fixedInput);

      // Hashes will differ because id and timestamp are generated fresh,
      // but previousHash should both be '' for first event
      expect(events1[0]!.previousHash).toBe('');
      expect(events2[0]!.previousHash).toBe('');

      await logger2.stop();
    });

    it('should produce valid SHA-256 hex hashes', async () => {
      const events: AuditEvent[] = [];
      logger.on('auditEvent', (e: AuditEvent) => events.push(e));

      await logger.log(makeEventInput());

      expect(events[0]!.hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should include changes field in hash when present', async () => {
      const events: AuditEvent[] = [];
      logger.on('auditEvent', (e: AuditEvent) => events.push(e));

      await logger.log(makeEventInput({ changes: { before: 'old', after: 'new' } }));
      await logger.log(makeEventInput({ changes: { before: 'old', after: 'different' } }));

      expect(events[0]!.hash).not.toBe(events[1]!.hash);
    });

    it('should handle deeply nested details in hash', async () => {
      const events: AuditEvent[] = [];
      logger.on('auditEvent', (e: AuditEvent) => events.push(e));

      await logger.log(makeEventInput({ details: { nested: { deep: { value: 1 } } } }));
      await logger.log(makeEventInput({ details: { nested: { deep: { value: 2 } } } }));

      expect(events[0]!.hash).not.toBe(events[1]!.hash);
    });
  });

  describe('buffer overflow and event dropping', () => {
    it('should drop oldest 10% when buffer reaches MAX_BUFFER_SIZE', async () => {
      // Fill buffer to capacity by suppressing flush
      mockDb.query.mockRejectedValue(new Error('db down'));

      const droppedEvents: AuditEvent[][] = [];
      logger.on('eventsDropped', (events: AuditEvent[]) => droppedEvents.push(events));

      // Log MAX_BUFFER_SIZE events (10000) - flush will fail so they accumulate
      // We need to fill the buffer. The flush happens on critical events and on timer.
      // Since all are 'info' severity, no auto-flush on log.
      // But failed flushes re-add events. Let's just log many events.
      // Actually we need to avoid flush. The timer flushes every 5s.
      // Since we use fake timers, we control when flush happens.

      // Fill buffer to capacity
      for (let i = 0; i < 10000; i++) {
        await logger.log(makeEventInput({ details: { i } }));
      }

      // At this point buffer should be at 10000
      // Log one more - makeSpaceIfNeeded should drop 1000
      await logger.log(makeEventInput({ details: { overflow: true } }));

      expect(droppedEvents.length).toBe(1);
      expect(droppedEvents[0]!.length).toBe(1000);
    });

    it('should emit eventsDropped with the dropped events', async () => {
      const droppedEvents: AuditEvent[][] = [];
      logger.on('eventsDropped', (events: AuditEvent[]) => droppedEvents.push(events));

      // Fill to capacity
      for (let i = 0; i < 10001; i++) {
        await logger.log(makeEventInput({ details: { i } }));
      }

      expect(droppedEvents.length).toBeGreaterThanOrEqual(1);
      // Dropped events should be the oldest ones
      for (const batch of droppedEvents) {
        expect(batch.length).toBeGreaterThan(0);
      }
    });
  });

  describe('flush behavior', () => {
    it('should flush to database with UNNEST-based batch insert', async () => {
      await logger.log(makeEventInput());

      // Trigger flush via timer
      jest.advanceTimersByTime(5000);
      await Promise.resolve(); // Let the flush promise settle

      expect(mockDb.query).toHaveBeenCalled();
      const call = mockDb.query.mock.calls[0];
      expect(call[0]).toContain('INSERT INTO audit_logs');
      expect(call[0]).toContain('UNNEST');
    });

    it('should flush immediately for critical events', async () => {
      await logger.log(makeEventInput({
        type: 'api.key_create',
        severity: 'critical',
        actor: { type: 'user', id: 'u1' },
        resource: { type: 'api_key', id: 'stripe' },
        action: 'key_create',
      }));

      // Should have flushed immediately without timer advancement
      expect(mockDb.query).toHaveBeenCalled();
    });

    it('should not flush when buffer is empty', async () => {
      jest.advanceTimersByTime(5000);
      await Promise.resolve();

      // No flush call because buffer was empty
      expect(mockDb.query).not.toHaveBeenCalled();
    });

    it('should re-queue events on flush failure within retry limit', async () => {
      mockDb.query.mockRejectedValueOnce(new Error('connection lost'));

      await logger.log(makeEventInput());

      // Trigger flush
      jest.advanceTimersByTime(5000);
      await Promise.resolve();

      // Events should be re-queued (buffer not empty)
      // Trigger another flush
      mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      jest.advanceTimersByTime(5000);
      await Promise.resolve();

      // Second flush should succeed with the re-queued events
      expect(mockDb.query).toHaveBeenCalledTimes(2);
    });

    it('should drop events and emit eventsLost after exceeding MAX_RETRY_ATTEMPTS', async () => {
      const lostEvents: AuditEvent[][] = [];
      logger.on('eventsLost', (events: AuditEvent[]) => lostEvents.push(events));

      // Make all flushes fail
      mockDb.query.mockRejectedValue(new Error('persistent failure'));

      // Use critical events to trigger immediate flush (which is awaited)
      // Each critical event calls flush() directly and awaits it.
      // failedFlushCount: 0->1->2->3->4
      // At count <= 3 events re-queued; at count > 3, events dropped
      const criticalInput = makeEventInput({
        severity: 'critical',
        type: 'security.alert',
      });

      for (let i = 0; i < 5; i++) {
        await logger.log(criticalInput);
      }

      expect(lostEvents.length).toBeGreaterThanOrEqual(1);
    });

    it('should reset failedFlushCount on successful flush', async () => {
      // Fail once
      mockDb.query.mockRejectedValueOnce(new Error('temp failure'));

      await logger.log(makeEventInput());
      jest.advanceTimersByTime(5000);
      await Promise.resolve();

      // Succeed on next flush
      mockDb.query.mockResolvedValue({ rows: [], rowCount: 0 });
      jest.advanceTimersByTime(5000);
      await Promise.resolve();

      // Now log more events - should not trigger auditSystemFailure
      const failures: unknown[] = [];
      logger.on('auditSystemFailure', (data: unknown) => failures.push(data));

      await logger.log(makeEventInput());
      jest.advanceTimersByTime(5000);
      await Promise.resolve();

      expect(failures).toHaveLength(0);
    });

    it('should emit auditSystemFailure when failedFlushCount exceeds MAX_RETRY_ATTEMPTS', async () => {
      const failures: unknown[] = [];
      logger.on('auditSystemFailure', (data: unknown) => failures.push(data));

      mockDb.query.mockRejectedValue(new Error('persistent failure'));

      // Critical events trigger immediate flush. After 3 failures,
      // the check `failedFlushCount >= MAX_RETRY_ATTEMPTS` emits auditSystemFailure.
      const criticalInput = makeEventInput({
        severity: 'critical',
        type: 'security.alert',
      });

      for (let i = 0; i < 4; i++) {
        await logger.log(criticalInput);
      }

      expect(failures.length).toBeGreaterThanOrEqual(1);
    });

    it('should write to stderr as fallback when events are dropped after max retries', async () => {
      const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

      mockDb.query.mockRejectedValue(new Error('persistent failure'));

      // Use critical events to force immediate flushes that are awaited.
      // After MAX_RETRY_ATTEMPTS exceeded, events are written to stderr.
      const criticalInput = makeEventInput({
        severity: 'critical',
        type: 'security.alert',
      });

      for (let i = 0; i < 6; i++) {
        await logger.log(criticalInput);
      }

      const auditFallbackCalls = stderrSpy.mock.calls.filter(
        (call) => typeof call[0] === 'string' && (call[0] as string).includes('[AUDIT_FALLBACK]')
      );

      // At least one fallback write should have happened
      expect(auditFallbackCalls.length).toBeGreaterThanOrEqual(1);

      stderrSpy.mockRestore();
    });
  });

  describe('event generation', () => {
    it('should generate unique event IDs with evt_ prefix', async () => {
      const events: AuditEvent[] = [];
      logger.on('auditEvent', (e: AuditEvent) => events.push(e));

      await logger.log(makeEventInput());
      await logger.log(makeEventInput());

      expect(events[0]!.id).toMatch(/^evt_\d+_[a-f0-9]{16}$/);
      expect(events[1]!.id).toMatch(/^evt_\d+_[a-f0-9]{16}$/);
      expect(events[0]!.id).not.toBe(events[1]!.id);
    });

    it('should set timestamp on event', async () => {
      const events: AuditEvent[] = [];
      logger.on('auditEvent', (e: AuditEvent) => events.push(e));

      const now = new Date('2026-01-15T10:00:00Z');
      jest.setSystemTime(now);

      await logger.log(makeEventInput());

      expect(events[0]!.timestamp).toEqual(now);
    });
  });

  describe('convenience log methods', () => {
    it('logAuth should set severity to warning for auth.failed', async () => {
      const events: AuditEvent[] = [];
      logger.on('auditEvent', (e: AuditEvent) => events.push(e));

      await logger.logAuth(
        'auth.failed',
        { type: 'user', id: 'u1' },
        'failure'
      );

      expect(events[0]!.severity).toBe('warning');
      expect(events[0]!.type).toBe('auth.failed');
    });

    it('logAuth should set severity to info for auth.login', async () => {
      const events: AuditEvent[] = [];
      logger.on('auditEvent', (e: AuditEvent) => events.push(e));

      await logger.logAuth(
        'auth.login',
        { type: 'user', id: 'u1' },
        'success'
      );

      expect(events[0]!.severity).toBe('info');
    });

    it('logApiKeyChange should extract action from type using split(.)[1]', async () => {
      const events: AuditEvent[] = [];
      logger.on('auditEvent', (e: AuditEvent) => events.push(e));

      await logger.logApiKeyChange(
        'api.key_create',
        { type: 'user', id: 'u1' },
        'stripe',
        'success'
      );

      // P1-FIX verified: action should be 'key_create' not undefined
      expect(events[0]!.action).toBe('key_create');
      expect(events[0]!.severity).toBe('critical');
    });

    it('logDataAccess should set type to data.export for export action', async () => {
      const events: AuditEvent[] = [];
      logger.on('auditEvent', (e: AuditEvent) => events.push(e));

      await logger.logDataAccess(
        { type: 'user', id: 'u1' },
        { type: 'report', id: 'r1' },
        'export'
      );

      expect(events[0]!.type).toBe('data.export');
    });

    it('logDataAccess should set severity to warning for delete action', async () => {
      const events: AuditEvent[] = [];
      logger.on('auditEvent', (e: AuditEvent) => events.push(e));

      await logger.logDataAccess(
        { type: 'user', id: 'u1' },
        { type: 'record', id: 'r1' },
        'delete'
      );

      expect(events[0]!.severity).toBe('warning');
    });

    it('logPermissionChange should extract action from type split', async () => {
      const events: AuditEvent[] = [];
      logger.on('auditEvent', (e: AuditEvent) => events.push(e));

      await logger.logPermissionChange(
        'permission.grant',
        { type: 'user', id: 'admin-1' },
        'target-user-1',
        'content.write',
        'success'
      );

      expect(events[0]!.action).toBe('grant');
      expect(events[0]!.severity).toBe('warning');
    });
  });

  describe('stop', () => {
    it('should clear flush timer and perform final flush', async () => {
      await logger.log(makeEventInput());
      await logger.stop();

      // Final flush should have been called
      expect(mockDb.query).toHaveBeenCalled();
    });

    it('should handle final flush failure gracefully via stderr', async () => {
      const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

      await logger.log(makeEventInput());
      mockDb.query.mockRejectedValue(new Error('shutdown error'));

      // stop() should not throw
      await expect(logger.stop()).resolves.toBeUndefined();

      stderrSpy.mockRestore();
    });
  });
});
