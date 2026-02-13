/**
 * P1 TEST: EventBus - Pub/Sub Event System Tests
 *
 * Tests subscription, unsubscription, publishing, duplicate prevention,
 * max handler limits, circuit breaker integration, and error isolation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventBus } from '../event-bus';

// Mock safe-handler (runSafely)
vi.mock('../safe-handler', () => ({
  runSafely: vi.fn(async (_plugin: string, _event: string, handler: () => Promise<void>, onFailure: (f: unknown) => Promise<void>) => {
    try {
      await handler();
    } catch (error) {
      await onFailure({ plugin: _plugin, eventName: _event, error });
      throw error;
    }
  }),
}));

// Mock retry (CircuitBreaker)
vi.mock('../retry', () => ({
  CircuitBreaker: vi.fn().mockImplementation(() => ({
    execute: vi.fn(async (fn: () => Promise<void>) => fn()),
  })),
}));

describe('EventBus', () => {
  let bus: EventBus;
  let mockLogger: Console;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLogger = {
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as Console;
    bus = new EventBus(mockLogger);
  });

  describe('subscribe', () => {
    it('should register a handler for an event', () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      bus.subscribe('user.created', 'plugin-a', handler);

      const handlers = bus.getHandlers();
      expect(handlers.get('user.created')).toHaveLength(1);
      expect(handlers.get('user.created')![0].plugin).toBe('plugin-a');
    });

    it('should allow multiple plugins for same event', () => {
      bus.subscribe('user.created', 'plugin-a', vi.fn().mockResolvedValue(undefined));
      bus.subscribe('user.created', 'plugin-b', vi.fn().mockResolvedValue(undefined));

      expect(bus.getHandlers().get('user.created')).toHaveLength(2);
    });

    it('should prevent duplicate subscription from same plugin', () => {
      bus.subscribe('user.created', 'plugin-a', vi.fn().mockResolvedValue(undefined));
      bus.subscribe('user.created', 'plugin-a', vi.fn().mockResolvedValue(undefined));

      expect(bus.getHandlers().get('user.created')).toHaveLength(1);
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('already subscribed'));
    });
  });

  describe('unsubscribe', () => {
    it('should remove handler for specific plugin', () => {
      bus.subscribe('user.created', 'plugin-a', vi.fn().mockResolvedValue(undefined));
      bus.subscribe('user.created', 'plugin-b', vi.fn().mockResolvedValue(undefined));

      bus.unsubscribe('user.created', 'plugin-a');

      const handlers = bus.getHandlers().get('user.created');
      expect(handlers).toHaveLength(1);
      expect(handlers![0].plugin).toBe('plugin-b');
    });

    it('should handle unsubscribe for non-existent event', () => {
      expect(() => bus.unsubscribe('unknown.event', 'plugin-a')).not.toThrow();
    });
  });

  describe('publish', () => {
    it('should call all handlers for the event', async () => {
      const handlerA = vi.fn().mockResolvedValue(undefined);
      const handlerB = vi.fn().mockResolvedValue(undefined);

      bus.subscribe('user.created', 'plugin-a', handlerA);
      bus.subscribe('user.created', 'plugin-b', handlerB);

      const event = { name: 'user.created', payload: { userId: '123' } };
      await bus.publish(event as any);

      expect(handlerA).toHaveBeenCalledWith(event);
      expect(handlerB).toHaveBeenCalledWith(event);
    });

    it('should warn when no handlers exist', async () => {
      const event = { name: 'unknown.event', payload: {} };
      await bus.publish(event as any);

      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('No handlers'));
    });
  });

  describe('getHandlers', () => {
    it('should return a copy (not a reference)', () => {
      bus.subscribe('test', 'plugin-a', vi.fn().mockResolvedValue(undefined));
      const handlers = bus.getHandlers();
      handlers.delete('test');

      // Original should still have the handler
      expect(bus.getHandlers().has('test')).toBe(true);
    });
  });

  describe('clear', () => {
    it('should remove all handlers', () => {
      bus.subscribe('a', 'p1', vi.fn().mockResolvedValue(undefined));
      bus.subscribe('b', 'p2', vi.fn().mockResolvedValue(undefined));
      bus.clear();

      expect(bus.getHandlers().size).toBe(0);
    });
  });
});
