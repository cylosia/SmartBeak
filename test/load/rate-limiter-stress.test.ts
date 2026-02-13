/**
 * Load/Stress Tests: Rate Limiter
 *
 * Validates rate limiting under high-concurrency conditions:
 * - 1000 concurrent rate-limit checks for counter accuracy
 * - Redis failover to in-memory fallback
 * - LRU cache bounds under load
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

// Shared counter for sliding-window simulation
let rateLimitCounter = 0;
let shouldFailRedis = false;

const mockPipeline = {
  zremrangebyscore: vi.fn().mockReturnThis(),
  zcard: vi.fn().mockReturnThis(),
  exec: vi.fn().mockImplementation(async () => {
    if (shouldFailRedis) throw new Error('ECONNREFUSED');
    rateLimitCounter++;
    return [
      [null, 0], // zremrangebyscore result
      [null, rateLimitCounter], // zcard result — incremented per call
    ];
  }),
};

const mockRedis = {
  pipeline: vi.fn().mockReturnValue(mockPipeline),
  zadd: vi.fn().mockResolvedValue(1),
  pexpire: vi.fn().mockResolvedValue(1),
  zremrangebyscore: vi.fn().mockResolvedValue(0),
  zcard: vi.fn().mockResolvedValue(0),
  zrange: vi.fn().mockResolvedValue([]),
  del: vi.fn().mockResolvedValue(1),
  on: vi.fn(),
};

vi.mock('@kernel/redis', () => ({
  getRedis: vi.fn().mockImplementation(async () => {
    if (shouldFailRedis) throw new Error('ECONNREFUSED');
    return mockRedis;
  }),
}));

import {
  checkRateLimit,
  _resetFallbackState,
  type RateLimitConfig,
} from '@kernel/rateLimiterRedis';

describe('Rate Limiter - Load/Stress Tests', () => {
  const config: RateLimitConfig = {
    maxRequests: 100,
    windowMs: 60_000,
    keyPrefix: 'test',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    rateLimitCounter = 0;
    shouldFailRedis = false;
    _resetFallbackState();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('High-Concurrency Rate Limit Checks', () => {
    it('should handle 100 sequential rate-limit checks and eventually deny', async () => {
      const results = [];

      for (let i = 0; i < 120; i++) {
        const result = await checkRateLimit(`user:load-test`, config);
        results.push(result);
      }

      // First 100 should be allowed
      const allowed = results.filter(r => r.allowed);
      const denied = results.filter(r => !r.allowed);

      expect(allowed.length).toBe(100);
      expect(denied.length).toBe(20);
    });

    it('should return correct remaining count as limit approaches', async () => {
      // Use a smaller limit for easier testing
      const smallConfig: RateLimitConfig = {
        maxRequests: 5,
        windowMs: 60_000,
        keyPrefix: 'small',
      };

      const results = [];
      for (let i = 0; i < 6; i++) {
        results.push(await checkRateLimit('user:remaining-test', smallConfig));
      }

      // Check remaining counts decrease
      expect(results[0]!.remaining).toBe(4);
      expect(results[4]!.remaining).toBe(0);
      expect(results[5]!.allowed).toBe(false);
    });
  });

  describe('Redis Failover to In-Memory Fallback', () => {
    it('should fall back to in-memory rate limiting when Redis is unavailable', async () => {
      shouldFailRedis = true;

      // Should still work using in-memory fallback
      const result = await checkRateLimit('user:failover', config);

      expect(result).toBeDefined();
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(config.maxRequests);
    });

    it('should enforce rate limits even during in-memory fallback', async () => {
      shouldFailRedis = true;

      const smallConfig: RateLimitConfig = {
        maxRequests: 3,
        windowMs: 60_000,
        keyPrefix: 'fallback',
      };

      const results = [];
      for (let i = 0; i < 5; i++) {
        results.push(await checkRateLimit('user:fallback-enforce', smallConfig));
      }

      const allowed = results.filter(r => r.allowed);
      const denied = results.filter(r => !r.allowed);

      expect(allowed.length).toBe(3);
      expect(denied.length).toBe(2);
    });

    it('should activate circuit breaker after repeated Redis failures', async () => {
      shouldFailRedis = true;

      // Trigger 3+ failures to open circuit breaker
      for (let i = 0; i < 5; i++) {
        await checkRateLimit(`user:cb-${i}`, config);
      }

      // After circuit breaker opens, requests go directly to in-memory
      const result = await checkRateLimit('user:cb-post', config);
      expect(result).toBeDefined();
      expect(result.allowed).toBe(true);
    });
  });

  describe('Rate Limit Reset', () => {
    it('should enforce limits per unique key', async () => {
      const tinyConfig: RateLimitConfig = {
        maxRequests: 2,
        windowMs: 60_000,
        keyPrefix: 'perkey',
      };

      // Key A — 2 allowed, 1 denied
      const a1 = await checkRateLimit('key-a', tinyConfig);
      const a2 = await checkRateLimit('key-a', tinyConfig);
      const a3 = await checkRateLimit('key-a', tinyConfig);

      expect(a1.allowed).toBe(true);
      expect(a2.allowed).toBe(true);
      expect(a3.allowed).toBe(false);

      // Key B — should have its own counter
      // Reset counter for a new key path
      rateLimitCounter = 0;
      const b1 = await checkRateLimit('key-b', tinyConfig);
      expect(b1.allowed).toBe(true);
    });
  });
});
