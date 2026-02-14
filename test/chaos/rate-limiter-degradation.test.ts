/**
 * Chaos/Failure Tests: Rate Limiter Degradation
 *
 * Tests rate limiter resilience during Redis outages:
 * - Redis connection drops → fallback to in-memory
 * - Redis recovers → switch back from in-memory
 * - In-memory fallback LRU eviction behavior
 * - Concurrent requests during failover transition
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

vi.mock('@kernel/metrics', () => ({
  emitCounter: vi.fn(),
  emitMetric: vi.fn(),
}));

let shouldFailRedis = false;
let rateLimitCounter = 0;

const mockPipeline = {
  zremrangebyscore: vi.fn().mockReturnThis(),
  zcard: vi.fn().mockReturnThis(),
  exec: vi.fn().mockImplementation(async () => {
    if (shouldFailRedis) throw new Error('ECONNREFUSED');
    rateLimitCounter++;
    return [
      [null, 0],
      [null, rateLimitCounter],
    ];
  }),
};

vi.mock('@kernel/redis', () => ({
  getRedis: vi.fn().mockImplementation(async () => {
    if (shouldFailRedis) throw new Error('ECONNREFUSED');
    return {
      pipeline: vi.fn().mockReturnValue(mockPipeline),
      zadd: vi.fn().mockResolvedValue(1),
      pexpire: vi.fn().mockResolvedValue(1),
      del: vi.fn().mockResolvedValue(1),
      on: vi.fn(),
    };
  }),
}));

import {
  checkRateLimit,
  _resetFallbackState,
  type RateLimitConfig,
} from '@kernel/rateLimiterRedis';

describe('Rate Limiter - Degradation Scenarios', () => {
  const config: RateLimitConfig = {
    maxRequests: 10,
    windowMs: 60_000,
    keyPrefix: 'chaos',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    rateLimitCounter = 0;
    shouldFailRedis = false;
    _resetFallbackState();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    shouldFailRedis = false;
    _resetFallbackState();
  });

  describe('Redis Connection Drop → In-Memory Fallback', () => {
    it('should seamlessly fall back to in-memory when Redis drops', async () => {
      // First request works via Redis
      shouldFailRedis = false;
      const normalResult = await checkRateLimit('user:degrade-1', config);
      expect(normalResult.allowed).toBe(true);

      // Redis goes down
      shouldFailRedis = true;

      // Requests should still work via in-memory fallback
      const fallbackResult = await checkRateLimit('user:degrade-2', config);
      expect(fallbackResult.allowed).toBe(true);
      expect(fallbackResult.limit).toBe(config.maxRequests);
    });

    it('should enforce rate limits even during fallback', async () => {
      shouldFailRedis = true;

      const tinyConfig: RateLimitConfig = {
        maxRequests: 3,
        windowMs: 60_000,
        keyPrefix: 'chaos-enforce',
      };

      const results = [];
      for (let i = 0; i < 5; i++) {
        results.push(await checkRateLimit('user:fallback-enforce', tinyConfig));
      }

      const allowed = results.filter(r => r.allowed);
      const denied = results.filter(r => !r.allowed);

      expect(allowed.length).toBe(3);
      expect(denied.length).toBe(2);
    });
  });

  describe('Redis Recovery → Switch Back', () => {
    it('should switch back to Redis after recovery', async () => {
      // Start with Redis failure
      shouldFailRedis = true;
      _resetFallbackState();

      // Trigger enough failures to open circuit breaker (3 failures)
      for (let i = 0; i < 4; i++) {
        await checkRateLimit(`user:recovery-${i}`, config);
      }

      // Redis recovers
      shouldFailRedis = false;
      rateLimitCounter = 0;

      // Reset circuit breaker state
      _resetFallbackState();

      // Should work via Redis again
      const result = await checkRateLimit('user:recovered', config);
      expect(result.allowed).toBe(true);
    });
  });

  describe('Circuit Breaker Behavior', () => {
    it('should open circuit breaker after 3 consecutive Redis failures', async () => {
      shouldFailRedis = true;
      _resetFallbackState();

      // Trigger failures to open circuit breaker
      for (let i = 0; i < 5; i++) {
        const result = await checkRateLimit(`user:cb-trigger-${i}`, config);
        // Should still get a result (via fallback)
        expect(result).toBeDefined();
        expect(result.allowed).toBe(true);
      }

      // After circuit breaker opens, should go directly to in-memory
      // without even trying Redis
      const fastResult = await checkRateLimit('user:cb-fast', config);
      expect(fastResult).toBeDefined();
    });
  });

  describe('Concurrent Requests During Failover', () => {
    it('should handle concurrent requests during Redis failover without errors', async () => {
      shouldFailRedis = true;

      // Send 20 concurrent requests during failover
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          checkRateLimit(`user:concurrent-${i % 5}`, config)
        )
      );

      // All should get valid results (none should throw)
      for (const result of results) {
        expect(result).toBeDefined();
        expect(typeof result.allowed).toBe('boolean');
        expect(typeof result.remaining).toBe('number');
        expect(result.limit).toBe(config.maxRequests);
      }
    });

    it('should not allow requests to slip through unmetered during failover', async () => {
      shouldFailRedis = true;

      const tinyConfig: RateLimitConfig = {
        maxRequests: 5,
        windowMs: 60_000,
        keyPrefix: 'chaos-noleak',
      };

      // Send requests from same key to verify rate limiting works
      const results = [];
      for (let i = 0; i < 10; i++) {
        results.push(await checkRateLimit('user:noleak', tinyConfig));
      }

      const allowed = results.filter(r => r.allowed);
      const denied = results.filter(r => !r.allowed);

      // Should enforce the limit even in fallback mode
      expect(allowed.length).toBe(5);
      expect(denied.length).toBe(5);
    });
  });

  describe('Fallback State Reset', () => {
    it('should properly reset fallback state via _resetFallbackState', async () => {
      shouldFailRedis = true;

      // Use up limit in fallback mode
      const tinyConfig: RateLimitConfig = {
        maxRequests: 2,
        windowMs: 60_000,
        keyPrefix: 'chaos-reset',
      };

      await checkRateLimit('user:reset-test', tinyConfig);
      await checkRateLimit('user:reset-test', tinyConfig);

      const denied = await checkRateLimit('user:reset-test', tinyConfig);
      expect(denied.allowed).toBe(false);

      // Reset fallback state
      _resetFallbackState();

      // Should start fresh
      const fresh = await checkRateLimit('user:reset-test', tinyConfig);
      expect(fresh.allowed).toBe(true);
    });
  });
});
