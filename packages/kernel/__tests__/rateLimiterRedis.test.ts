/**
 * Rate Limiting Tests
 *
 * Tests distributed rate limiting, burst allowance, rate limit headers,
 * and in-memory fallback behavior during Redis outages (CRIT-7).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  checkRateLimit,
  checkBurstRateLimit,
  getRateLimitStatus,
  resetRateLimit,
  rateLimitMiddleware,
  createRateLimiter,
  _resetFallbackState,
} from '../rateLimiterRedis';

// Break circular dependency: logger <-> request-context
vi.mock('../request-context', () => ({
  getRequestContext: vi.fn(() => undefined),
}));

vi.mock('../logger', () => ({
  getLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  })),
}));

vi.mock('../redis', () => ({
  getRedis: vi.fn(),
}));

vi.mock('../metrics', () => ({
  emitCounter: vi.fn(),
  emitMetric: vi.fn(),
}));

import { getRedis } from '../redis';
import { emitCounter } from '../metrics';

describe('Rate Limiting Tests', () => {
  let mockRedis: any;
  let mockPipeline: any;

  beforeEach(() => {
    vi.clearAllMocks();
    _resetFallbackState();

    mockPipeline = {
      zremrangebyscore: vi.fn().mockReturnThis(),
      zcard: vi.fn().mockReturnThis(),
      zadd: vi.fn().mockReturnThis(),
      pexpire: vi.fn().mockReturnThis(),
      exec: vi.fn(),
    };

    mockRedis = {
      pipeline: vi.fn().mockReturnValue(mockPipeline),
      zremrangebyscore: vi.fn().mockResolvedValue(0),
      zcard: vi.fn().mockResolvedValue(0),
      zadd: vi.fn().mockResolvedValue(1),
      pexpire: vi.fn().mockResolvedValue(1),
      zrange: vi.fn().mockResolvedValue([]),
      del: vi.fn().mockResolvedValue(1),
    };

    (getRedis as any).mockResolvedValue(mockRedis);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Distributed Rate Limiting', () => {
    it('should allow requests under the limit', async () => {
      mockPipeline.exec.mockResolvedValue([
        [null, 0], // zremrangebyscore
        [null, 0], // zcard (no existing requests)
      ]);

      const result = await checkRateLimit('user:123', {
        maxRequests: 10,
        windowMs: 60000,
      });

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(9);
      expect(result.limit).toBe(10);
    });

    it('should block requests over the limit', async () => {
      mockPipeline.exec.mockResolvedValue([
        [null, 0], // zremrangebyscore
        [null, 10], // zcard (at limit)
      ]);

      const result = await checkRateLimit('user:123', {
        maxRequests: 10,
        windowMs: 60000,
      });

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('should use sliding window algorithm', async () => {
      mockPipeline.exec.mockResolvedValue([
        [null, 5], // zremrangebyscore (removed 5 old entries)
        [null, 3], // zcard (3 remaining in window)
      ]);

      const result = await checkRateLimit('user:123', {
        maxRequests: 10,
        windowMs: 60000,
      });

      expect(result.allowed).toBe(true);
      // 3 existing + 1 new = 4, so 6 remaining
      expect(result.remaining).toBe(6);
    });

    it('should use different keys for different rate limit scopes', async () => {
      mockPipeline.exec.mockResolvedValue([
        [null, 0], [null, 0],
      ]);

      await checkRateLimit('ip:192.168.1.1', { maxRequests: 100, windowMs: 60000 });
      await checkRateLimit('user:user-123', { maxRequests: 1000, windowMs: 60000 });
      await checkRateLimit('api:key-abc', { maxRequests: 10000, windowMs: 60000 });

      const calls = mockRedis.pipeline.mock.calls;
      expect(calls.length).toBe(3);
    });

    it('should support Redis Cluster with hash tags', async () => {
      mockPipeline.exec.mockResolvedValue([
        [null, 0], [null, 0],
      ]);

      await checkRateLimit('user:123', {
        maxRequests: 10,
        windowMs: 60000,
        keyPrefix: 'ratelimit:{tenant1}',
      });

      // Verify hash tag is in key for zadd (called on redis directly after pipeline)
      const zaddCall = mockRedis.zadd.mock.calls[0];
      expect(zaddCall[0]).toContain('{tenant1}');
    });
  });

  describe('In-Memory Fallback (CRIT-7)', () => {
    it('should fall back to in-memory when Redis pipeline returns null', async () => {
      mockPipeline.exec.mockResolvedValue(null);

      const result = await checkRateLimit('user:123', {
        maxRequests: 10,
        windowMs: 60000,
      });

      // Falls back to in-memory rate limiting, which allows first request
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(9);
      expect(result.limit).toBe(10);
    });

    it('should fall back to in-memory when getRedis() throws', async () => {
      (getRedis as any).mockRejectedValue(new Error('REDIS_URL not set'));

      const result = await checkRateLimit('user:456', {
        maxRequests: 5,
        windowMs: 30000,
      });

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4);
      expect(result.limit).toBe(5);
    });

    it('should fall back to in-memory when pipeline.exec() throws', async () => {
      mockPipeline.exec.mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await checkRateLimit('user:789', {
        maxRequests: 10,
        windowMs: 60000,
      });

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(9);
    });

    it('should enforce rate limits in fallback mode', async () => {
      (getRedis as any).mockRejectedValue(new Error('Redis down'));

      const config = { maxRequests: 3, windowMs: 60000 };

      const r1 = await checkRateLimit('limited-user', config);
      const r2 = await checkRateLimit('limited-user', config);
      const r3 = await checkRateLimit('limited-user', config);
      const r4 = await checkRateLimit('limited-user', config);

      expect(r1.allowed).toBe(true);
      expect(r1.remaining).toBe(2);
      expect(r2.allowed).toBe(true);
      expect(r2.remaining).toBe(1);
      expect(r3.allowed).toBe(true);
      expect(r3.remaining).toBe(0);
      expect(r4.allowed).toBe(false);
      expect(r4.remaining).toBe(0);
    });

    it('should emit fallback metrics when Redis fails', async () => {
      (getRedis as any).mockRejectedValue(new Error('Redis down'));

      await checkRateLimit('metrics-test', {
        maxRequests: 10,
        windowMs: 60000,
      });

      expect(emitCounter).toHaveBeenCalledWith(
        'rate_limiter_fallback',
        1,
        expect.objectContaining({ reason: 'redis_error' })
      );
    });

    it('should use circuit breaker to avoid hammering failing Redis', async () => {
      (getRedis as any).mockRejectedValue(new Error('Redis timeout'));

      // Make 3 calls to trip the circuit breaker (failureThreshold: 3)
      for (let i = 0; i < 3; i++) {
        await checkRateLimit(`cb-test-${i}`, { maxRequests: 10, windowMs: 60000 });
      }

      const getRedisCallCount = (getRedis as any).mock.calls.length;

      // 4th call: circuit is open, should NOT call getRedis
      const result = await checkRateLimit('cb-test-after', { maxRequests: 10, windowMs: 60000 });

      // getRedis should not have been called again (circuit breaker skipped it)
      expect((getRedis as any).mock.calls.length).toBe(getRedisCallCount);

      // Should still get a valid in-memory result
      expect(result.allowed).toBe(true);
      expect(emitCounter).toHaveBeenCalledWith(
        'rate_limiter_fallback',
        1,
        expect.objectContaining({ reason: 'circuit_open' })
      );
    });

    it('should isolate fallback rate limits by key', async () => {
      (getRedis as any).mockRejectedValue(new Error('Redis down'));

      const config = { maxRequests: 2, windowMs: 60000 };

      // Exhaust limit for user-a
      await checkRateLimit('user-a', config);
      await checkRateLimit('user-a', config);
      const r3 = await checkRateLimit('user-a', config);

      // user-b should still have capacity
      const rb1 = await checkRateLimit('user-b', config);

      expect(r3.allowed).toBe(false);
      expect(rb1.allowed).toBe(true);
    });
  });

  describe('Burst Allowance', () => {
    it('should allow burst requests within burst limit', async () => {
      // Mock burst check (allows up to 15)
      mockPipeline.exec
        .mockResolvedValueOnce([
          [null, 0], [null, 5], // Burst check: 5 existing
        ])
        .mockResolvedValueOnce([
          [null, 0], [null, 3], // Base check: 3 existing
        ]);

      const result = await checkBurstRateLimit('user:123', 10, 5, 60000);

      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(15); // base + burst
    });

    it('should block burst requests exceeding combined limit', async () => {
      // Mock burst check (exceeds limit)
      mockPipeline.exec
        .mockResolvedValueOnce([
          [null, 0], [null, 15], // Burst check: at limit
        ]);

      const result = await checkBurstRateLimit('user:123', 10, 5, 60000);

      expect(result.allowed).toBe(false);
    });

    it('should use minimum remaining from burst and base checks', async () => {
      mockPipeline.exec
        .mockResolvedValueOnce([
          [null, 0], [null, 2], // Burst: 2 used, 13 remaining
        ])
        .mockResolvedValueOnce([
          [null, 0], [null, 8], // Base: 8 used, 2 remaining
        ]);

      const result = await checkBurstRateLimit('user:123', 10, 5, 60000);

      // Should return minimum of remaining values
      expect(result.remaining).toBeLessThanOrEqual(2);
    });

    it('should fall back to in-memory when Redis is unavailable', async () => {
      (getRedis as any).mockRejectedValue(new Error('Redis down'));

      const result = await checkBurstRateLimit('user:burst-fallback', 10, 5, 60000);

      // Should still return a result via in-memory fallback
      expect(result).toHaveProperty('allowed');
      expect(result).toHaveProperty('remaining');
      expect(result).toHaveProperty('limit');
    });
  });

  describe('Rate Limit Headers', () => {
    it('should return correct rate limit status', async () => {
      mockRedis.zremrangebyscore.mockResolvedValue(0);
      mockRedis.zcard.mockResolvedValue(5);

      const result = await getRateLimitStatus('user:123', {
        maxRequests: 10,
        windowMs: 60000,
      });

      expect(result.limit).toBe(10);
      expect(result.remaining).toBe(5);
      expect(result.allowed).toBe(true);
      expect(result.resetTime).toBeGreaterThan(Date.now());
    });

    it('should calculate correct reset time', async () => {
      const now = Date.now();
      mockRedis.zremrangebyscore.mockResolvedValue(0);
      mockRedis.zcard.mockResolvedValue(1);
      mockRedis.zrange.mockResolvedValue(['request1', String(now - 30000)]); // 30 seconds ago

      const result = await getRateLimitStatus('user:123', {
        maxRequests: 10,
        windowMs: 60000,
      });

      // Reset time should be 30 seconds from now (60s window - 30s old request)
      const expectedResetTime = now + 30000;
      expect(result.resetTime).toBeGreaterThanOrEqual(expectedResetTime - 1000);
      expect(result.resetTime).toBeLessThanOrEqual(expectedResetTime + 1000);
    });

    it('should set rate limit headers in middleware', async () => {
      mockPipeline.exec.mockResolvedValue([
        [null, 0], [null, 5],
      ]);

      const mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
        setHeader: vi.fn(),
      };
      const mockNext = vi.fn();

      const middleware = rateLimitMiddleware(
        { maxRequests: 10, windowMs: 60000 },
        (req) => req.ip
      );

      await middleware(
        { ip: '192.168.1.1' } as any,
        mockRes as any,
        mockNext
      );

      expect(mockRes.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 10);
      expect(mockRes.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', 4);
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'X-RateLimit-Reset',
        expect.any(Number)
      );
    });

    it('should return 429 with retry-after header when rate limited', async () => {
      mockPipeline.exec.mockResolvedValue([
        [null, 0], [null, 10],
      ]);

      const mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
        setHeader: vi.fn(),
      };
      const mockNext = vi.fn();

      const middleware = rateLimitMiddleware(
        { maxRequests: 10, windowMs: 60000 },
        (req) => req.ip
      );

      await middleware(
        { ip: '192.168.1.1' } as any,
        mockRes as any,
        mockNext
      );

      expect(mockRes.status).toHaveBeenCalledWith(429);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Too Many Requests',
          retryAfter: expect.any(Number),
        })
      );
    });

    it('should not crash middleware when Redis is unavailable', async () => {
      (getRedis as any).mockRejectedValue(new Error('Redis unavailable'));

      const mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
        setHeader: vi.fn(),
      };
      const mockNext = vi.fn();

      const middleware = rateLimitMiddleware(
        { maxRequests: 10, windowMs: 60000 },
        (req) => req.ip
      );

      await middleware(
        { ip: '1.2.3.4' } as any,
        mockRes as any,
        mockNext
      );

      // Should call next (in-memory fallback allows first request)
      expect(mockNext).toHaveBeenCalled();
      // Should set rate limit headers from fallback
      expect(mockRes.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 10);
    });

    it('should provide rate limiter instance with fixed config', async () => {
      mockPipeline.exec.mockResolvedValue([
        [null, 0], [null, 0],
      ]);

      const limiter = createRateLimiter({
        maxRequests: 100,
        windowMs: 3600000,
        keyPrefix: 'api',
      });

      // Test check
      const checkResult = await limiter.check('user:123');
      expect(checkResult.allowed).toBe(true);

      // Test status
      mockRedis.zcard.mockResolvedValue(5);
      const statusResult = await limiter.status('user:123');
      expect(statusResult.remaining).toBe(95); // 100 max - 5 used = 95 remaining

      // Test reset
      await limiter.reset('user:123');
      expect(mockRedis.del).toHaveBeenCalledWith('api:user:123');
    });
  });

  describe('Rate Limit Reset', () => {
    it('should reset rate limit for a key', async () => {
      mockRedis.del.mockResolvedValue(1);

      await resetRateLimit('user:123');

      expect(mockRedis.del).toHaveBeenCalledWith('ratelimit:user:123');
    });

    it('should reset rate limit with custom prefix', async () => {
      await resetRateLimit('user:123', 'custom:prefix');

      expect(mockRedis.del).toHaveBeenCalledWith('custom:prefix:user:123');
    });

    it('should handle reset for non-existent key', async () => {
      mockRedis.del.mockResolvedValue(0);

      await resetRateLimit('user:nonexistent');

      expect(mockRedis.del).toHaveBeenCalled();
    });
  });
});
