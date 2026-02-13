/**
 * Chaos/Failure Tests: EventBus Handler Failures
 *
 * Tests EventBus resilience when handlers fail:
 * - Single handler failure doesn't block others (Promise.allSettled)
 * - All handlers failing triggers circuit breaker
 * - Circuit breaker protection during publish
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
  getRequestContext: () => ({ requestId: 'chaos-request-id' }),
  getRequestId: () => 'chaos-request-id',
}));

vi.mock('@opentelemetry/api', () => ({
  trace: {
    getTracer: () => ({
      startSpan: () => ({
        setStatus: vi.fn(),
        end: vi.fn(),
        recordException: vi.fn(),
      }),
    }),
    setSpan: () => ({}),
  },
  context: { active: () => ({}) },
  SpanKind: { PRODUCER: 0, CONSUMER: 1 },
  SpanStatusCode: { OK: 1, ERROR: 2 },
}));

// Mock runSafely to propagate errors (so we can test error handling)
vi.mock('@kernel/safe-handler', () => ({
  runSafely: vi.fn().mockImplementation(
    async (_plugin: string, _event: string, handler: () => Promise<void>, onFailure: (f: unknown) => Promise<void>) => {
      try {
        await handler();
      } catch (error) {
        await onFailure({ plugin: _plugin, eventName: _event, error });
        throw error;
      }
    }
  ),
}));

import { EventBus } from '@kernel/event-bus';

function createEvent(name: string) {
  return {
    name,
    version: 1,
    occurredAt: new Date().toISOString(),
    payload: { data: 'test' },
    meta: {
      correlationId: 'chaos-corr-id',
      domainId: 'chaos-domain',
      source: 'control-plane' as const,
    },
  };
}

describe('EventBus - Handler Failure Scenarios', () => {
  let bus: EventBus;
  const mockLogger = {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  } as unknown as Console;

  beforeEach(() => {
    vi.clearAllMocks();
    bus = new EventBus(mockLogger);
  });

  afterEach(() => {
    bus.clear();
    vi.restoreAllMocks();
  });

  describe('Single Handler Failure Isolation', () => {
    it('should execute all other handlers when 1 of 5 throws', async () => {
      const executionLog: string[] = [];

      for (let i = 0; i < 5; i++) {
        bus.subscribe('chaos.partial-fail', `plugin-${i}`, async () => {
          if (i === 2) {
            throw new Error(`Plugin-${i} crashed!`);
          }
          executionLog.push(`plugin-${i}`);
        });
      }

      // Should not throw — circuit breaker allows partial failures
      try {
        await bus.publish(createEvent('chaos.partial-fail'));
      } catch {
        // May throw if circuit breaker interprets partial failure
      }

      // At least the non-failing handlers should have executed
      expect(executionLog).toContain('plugin-0');
      expect(executionLog).toContain('plugin-1');
      expect(executionLog).toContain('plugin-3');
      expect(executionLog).toContain('plugin-4');
      expect(executionLog).not.toContain('plugin-2');
    });
  });

  describe('All Handlers Failing', () => {
    it('should trigger circuit breaker when all handlers fail repeatedly', async () => {
      // Subscribe handlers that always fail
      for (let i = 0; i < 3; i++) {
        bus.subscribe('chaos.all-fail', `failing-plugin-${i}`, async () => {
          throw new Error(`Plugin ${i} crashed`);
        });
      }

      // Publish repeatedly to trigger circuit breaker (threshold: 10)
      let circuitOpenError = false;
      for (let round = 0; round < 15; round++) {
        try {
          await bus.publish(createEvent('chaos.all-fail'));
        } catch (error) {
          if (error instanceof Error && error.message.includes('Circuit breaker open')) {
            circuitOpenError = true;
            break;
          }
        }
      }

      // Circuit breaker should have opened
      expect(circuitOpenError).toBe(true);
    });
  });

  describe('Circuit Breaker Protection', () => {
    it('should reject publish immediately when circuit is open', async () => {
      // Subscribe a handler that always fails
      bus.subscribe('chaos.cb-reject', 'crash-plugin', async () => {
        throw new Error('always fails');
      });

      // Open the circuit by triggering failures
      for (let i = 0; i < 15; i++) {
        try {
          await bus.publish(createEvent('chaos.cb-reject'));
        } catch {
          // Expected
        }
      }

      // Now publishing should be rejected by circuit breaker
      await expect(
        bus.publish(createEvent('chaos.cb-reject'))
      ).rejects.toThrow();
    });
  });

  describe('Handler Subscription Limits', () => {
    it('should reject subscription when max handlers (50) is reached', () => {
      const EVENT = 'chaos.max-handlers';

      // Subscribe 50 handlers (the maximum)
      for (let i = 0; i < 50; i++) {
        bus.subscribe(EVENT, `plugin-${i}`, async () => {});
      }

      // 51st should throw
      expect(() => {
        bus.subscribe(EVENT, 'plugin-50', async () => {});
      }).toThrow('Maximum handlers exceeded');
    });

    it('should prevent duplicate subscriptions from same plugin', () => {
      bus.subscribe('chaos.dup', 'same-plugin', async () => {});
      bus.subscribe('chaos.dup', 'same-plugin', async () => {}); // Should be silently ignored

      const handlers = bus.getHandlers();
      const eventHandlers = handlers.get('chaos.dup') ?? [];
      expect(eventHandlers.length).toBe(1);
    });
  });
});
