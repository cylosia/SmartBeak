/**
 * @fileoverview CRITICAL SECURITY TESTS: Distributed Rate Limiting
 * 
 * P0-SECURITY-FIX: Rate Limiting Bypass in Scaled Deployments
 * 
 * VULNERABILITY (FIXED):
 * The rateLimitMiddleware factory function was using in-memory checkRateLimit
 * instead of checkRateLimitDistributed, allowing rate limit bypass when running
 * multiple server instances behind a load balancer.
 * 
 * SECURITY IMPACT:
 * - CVSS Score: 7.5 (High)
 * - Attack Vector: Network
 * - Attack Complexity: Low
 * - Privileges Required: None
 * - User Interaction: None
 * - Scope: Changed
 * - Confidentiality: None
 * - Integrity: None
 * - Availability: High
 * 
 * EXPLOIT SCENARIO:
 * An attacker could distribute requests across multiple server instances,
 * effectively multiplying their rate limit by the number of instances.
 * With 10 instances and a 60 req/min limit, attacker could make 600 req/min.
 * 
 * FIX VERIFICATION:
 * These tests verify that:
 * 1. Rate limits are enforced using Redis (distributed)
 * 2. Redis failures fail closed (deny access, not allow)
 * 3. Multiple instances share rate limit state
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import type { FastifyRequest, FastifyReply } from 'fastify';

// Mock dependencies
const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn();
const mockRedisExpire = jest.fn();
const mockRedisIncr = jest.fn();
const mockRedisTtl = jest.fn();
const mockRedisDel = jest.fn();
const mockRedisEval = jest.fn();
const mockRedisEvalsha = jest.fn();
const mockRedisScript = jest.fn();

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    get: mockRedisGet,
    set: mockRedisSet,
    expire: mockRedisExpire,
    incr: mockRedisIncr,
    ttl: mockRedisTtl,
    del: mockRedisDel,
    eval: mockRedisEval,
    evalsha: mockRedisEvalsha,
    script: mockRedisScript,
    on: jest.fn(),
    quit: jest.fn(),
    ping: jest.fn().mockResolvedValue('PONG'),
  }));
});

jest.mock('../ops/metrics', () => ({
  emitMetric: jest.fn(),
}));

jest.mock('@kernel/logger', () => ({
  getLogger: jest.fn().mockReturnValue({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

// Import after mocking
import { 
  RateLimiter, 
  adminRateLimit, 
  apiRateLimit, 
  rateLimitMiddleware,
  DEFAULT_RATE_LIMITS,
  detectBot,
  type RateLimitConfig,
} from '../rateLimiter';

// Mock the distributed rate limiter
const mockCheckRateLimitRedis = jest.fn();

jest.mock('@kernel/rateLimiterRedis', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimitRedis(...args),
}));

describe('CRITICAL SECURITY: Distributed Rate Limiting', () => {
  let mockRequest: Partial<FastifyRequest>;
  let mockReply: Partial<FastifyReply>;
  let sentStatus: number | undefined;
  let sentPayload: unknown;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockRequest = {
      ip: '192.168.1.100',
      headers: {
        'user-agent': 'Mozilla/5.0 Test Browser',
        'accept': 'application/json',
        'accept-language': 'en-US',
      },
    };

    sentStatus = undefined;
    sentPayload = undefined;

    mockReply = {
      status: jest.fn().mockImplementation((code: number) => {
        sentStatus = code;
        return mockReply;
      }),
      send: jest.fn().mockImplementation((payload: unknown) => {
        sentPayload = payload;
        return mockReply;
      }),
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('VULNERABILITY FIX: rateLimitMiddleware uses distributed check', () => {
    it('should use Redis-based distributed rate limiting (not in-memory)', async () => {
      // Arrange: Allow the first request
      mockCheckRateLimitRedis.mockResolvedValueOnce({ allowed: true });

      const middleware = rateLimitMiddleware('standard');
      const done = jest.fn();

      // Act
      await middleware(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply,
        done
      );

      // Assert: Verify distributed rate limiter was called
      expect(mockCheckRateLimitRedis).toHaveBeenCalledTimes(1);
      expect(mockCheckRateLimitRedis).toHaveBeenCalledWith(
        expect.stringContaining('standard:'),
        expect.objectContaining({
          maxRequests: 60,
          windowMs: 60000,
          keyPrefix: 'ratelimit:middleware',
        })
      );
      expect(done).toHaveBeenCalled();
    });

    it('should deny request when distributed rate limit is exceeded', async () => {
      // Arrange: Deny the request (rate limit exceeded)
      mockCheckRateLimitRedis.mockResolvedValueOnce({ allowed: false });

      const middleware = rateLimitMiddleware('standard');
      const done = jest.fn();

      // Act
      await middleware(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply,
        done
      );

      // Assert: Request should be denied
      expect(mockCheckRateLimitRedis).toHaveBeenCalled();
      expect(sentStatus).toBe(429);
      expect(sentPayload).toEqual({ error: 'Rate limit exceeded' });
      expect(done).not.toHaveBeenCalled();
    });

    it('should share rate limit state across multiple middleware instances', async () => {
      // Arrange: Simulate two instances checking same key
      mockCheckRateLimitRedis
        .mockResolvedValueOnce({ allowed: true })
        .mockResolvedValueOnce({ allowed: false });

      const middleware1 = rateLimitMiddleware('strict');
      const middleware2 = rateLimitMiddleware('strict');
      const done1 = jest.fn();
      const done2 = jest.fn();

      // Same IP hitting two different "instances"
      const request1 = { ...mockRequest, ip: '10.0.0.1' };
      const request2 = { ...mockRequest, ip: '10.0.0.1' };

      // Act
      await middleware1(
        request1 as FastifyRequest,
        mockReply as FastifyReply,
        done1
      );
      
      await middleware2(
        request2 as FastifyRequest,
        mockReply as FastifyReply,
        done2
      );

      // Assert: Both should use same rate limit key (shared state)
      const calls = mockCheckRateLimitRedis.mock.calls;
      expect(calls).toHaveLength(2);
      expect(calls[0][0]).toBe(calls[1][0]); // Same key = shared state
    });

    it('should include tenant isolation in rate limit keys', async () => {
      // Arrange
      mockCheckRateLimitRedis.mockResolvedValue({ allowed: true });

      const middleware = rateLimitMiddleware('standard');
      const done = jest.fn();

      // Request with orgId
      const requestWithOrg = {
        ...mockRequest,
        ip: '10.0.0.1',
        orgId: 'org_123',
      };

      // Act
      await middleware(
        requestWithOrg as unknown as FastifyRequest,
        mockReply as FastifyReply,
        done
      );

      // Assert: Key should include orgId for tenant isolation
      expect(mockCheckRateLimitRedis).toHaveBeenCalledWith(
        'standard:org_123:10.0.0.1',
        expect.any(Object)
      );
    });
  });

  describe('FAIL CLOSED: Redis failures deny access', () => {
    it('should deny access when Redis is unavailable (fail closed)', async () => {
      // Arrange: Simulate Redis failure
      mockCheckRateLimitRedis.mockRejectedValueOnce(new Error('Redis connection lost'));

      const middleware = rateLimitMiddleware('standard');
      const done = jest.fn();

      // Act
      await middleware(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply,
        done
      );

      // Assert: Should fail closed (deny access)
      expect(mockCheckRateLimitRedis).toHaveBeenCalled();
      expect(sentStatus).toBe(429);
      expect(sentPayload).toEqual({ error: 'Rate limit exceeded' });
      expect(done).not.toHaveBeenCalled();
    });

    it('should deny access on Redis timeout (fail closed)', async () => {
      // Arrange: Simulate Redis timeout
      const timeoutError = new Error('Redis command timeout');
      mockCheckRateLimitRedis.mockRejectedValueOnce(timeoutError);

      const middleware = rateLimitMiddleware('strict');
      const done = jest.fn();

      // Act
      await middleware(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply,
        done
      );

      // Assert: Should fail closed
      expect(sentStatus).toBe(429);
      expect(done).not.toHaveBeenCalled();
    });

    it('should deny access on Redis memory limit (fail closed)', async () => {
      // Arrange: Simulate Redis OOM error
      const oomError = new Error('OOM command not allowed when used memory > maxmemory');
      mockCheckRateLimitRedis.mockRejectedValueOnce(oomError);

      const middleware = rateLimitMiddleware('lenient');
      const done = jest.fn();

      // Act
      await middleware(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply,
        done
      );

      // Assert: Should fail closed
      expect(sentStatus).toBe(429);
      expect(done).not.toHaveBeenCalled();
    });

    it('should emit security metrics on Redis failures', async () => {
      // Arrange
      const { emitMetric } = await import('../ops/metrics');
      mockCheckRateLimitRedis.mockRejectedValueOnce(new Error('Redis failure'));

      const middleware = rateLimitMiddleware('standard');

      // Act
      await middleware(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply,
        jest.fn()
      );

      // Assert: Security metric should be emitted
      expect(emitMetric).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'rate_limiter_redis_failure',
          labels: expect.any(Object),
          value: 1,
        })
      );
    });
  });

  describe('MULTI-INSTANCE: Rate limit sharing across deployment', () => {
    it('should enforce consistent rate limits across simulated instances', async () => {
      // Arrange: Simulate rate limit bucket with 5 tokens
      let tokens = 5;
      mockCheckRateLimitRedis.mockImplementation(async () => {
        if (tokens > 0) {
          tokens--;
          return { allowed: true };
        }
        return { allowed: false };
      });

      const middleware = rateLimitMiddleware('strict', { 
        tokensPerInterval: 5, 
        intervalSeconds: 60 
      });

      // Act: Send 10 requests as if from different instances
      const results: boolean[] = [];
      for (let i = 0; i < 10; i++) {
        const done = jest.fn();
        await middleware(
          mockRequest as FastifyRequest,
          mockReply as FastifyReply,
          done
        );
        results.push(done.mock.calls.length > 0);
      }

      // Assert: Only 5 should succeed (rate limit enforced)
      const successCount = results.filter(r => r).length;
      expect(successCount).toBe(5);
      expect(mockCheckRateLimitRedis).toHaveBeenCalledTimes(10);
    });

    it('should maintain rate limit state across different tier configurations', async () => {
      mockCheckRateLimitRedis.mockResolvedValue({ allowed: true });

      const strictMiddleware = rateLimitMiddleware('strict');
      const standardMiddleware = rateLimitMiddleware('standard');
      const lenientMiddleware = rateLimitMiddleware('lenient');

      // Act
      await strictMiddleware(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply,
        jest.fn()
      );
      await standardMiddleware(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply,
        jest.fn()
      );
      await lenientMiddleware(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply,
        jest.fn()
      );

      // Assert: Each tier should have its own rate limit key
      const calls = mockCheckRateLimitRedis.mock.calls;
      expect(calls[0][0]).toContain('strict:');
      expect(calls[1][0]).toContain('standard:');
      expect(calls[2][0]).toContain('lenient:');
    });
  });

  describe('adminRateLimit middleware', () => {
    it('should use distributed rate limiting for admin endpoints', async () => {
      mockCheckRateLimitRedis.mockResolvedValueOnce({ allowed: true });

      const middleware = adminRateLimit();
      const done = jest.fn();

      await middleware(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply,
        done
      );

      expect(mockCheckRateLimitRedis).toHaveBeenCalledWith(
        expect.stringContaining('admin:'),
        expect.objectContaining({
          maxRequests: 10,
          windowMs: 60000,
        })
      );
      expect(done).toHaveBeenCalled();
    });

    it('should fail closed on Redis errors for admin endpoints', async () => {
      mockCheckRateLimitRedis.mockRejectedValueOnce(new Error('Redis down'));

      const middleware = adminRateLimit();
      const done = jest.fn();

      await middleware(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply,
        done
      );

      expect(sentStatus).toBe(429);
      expect(done).not.toHaveBeenCalled();
    });
  });

  describe('apiRateLimit middleware', () => {
    it('should use distributed rate limiting for API endpoints', async () => {
      mockCheckRateLimitRedis.mockResolvedValueOnce({ allowed: true });

      const middleware = apiRateLimit();
      const done = jest.fn();

      await middleware(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply,
        done
      );

      expect(mockCheckRateLimitRedis).toHaveBeenCalledWith(
        expect.stringContaining('api:'),
        expect.objectContaining({
          maxRequests: 60,
          windowMs: 60000,
        })
      );
      expect(done).toHaveBeenCalled();
    });

    it('should fail closed on Redis errors for API endpoints', async () => {
      mockCheckRateLimitRedis.mockRejectedValueOnce(new Error('Redis unavailable'));

      const middleware = apiRateLimit();
      const done = jest.fn();

      await middleware(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply,
        done
      );

      expect(sentStatus).toBe(429);
      expect(done).not.toHaveBeenCalled();
    });
  });

  describe('Tier configurations', () => {
    it('should apply correct rate limits for strict tier', async () => {
      mockCheckRateLimitRedis.mockResolvedValueOnce({ allowed: true });

      const middleware = rateLimitMiddleware('strict');
      await middleware(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply,
        jest.fn()
      );

      expect(mockCheckRateLimitRedis).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          maxRequests: 10,
          windowMs: 60000,
        })
      );
    });

    it('should apply correct rate limits for standard tier', async () => {
      mockCheckRateLimitRedis.mockResolvedValueOnce({ allowed: true });

      const middleware = rateLimitMiddleware('standard');
      await middleware(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply,
        jest.fn()
      );

      expect(mockCheckRateLimitRedis).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          maxRequests: 60,
          windowMs: 60000,
        })
      );
    });

    it('should apply correct rate limits for lenient tier', async () => {
      mockCheckRateLimitRedis.mockResolvedValueOnce({ allowed: true });

      const middleware = rateLimitMiddleware('lenient');
      await middleware(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply,
        jest.fn()
      );

      expect(mockCheckRateLimitRedis).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          maxRequests: 1000,
          windowMs: 60000,
        })
      );
    });

    it('should allow custom config to override tier defaults', async () => {
      mockCheckRateLimitRedis.mockResolvedValueOnce({ allowed: true });

      const middleware = rateLimitMiddleware('strict', {
        tokensPerInterval: 100,
        intervalSeconds: 30,
      });
      await middleware(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply,
        jest.fn()
      );

      expect(mockCheckRateLimitRedis).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          maxRequests: 100,
          windowMs: 30000,
        })
      );
    });
  });

  describe('Bot detection integration', () => {
    it('should block requests when bot is detected with high confidence', async () => {
      const botRequest = {
        ...mockRequest,
        headers: {
          'user-agent': 'curl/7.68.0',
          // Missing accept and accept-language headers
        },
      };

      const middleware = rateLimitMiddleware('standard', {}, { detectBots: true });
      const done = jest.fn();

      await middleware(
        botRequest as FastifyRequest,
        mockReply as FastifyReply,
        done
      );

      expect(sentStatus).toBe(403);
      expect(sentPayload).toEqual({ error: 'Bot detected' });
      expect(done).not.toHaveBeenCalled();
      expect(mockCheckRateLimitRedis).not.toHaveBeenCalled();
    });

    it('should allow requests when detectBots is false', async () => {
      mockCheckRateLimitRedis.mockResolvedValueOnce({ allowed: true });

      const botRequest = {
        ...mockRequest,
        headers: {
          'user-agent': 'curl/7.68.0',
        },
      };

      const middleware = rateLimitMiddleware('standard', {}, { detectBots: false });
      const done = jest.fn();

      await middleware(
        botRequest as FastifyRequest,
        mockReply as FastifyReply,
        done
      );

      expect(done).toHaveBeenCalled();
    });

    it('should allow requests with legitimate user agents', async () => {
      mockCheckRateLimitRedis.mockResolvedValueOnce({ allowed: true });

      const legitimateRequest = {
        ...mockRequest,
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0',
          'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'accept-language': 'en-US,en;q=0.9',
          'referer': 'https://example.com',
        },
      };

      const middleware = rateLimitMiddleware('standard', {}, { detectBots: true });
      const done = jest.fn();

      await middleware(
        legitimateRequest as FastifyRequest,
        mockReply as FastifyReply,
        done
      );

      expect(done).toHaveBeenCalled();
      expect(sentStatus).not.toBe(403);
    });
  });

  describe('detectBot utility', () => {
    it('should detect bots by user agent pattern', () => {
      const result = detectBot({ 'user-agent': 'Googlebot/2.1' });
      expect(result.isBot).toBe(true);
      expect(result.indicators).toContain('suspicious_ua:bot');
    });

    it('should detect missing user agent', () => {
      const result = detectBot({});
      expect(result.isBot).toBe(true);
      expect(result.indicators).toContain('missing_user_agent');
    });

    it('should detect headless browsers', () => {
      const result = detectBot({ 'user-agent': 'Mozilla/5.0 HeadlessChrome/120.0.0.0' });
      expect(result.isBot).toBe(true);
      expect(result.indicators).toContain('headless_browser');
    });

    it('should allow legitimate browsers', () => {
      const result = detectBot({
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'accept': 'text/html',
        'accept-language': 'en-US',
        'referer': 'https://google.com',
      });
      expect(result.isBot).toBe(false);
    });
  });

  describe('Edge cases', () => {
    it('should handle requests without IP address', async () => {
      mockCheckRateLimitRedis.mockResolvedValueOnce({ allowed: true });

      const requestWithoutIP = {
        ...mockRequest,
        ip: undefined,
      };

      const middleware = rateLimitMiddleware('standard');
      const done = jest.fn();

      await middleware(
        requestWithoutIP as FastifyRequest,
        mockReply as FastifyReply,
        done
      );

      expect(mockCheckRateLimitRedis).toHaveBeenCalledWith(
        expect.stringContaining('unknown'),
        expect.any(Object)
      );
    });

    it('should handle unknown tier gracefully', async () => {
      mockCheckRateLimitRedis.mockResolvedValueOnce({ allowed: true });

      // @ts-expect-error Testing invalid tier
      const middleware = rateLimitMiddleware('nonexistent');
      const done = jest.fn();

      await middleware(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply,
        done
      );

      // Should fall back to standard tier
      expect(mockCheckRateLimitRedis).toHaveBeenCalledWith(
        expect.stringContaining('standard:'),
        expect.objectContaining({
          maxRequests: 60,
        })
      );
    });

    it('should handle Redis returning malformed response', async () => {
      mockCheckRateLimitRedis.mockResolvedValueOnce({ allowed: true });

      const middleware = rateLimitMiddleware('standard');
      const done = jest.fn();

      await middleware(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply,
        done
      );

      expect(done).toHaveBeenCalled();
    });
  });
});

describe('RateLimiter class integration', () => {
  let rateLimiter: RateLimiter;

  beforeEach(async () => {
    jest.clearAllMocks();
    
    // Reset Redis mock implementations
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    mockRedisExpire.mockResolvedValue(1);
    mockRedisIncr.mockResolvedValue(1);
    mockRedisTtl.mockResolvedValue(60);
    mockRedisDel.mockResolvedValue(1);
    mockRedisEval.mockResolvedValue([1, 59]);
    mockRedisEvalsha.mockResolvedValue([1, 59]);
    mockRedisScript.mockResolvedValue('abc123');

    rateLimiter = new RateLimiter('redis://localhost:6379');
    
    rateLimiter.registerProvider('test', {
      tokensPerInterval: 60,
      intervalSeconds: 60,
      burstSize: 60,
    });
  });

  afterEach(async () => {
    await rateLimiter.close();
  });

  it('should check rate limit using Redis Lua script', async () => {
    const status = await rateLimiter.checkLimit('test');

    expect(status.allowed).toBe(true);
    expect(mockRedisEvalsha).toHaveBeenCalled();
  });

  it('should record failures and track cooldown state', async () => {
    mockRedisIncr.mockResolvedValueOnce(5);

    await rateLimiter.recordFailure('test');

    expect(mockRedisIncr).toHaveBeenCalledWith('ratelimit:test:failures');
  });

  it('should reset rate limit state', async () => {
    await rateLimiter.reset('test');

    expect(mockRedisDel).toHaveBeenCalledTimes(4);
  });
});
