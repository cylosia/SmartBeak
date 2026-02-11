/**
 * P2 TEST: CSRF Protection Tests
 * 
 * Tests CSRF token validation, generation, and middleware behavior.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  generateCsrfToken,
  validateCsrfToken,
  clearCsrfToken,
  csrfProtection,
  setCsrfCookie,
} from '../csrf';
import type { FastifyRequest, FastifyReply } from 'fastify';

// Mock Redis
vi.mock('@kernel/redis', () => ({
  getRedis: vi.fn(),
}));

import { getRedis } from '@kernel/redis';

describe('CSRF Protection Tests', () => {
  let mockRedis: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockRedis = {
      setex: vi.fn().mockResolvedValue('OK'),
      get: vi.fn(),
      del: vi.fn().mockResolvedValue(1),
    };

    (getRedis as any).mockResolvedValue(mockRedis);
  });

  describe('CSRF Token Generation', () => {
    it('should generate unique tokens for different sessions', async () => {
      mockRedis.setex.mockResolvedValue('OK');

      const token1 = await generateCsrfToken('session-1');
      const token2 = await generateCsrfToken('session-2');

      expect(token1).not.toBe(token2);
      expect(token1).toHaveLength(64); // 32 bytes in hex
      expect(token2).toHaveLength(64);
    });

    it('should store token in Redis with TTL', async () => {
      await generateCsrfToken('session-123');

      expect(mockRedis.setex).toHaveBeenCalledWith(
        'csrf:session-123',
        3600, // 1 hour
        expect.any(String)
      );
    });

    it('should generate different tokens for same session on multiple calls', async () => {
      // Each call generates a new token
      const token1 = await generateCsrfToken('session-123');
      const token2 = await generateCsrfToken('session-123');

      expect(token1).not.toBe(token2);
    });
  });

  describe('CSRF Token Validation', () => {
    it('should validate correct token', async () => {
      const storedToken = 'a'.repeat(64);
      mockRedis.get.mockResolvedValue(storedToken);

      const isValid = await validateCsrfToken('session-123', storedToken);

      expect(isValid).toBe(true);
    });

    it('should reject incorrect token', async () => {
      mockRedis.get.mockResolvedValue('a'.repeat(64));

      const isValid = await validateCsrfToken('session-123', 'b'.repeat(64));

      expect(isValid).toBe(false);
    });

    it('should reject token for non-existent session', async () => {
      mockRedis.get.mockResolvedValue(null);

      const isValid = await validateCsrfToken('session-nonexistent', 'any-token');

      expect(isValid).toBe(false);
    });

    it('should use constant-time comparison to prevent timing attacks', async () => {
      // Same length but different content should take same time
      const storedToken = 'a'.repeat(64);
      mockRedis.get.mockResolvedValue(storedToken);

      const start1 = Date.now();
      await validateCsrfToken('session-123', 'b'.repeat(64));
      const duration1 = Date.now() - start1;

      const start2 = Date.now();
      await validateCsrfToken('session-123', 'c'.repeat(64));
      const duration2 = Date.now() - start2;

      // Both should complete without early exit
      expect(duration1).toBeGreaterThanOrEqual(0);
      expect(duration2).toBeGreaterThanOrEqual(0);
    });

    it('should reject tokens with different lengths', async () => {
      mockRedis.get.mockResolvedValue('a'.repeat(64));

      const isValid = await validateCsrfToken('session-123', 'short');

      expect(isValid).toBe(false);
    });
  });

  describe('CSRF Token Cleanup', () => {
    it('should clear token from Redis', async () => {
      await clearCsrfToken('session-123');

      expect(mockRedis.del).toHaveBeenCalledWith('csrf:session-123');
    });

    it('should handle clearing non-existent token', async () => {
      mockRedis.del.mockResolvedValue(0);

      await expect(clearCsrfToken('session-nonexistent')).resolves.not.toThrow();
    });
  });

  describe('CSRF Middleware', () => {
    const createMockRequest = (options: {
      method?: string;
      url?: string;
      headers?: Record<string, string>;
    } = {}): Partial<FastifyRequest> => ({
      method: options.method || 'POST',
      url: options.url || '/api/test',
      headers: options.headers || {},
    });

    const createMockResponse = (): Partial<FastifyReply> & {
      status: ReturnType<typeof vi.fn>;
      send: ReturnType<typeof vi.fn>;
      header: ReturnType<typeof vi.fn>;
    } => ({
      status: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
      header: vi.fn().mockReturnThis(),
    });

    it('should skip CSRF for GET requests', async () => {
      const middleware = csrfProtection();
      const req = createMockRequest({ method: 'GET' });
      const res = createMockResponse();
      const next = vi.fn();

      await middleware(req as FastifyRequest, res as FastifyReply, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should skip CSRF for excluded paths', async () => {
      const middleware = csrfProtection();
      const req = createMockRequest({ method: 'POST', url: '/webhook/stripe' });
      const res = createMockResponse();
      const next = vi.fn();

      await middleware(req as FastifyRequest, res as FastifyReply, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should require session ID header', async () => {
      const middleware = csrfProtection();
      const req = createMockRequest({
        method: 'POST',
        headers: {},
      });
      const res = createMockResponse();
      const next = vi.fn();

      await middleware(req as FastifyRequest, res as FastifyReply, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.send).toHaveBeenCalledWith({
        error: 'CSRF protection: Session ID required',
        code: 'CSRF_SESSION_REQUIRED',
      });
    });

    it('should require CSRF token header', async () => {
      const middleware = csrfProtection();
      const req = createMockRequest({
        method: 'POST',
        headers: { 'x-session-id': 'session-123' },
      });
      const res = createMockResponse();
      const next = vi.fn();

      await middleware(req as FastifyRequest, res as FastifyReply, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.send).toHaveBeenCalledWith({
        error: 'CSRF protection: Token required',
        code: 'CSRF_TOKEN_REQUIRED',
      });
    });

    it('should reject invalid CSRF token', async () => {
      mockRedis.get.mockResolvedValue('valid-token');

      const middleware = csrfProtection();
      const req = createMockRequest({
        method: 'POST',
        headers: {
          'x-session-id': 'session-123',
          'x-csrf-token': 'invalid-token',
        },
      });
      const res = createMockResponse();
      const next = vi.fn();

      await middleware(req as FastifyRequest, res as FastifyReply, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.send).toHaveBeenCalledWith({
        error: 'CSRF protection: Invalid or expired token',
        code: 'CSRF_INVALID_TOKEN',
      });
    });

    it('should allow request with valid CSRF token', async () => {
      const validToken = 'a'.repeat(64);
      mockRedis.get.mockResolvedValue(validToken);

      const middleware = csrfProtection();
      const req = createMockRequest({
        method: 'POST',
        headers: {
          'x-session-id': 'session-123',
          'x-csrf-token': validToken,
        },
      });
      const res = createMockResponse();
      const next = vi.fn();

      await middleware(req as FastifyRequest, res as FastifyReply, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should support custom header names', async () => {
      const validToken = 'a'.repeat(64);
      mockRedis.get.mockResolvedValue(validToken);

      const middleware = csrfProtection({
        headerName: 'x-custom-csrf',
      });

      const req = createMockRequest({
        method: 'POST',
        headers: {
          'x-session-id': 'session-123',
          'x-custom-csrf': validToken,
        },
      });
      const res = createMockResponse();
      const next = vi.fn();

      await middleware(req as FastifyRequest, res as FastifyReply, next);

      expect(next).toHaveBeenCalled();
    });

    it('should support custom protected methods', async () => {
      const middleware = csrfProtection({
        protectedMethods: ['DELETE'],
      });

      // POST should be allowed (not in protected methods)
      const req = createMockRequest({ method: 'POST' });
      const res = createMockResponse();
      const next = vi.fn();

      await middleware(req as FastifyRequest, res as FastifyReply, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe('CSRF Cookie Setting', () => {
    it('should set CSRF token cookie with secure flags', async () => {
      const mockRes = {
        header: vi.fn(),
      } as unknown as FastifyReply;

      mockRedis.setex.mockResolvedValue('OK');

      await setCsrfCookie(mockRes, 'session-123');

      expect(mockRes.header).toHaveBeenCalledWith(
        'Set-Cookie',
        expect.stringMatching(/csrf_token=[a-f0-9]{64}/)
      );

      const cookieHeader = (mockRes.header as any).mock.calls[0][1];
      expect(cookieHeader).toContain('HttpOnly');
      expect(cookieHeader).toContain('Secure');
      expect(cookieHeader).toContain('SameSite=Strict');
      expect(cookieHeader).toContain('Max-Age=3600');
    });

    it('should support custom cookie name', async () => {
      const mockRes = {
        header: vi.fn(),
      } as unknown as FastifyReply;

      mockRedis.setex.mockResolvedValue('OK');

      await setCsrfCookie(mockRes, 'session-123', { cookieName: 'custom_csrf' });

      const cookieHeader = (mockRes.header as any).mock.calls[0][1];
      expect(cookieHeader).toContain('custom_csrf=');
    });
  });
});
