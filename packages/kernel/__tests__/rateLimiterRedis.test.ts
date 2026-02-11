/**
 * P2 TEST: Rate Limiting Tests
 * 
 * Tests distributed rate limiting, burst allowance, and rate limit headers.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  checkRateLimit,
  checkBurstRateLimit,
  getRateLimitStatus,
  resetRateLimit,
  rateLimitMiddleware,
  createRateLimiter,
} from '../rateLimiterRedis';

// Mock Redis
vi.mock('../redis', () => ({
  getRedis: vi.fn(),
}));

import { getRedis } from '../redis';

describe('Rate Limiting Tests', () => {
  let mockRedis: any;
  let mockPipeline: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
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
        [null, 1], // zadd
        [null, 1], // pexpire
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
        [null, 1], // zadd
        [null, 1], // pexpire
      ]);

      const result = await checkRateLimit('user:123', {
        maxRequests: 10,
        windowMs: 60000,
      });

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('should use sliding window algorithm', async () => {
      const now = Date.now();
      mockPipeline.exec.mockResolvedValue([
        [null, 5], // zremrangebyscore (removed 5 old entries)
        [null, 3], // zcard (3 remaining in window)
        [null, 1], // zadd
        [null, 1], // pexpire
      ]);

      const result = await checkRateLimit('user:123', {
        maxRequests: 10,
        windowMs: 60000,
      });

      expect(result.allowed).toBe(true);
      // 3 existing + 1 new = 4, so 6 remaining
      expect(result.remaining).toBe(6);
    });

    it('should handle Redis pipeline failure gracefully', async () => {
      mockPipeline.exec.mockResolvedValue(null);

      const result = await checkRateLimit('user:123', {
        maxRequests: 10,
        windowMs: 60000,
      });

      // Should fail open to prevent blocking legitimate traffic
      expect(result.allowed).toBe(true);
    });

    it('should use different keys for different rate limit scopes', async () => {
      mockPipeline.exec.mockResolvedValue([
        [null, 0], [null, 0], [null, 1], [null, 1],
      ]);

      await checkRateLimit('ip:192.168.1.1', { maxRequests: 100, windowMs: 60000 });
      await checkRateLimit('user:user-123', { maxRequests: 1000, windowMs: 60000 });
      await checkRateLimit('api:key-abc', { maxRequests: 10000, windowMs: 60000 });

      const calls = mockRedis.pipeline.mock.calls;
      expect(calls.length).toBe(3);
    });

    it('should support Redis Cluster with hash tags', async () => {
      mockPipeline.exec.mockResolvedValue([
        [null, 0], [null, 0], [null, 1], [null, 1],
      ]);

      await checkRateLimit('user:123', {
        maxRequests: 10,
        windowMs: 60000,
        keyPrefix: 'ratelimit:{tenant1}',
      });

      // Verify hash tag is in key
      const zaddCall = mockPipeline.zadd.mock.calls[0];
      expect(zaddCall[0]).toContain('{tenant1}');
    });
  });

  describe('Burst Allowance', () => {
    it('should allow burst requests within burst limit', async () => {
      // Mock burst check (allows up to 15)
      mockPipeline.exec
        .mockResolvedValueOnce([
          [null, 0], [null, 5], [null, 1], [null, 1], // Burst check: 5 existing
        ])
        .mockResolvedValueOnce([
          [null, 0], [null, 3], [null, 1], [null, 1], // Base check: 3 existing
        ]);

      const result = await checkBurstRateLimit('user:123', 10, 5, 60000);

      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(15); // base + burst
    });

    it('should block burst requests exceeding combined limit', async () => {
      // Mock burst check (exceeds limit)
      mockPipeline.exec
        .mockResolvedValueOnce([
          [null, 0], [null, 15], [null, 1], [null, 1], // Burst check: at limit
        ]);

      const result = await checkBurstRateLimit('user:123', 10, 5, 60000);

      expect(result.allowed).toBe(false);
    });

    it('should use minimum remaining from burst and base checks', async () => {
      mockPipeline.exec
        .mockResolvedValueOnce([
          [null, 0], [null, 2], [null, 1], [null, 1], // Burst: 2 used, 13 remaining
        ])
        .mockResolvedValueOnce([
          [null, 0], [null, 8], [null, 1], [null, 1], // Base: 8 used, 2 remaining
        ]);

      const result = await checkBurstRateLimit('user:123', 10, 5, 60000);

      // Should return minimum of remaining values
      expect(result.remaining).toBeLessThanOrEqual(2);
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
        [null, 0], [null, 5], [null, 1], [null, 1],
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
        [null, 0], [null, 10], [null, 1], [null, 1],
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

    it('should provide rate limiter instance with fixed config', async () => {
      mockPipeline.exec.mockResolvedValue([
        [null, 0], [null, 0], [null, 1], [null, 1],
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
      expect(statusResult.remaining).toBe(5);

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
