/**
 * Performance Benchmark: EventBus Throughput
 *
 * Measures publish latency with many subscribers and
 * sequential event throughput.
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
  getRequestContext: () => ({ requestId: 'bench-request-id' }),
  getRequestId: () => 'bench-request-id',
}));

// Mock OpenTelemetry to prevent import errors
vi.mock('@opentelemetry/api', () => ({
  trace: {
    getTracer: () => ({
      startSpan: () => ({
        setStatus: vi.fn(),
        end: vi.fn(),
        recordException: vi.fn(),
      }),
    }),
  },
  context: { active: () => ({}) },
  SpanKind: { PRODUCER: 0, CONSUMER: 1 },
  SpanStatusCode: { OK: 1, ERROR: 2 },
}));

import { EventBus } from '@kernel/event-bus';

// Mock safe handler to just call the handler directly
vi.mock('@kernel/safe-handler', () => ({
  runSafely: vi.fn().mockImplementation(
    async (_plugin: string, _event: string, handler: () => Promise<void>) => {
      await handler();
    }
  ),
}));

function createEvent(name: string) {
  return {
    name,
    version: 1,
    occurredAt: new Date().toISOString(),
    payload: { data: 'test' },
    meta: {
      correlationId: 'bench-corr-id',
      domainId: 'bench-domain',
      source: 'control-plane' as const,
    },
  };
}

describe('EventBus Throughput Benchmarks', () => {
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

  describe('Fan-Out Performance', () => {
    it('should publish to 50 subscribers in < 50ms', async () => {
      const SUBSCRIBERS = 50;
      const MAX_TOTAL_MS = 50;
      let handleCount = 0;

      for (let i = 0; i < SUBSCRIBERS; i++) {
        bus.subscribe('bench.fanout', `plugin-${i}`, async () => {
          handleCount++;
        });
      }

      const start = performance.now();

      await bus.publish(createEvent('bench.fanout'));

      const elapsed = performance.now() - start;

      expect(handleCount).toBe(SUBSCRIBERS);
      expect(elapsed).toBeLessThan(MAX_TOTAL_MS);
    });
  });

  describe('Sequential Event Throughput', () => {
    it('should publish 1000 events sequentially in < 2000ms', async () => {
      const EVENTS = 1000;
      const MAX_TOTAL_MS = 2000;
      let handleCount = 0;

      bus.subscribe('bench.sequential', 'counter-plugin', async () => {
        handleCount++;
      });

      const start = performance.now();

      for (let i = 0; i < EVENTS; i++) {
        await bus.publish(createEvent('bench.sequential'));
      }

      const elapsed = performance.now() - start;

      expect(handleCount).toBe(EVENTS);
      expect(elapsed).toBeLessThan(MAX_TOTAL_MS);
    });
  });

  describe('Subscription Management Performance', () => {
    it('should subscribe/unsubscribe 50 handlers in < 10ms', () => {
      const HANDLERS = 50;
      const MAX_TOTAL_MS = 10;

      const start = performance.now();

      for (let i = 0; i < HANDLERS; i++) {
        bus.subscribe('bench.sub', `plugin-${i}`, async () => {});
      }

      for (let i = 0; i < HANDLERS; i++) {
        bus.unsubscribe('bench.sub', `plugin-${i}`);
      }

      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(MAX_TOTAL_MS);

      const handlers = bus.getHandlers();
      const remaining = handlers.get('bench.sub') ?? [];
      expect(remaining.length).toBe(0);
    });
  });
});
